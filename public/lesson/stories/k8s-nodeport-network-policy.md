# k8s 部署服务不通：一轮检查下来没线索

## 故事背景
小李在 K8S 里部署过不少服务，其中以 Deployment -> ReplicaSet -> Pod -> Service -> Endpoint 这样的链路部署最多，一般的操作步骤如下：
- 在工程的根目录下，添加 helm chart 的目录，以 deploy 目录为例，执行命令：helm create deploy，生成 chart 目录和各个配置文件
- 为服务设置相应的配置文件，一般都是 deployment.yaml 和 service.yaml，deployment.yaml 里定义 Pod 模板，service.yaml 里定义 Service 对象，如果需要可以添加 configmap.yaml、secret.yaml 等 
- 修改工程的 CI/CD, 执行 helm install 命令，部署服务

这一套部署链路小李已经操练的很熟了，但很熟并不代表每次都能玩转。最近一次部署，小李依旧三下五除二把服务部署好了：`Pod` 正常在 Running，`Service` 正常，`Endpoint` 也正常，但是想通过临时开的 `NodePort` 访问，就是不通！

这种问题最烦人的地方在于，它不像应用启动失败那样一眼就能看到报错。它更像是外卖员顺着地址到了你小区门口，而你也在屋里等着美食的到来，但是等了半天居然没人来敲门。

小李一开始还以为是服务自己有问题，结果一轮检查下来居然没线索！继续查下去才发现：问题不在小区地址，也不在房间，而是小区门口还有一道容易被忽略的规则。

## 1. 部署团队的内部工具

上周，小李收到工单：在 Operation K8S Cluster 的 namespace 下面部署了一个内部工具服务，这个 namespace 叫 `tool`。

服务本身不复杂，就是给内部工具做测试用。为了方便临时验证，小李决定给它开一个 `NodePort`：便于快速验证服务的页面是否能正常访问

理论上服务的访问路径很清楚：
- 客户端（ client ）通过 NodeIP:NodePort 访问内部工具
- 请求通过内网到达 Operation K8S Cluster 的节点，由 kube-proxy 将请求发送到 Service
- Service 通过后端（endpoint 对象） 将请求转发到工具 Pod，处理并返回响应

看起来很简单，对吧？小李也是这么想的。然后在服务部署完毕后，他试着在浏览器里访问，输入地址敲完回车键，等了半天都没看到页面加载的影子，结果不通。

确认了访问地址准确无误以后，小李再次刷新页面，没有奇迹发生，依旧没响应！好家伙，又来活了！

## 2. 第一反应：是不是应用自己挂了？

排查服务不通，老规矩：小李第一反应还是从应用侧开始：命令很快就敲了起来！
```bash
# 先看 Pod：
kubectl get pod -n tool | grep test-tool
test-tool-5464546546-54654   1/1     Running   0          10m

# Pod 是 `Running`, 再看日志：
kubectl logs test-tool-5464546546-54654 -n tool

# 日志也正常，没有看到启动失败、端口绑定失败、异常退出之类的问题。
....
Log4j: DEBUG [main] org.springframework.web.servlet.DispatcherServlet - Initializing servlet 'dispatcherServlet'
....
Spring Boot application started successfully.
....
```

排查问题三板斧的第一板斧没有命中：这一步很重要。因为如果 Pod 自己都没起来，那后面查网络就是绕远路。应用没活，路再通也没用。

小李接着看 Service：
```bash
# 看 Service 状态
kubectl get svc test-tool -n tool

# 输出正常：
NAME      TYPE       CLUSTER-IP     EXTERNAL-IP   PORT(S)        AGE
test-tool NodePort   10.96.128.10   <none>        80:32531/TCP   11m

# 查看 svc 具体信息
kubectl describe svc -n tool <service-name>

# 输出也没异常：类型是 `NodePort`，端口也能对上。
Name:                     test-tool
Namespace:                tool
....
Annotations:              meta.helm.sh/release-name: tool
Selector:                 app.kubernetes.io/instance=tool,app.kubernetes.io/name=springboot
Type:                     NodePort
IP Family Policy:         SingleStack
IP Families:              IPv4
IP:                       10.96.128.10
IPs:                      10.96.128.10
Port:                     http  80/TCP
TargetPort:               8080/TCP
NodePort:                 http  32531/TCP
Endpoints:                10.244.1.10:8080
Session Affinity:         None
External Traffic Policy:  Cluster
Events:                   <none>

# 再看 Endpoint：
kubectl get endpoints test-tool -n tool

# Endpoint 也正常，Service 已经正确匹配到了后端 Pod。
NAME      ENDPOINTS           AGE
test-tool 10.244.1.10:8080    12m
```

这时候小李心里大概有了初步判断：
- Pod 没问题
- Service 没问题
- Endpoint 也没问题

排查问题三板斧的第二板斧也没有命中：问题就不太像是应用层，也不太像是 Service selector 写错了。

## 3. 到集群节点上直接 curl
为了排除自己电脑、本地网络、浏览器、代理等干扰因素，小李直接登录到 Kubernetes 的一个节点上测试。
```bash
# 在节点上访问 NodeIP:NodePort
curl -i --max-time 5 http://$NODE_IP:32531/health

# 结果很干脆：
curl: (28) Connection timed out after 5001 milliseconds
```

- 注意这里不是 `404`，不是 `500`，也不是连接后应用返回错误。
- `Connection timed out`， 这类错误通常说明：请求在路上被卡住了，或者压根没有被允许送到目标那里。
- 如果是应用自己报错，小李还能看到 HTTP 响应；如果是端口没人监听，常见的是 connection refused。现在是 timeout，矛头就开始往网络侧靠了。

小李不放心，又在另一个 namespace 里临时起了一个测试 Pod，从集群内部跨 namespace 访问 Service DNS：

```bash
kubectl run curl-test -n production --rm -it --image=curlimages/curl --restart=Never -- \
  curl -i --max-time 5 http://test-tool.tool.svc.cluster.local:80/health

# 结果也一样：
curl: (28) Connection timed out after 5001 milliseconds
```

排查问题三板斧的第三板斧再次失效：NodePort 不通，从其他 namespace 访问 Service 也不通！到这儿，小李已经隐隐约约感觉到，问题可能出在了网络侧。不然到这儿，三板斧完了就该知道原因了！
第一轮检查完成，暂时无果！

## 4. 网络侧排查：是不是防火墙拦了？
小李停下来想了想：既然是 NodePort 还是不通，接下来就开始怀疑网络侧。

NodePort 的访问链路里，常见嫌疑对象有几个：
- 节点防火墙
- 安全组
- 路由
- kube-proxy

小李先从最直观的防火墙查起。一圈检查下来发现，防火墙没有明显问题。NodePort 端口没有被系统防火墙挡住，节点网络也是正常的。

小李一下子还真有点懵逼：这个问题倒是没碰到过，难免有点着急了。突然他想起来，没多久之前才做过一个服务的连通性测试，那服务也是 NodePort 暴露的，而且是同一个集群。当时测试还是好的呢，咋这会不行了？

## 5. 对比其他 namespace：范围一下子缩小了

很快，小李找到了前阵子修改 NodePort 的服务，而且再次访问居然是好的。区别在哪呢？NodePort 的端口号肯定是不一致的，但这是集群自动分配的，应该没关系。还有啥不一样？等等，小李注意到了，可以访问的服务是在 `production` namespace 里的，而这次不通的 test-tool 服务是在 `tool` namespace 里。

这一下排查范围就明显缩小了：如果其他 namespace 的 NodePort 都不通，那可能是节点防火墙、集群网络、kube-proxy 或者更外层的网络策略有问题。

但现在情况是，同一个集群下：
- 其他 namespace 的 NodePort 可达
- tool namespace 的这个 NodePort 不可达

这就说明，集群整体 NodePort 能力大概率是好的，节点端口转发这条路也不是完全坏掉。问题更像是跟 `tool` 这个 namespace，或者这个 namespace 里的 Pod 访问策略有关。

这时候，小李想到了一个平时容易被忽略的对象：`NetworkPolicy`。但是他对这个使用的比较少，只能先找 AI 确认一下问题：
```bash
# 问题1
我的 k8s 集群有两个 namespace，production 和 tool，production 里的 NodePort 可以访问，tool 里的 NodePort 不可达，这是什么原因导致的？已经检查了节点防火墙，没发现问题。

# 答案
根据您提供的信息，导致 production namespace 中的 NodePort 可以访问，而 tool namespace 中的 NodePort 不可达的可能原因有以下几种：
1. NetworkPolicy 隔离：tool namespace 中可能有 NetworkPolicy 规则阻止了外部对 NodePort 的访问。
2. 网络插件问题：如果您的集群使用了 Calico、Cilium 等网络插件，它们可能在 tool namespace 中应用了更严格的网络策略。
3. 节点网络问题：虽然您已经检查了节点防火墙，但还是建议检查一下节点网络配置，确保没有其他网络问题。
....

# 问题2
如何确定是不是 NetworkPolicy 的问题？

# 答案
可以检查一下 tool namespace 中的 NetworkPolicy 规则，看是否有阻止外部访问的策略。同时，也可以在不同 namespace 里起临时 Pod 做对比：如果同 namespace 内访问正常，但跨 namespace 或 NodePort 访问不通，就更像是 NetworkPolicy 的访问来源限制。
....
```

## 6. NetworkPolicy 登场：原来门口还有门禁
根据获取到的信息，小李先把策略列出来：
```bash
# 查看 tool namespace 里的 NetworkPolicy
kubectl get networkpolicy -n tool

# 输出
NAME               AGE
default-deny-all   10d

# 果然，这个 namespace 里有一条默认隔离相关的策略。继续把策略内容展开看：
kubectl get networkpolicy -n tool default-deny-all -o yaml

# 输出 yaml:
podSelector: {}
policyTypes:
- Ingress
- Egress
ingress:
- from:
  - podSelector: {}
```

这个意思可以简单理解为：
- 这个 namespace 里的 Pod 被策略管起来了。
- Ingress 方向只允许策略里写明的来源。
- 如果只允许 podSelector: {}，通常表示允许同 namespace 内的 Pod 访问。

但是小李这次是从 NodePort 访问。NodePort 的流量是从节点 IP、外部机器或者某个特定网络入口打进来的。对后端 Pod 来说，这个来源不一定是 `tool` namespace 里的某个 Pod。

看到这里，小李才反应过来：前面 Pod、Service、Endpoint 都正常，并不代表请求一定能进到 Pod 里。Service 只是把路指过去，NetworkPolicy 才决定这股流量能不能进门。以前不怎么关注是压根就没用到这玩意！

这就像：
- 门牌号是对的
- 房间里也有人
- 小区道路也是通的
- 但是门禁规则说：只有小区业主才能刷卡能进
- 外卖员没有卡，当然进不去

## 7. 关于 NetworkPolicy
`NetworkPolicy` 是 Kubernetes 里控制 Pod 网络访问的一种资源。大白话说，它不是负责“让服务能访问”的，而是负责“限制谁可以访问谁”的。

默认情况下，如果一个 namespace 里没有 NetworkPolicy 选中某个 Pod，那么这个 Pod 通常是相对开放的，谁能路由到它，基本就能尝试访问它。

但一旦某个 Pod 被 NetworkPolicy 选中了，事情就变了：
- 没有写允许的流量，就默认不允许。

这就是 NetworkPolicy 最容易坑人的地方：它不是在应用日志里报错，也不是在 Service 上显示异常。你看 Pod 是好的，看 Service 是好的，看 Endpoint 也是好的，但请求就是到不了 Pod。

## 8. 修复思路：不是把门拆了，而是加一条明确规则

找到原因以后，小李的第一反应是：最简单且粗暴的办法当然是删掉 NetworkPolicy。

但小李知道不能这么干。NetworkPolicy 之所以存在，一般都是为了隔离 namespace，限制横向访问，避免测试工具、内部服务、监控组件之间乱串。如果直接给删除，等于把门禁拆了，至少要先确认用途再做决定！
至于是谁创建的、目的又是啥，这些都可以后面再澄清。眼下的主要任务还是完成工具的测试。

小李有两个选择：
- 如果还是部署在 `tool` namespace 下面：根据测试需要，加一条明确的允许规则。
- 如果部署在 production 的 namespace 里，直接就可以访问

权衡利弊以后，小李决定还是先把工具部署到 production 的 namespace 里。修改 helm chart 的配置以后，CI/CD 很快就重新部署了服务，测试也很快就通了。

不过小李也知道，这不是长期最优解，只是为了先完成这次临时测试；后续更规范的做法，还是应该给 `tool` namespace 补一条明确的允许规则；或者明确这个服务不能通过 NodePort 对外提供服务，只能 tool 的 ns 内部访问。

## 9. 这次问题给小李的提醒

这次排查以后，小李对 NodePort 又有了更多理解。以前看到 NodePort 不通，第一反应可能是：
- 是不是 Pod 挂了？
- 是不是 Service selector 写错了？
- 是不是防火墙没开？

这些都要查，但是三板斧下来，都没出原因的话，下面就要看看是否 NetworkPolicy 在拦路了。

尤其是在公司内部集群里，很多 namespace 都会有默认隔离策略。它们平时安安静静，只有在你临时开 NodePort、临时做测试、临时从某个节点访问服务时，才突然跳出来刷存在感。

小李重新整理了自己的排障三板斧：
1. 看 Pod 是否 Running
2. 看 Pod log 是否正常
3. 看 Service 和 Endpoint 是否匹配
4. 在节点上 curl NodeIP:NodePort/health
5. 检查防火墙和网络连通性
6. 对比其他 namespace 的 NodePort 是否可达
7. 检查当前 namespace 的 NetworkPolicy

最后一句话总结：
- NodePort 只是把门牌挂到了楼外，
- NetworkPolicy 才决定你能不能真的进屋。

----- English

# A k8s Service Was Unreachable: One Round of Checks Gave Mike No Clue

## Background

Mike had deployed plenty of services on K8S. The most common path he worked with was:

```text
Deployment -> ReplicaSet -> Pod -> Service -> Endpoint
```

The usual steps were also familiar:

- Add a Helm chart directory under the project root. For example, create a `deploy` directory and run `helm create deploy` to generate the chart structure and configuration files.
- Prepare the service configuration files, usually `deployment.yaml` and `service.yaml`. The `deployment.yaml` defines the Pod template, while `service.yaml` defines the Service object. If needed, files such as `configmap.yaml` and `secret.yaml` can also be added.
- Update the project's CI/CD pipeline and run `helm install` to deploy the service.

Mike had practiced this deployment flow many times. But being familiar with a workflow does not mean every deployment will go smoothly.

During a recent deployment, Mike quickly got the service running as usual: the `Pod` was `Running`, the `Service` looked normal, and the `Endpoint` was also present. But when he tried to access it through a temporary `NodePort`, it just would not respond.

The annoying thing about this kind of problem is that it does not fail as clearly as an application startup error. It feels more like a courier reaching the lobby of your office building while you are waiting upstairs, but security never lets them past the front desk, so nobody ever knocks on your door.

At first, Mike thought the service itself had a problem. But after one round of checks, he still had no clue. As he kept digging, he eventually realized that the issue was not the street address, nor the office room. There was another access rule in the lobby that he had overlooked.

## 1. Deploying an Internal Team Tool

Last week, Mike received a ticket: deploy an internal tool service into a namespace called `tool` in the Operation K8S Cluster.

The service itself was simple. It was only used for internal testing. To make validation easier, Mike decided to expose it with a `NodePort`, so the page could be tested quickly.

In theory, the access path was straightforward:

- The client accesses the internal tool through `NodeIP:NodePort`.
- The request reaches a node in the Operation K8S Cluster over the internal network, and `kube-proxy` forwards it to the Service.
- The Service forwards the request to the backend Pod through the Endpoint object, and the Pod handles the request and returns a response.

Simple enough, right?

Mike thought so too. After the service was deployed, he opened the address in a browser, pressed Enter, and waited. But the page never loaded.

After confirming that the address was correct, Mike refreshed the page again. Still nothing.

Here we go again.

## 2. First Reaction: Did the Application Fail?

When a service is unreachable, Mike's usual first move is to start from the application side. The commands came out quickly:

```bash
# Check the Pod first:
kubectl get pod -n tool | grep test-tool
test-tool-5464546546-54654   1/1     Running   0          10m

# The Pod is Running, so check the logs:
kubectl logs test-tool-5464546546-54654 -n tool

# The logs also look normal. No startup failure, port binding issue,
# or abnormal exit is visible.
....
Log4j: DEBUG [main] org.springframework.web.servlet.DispatcherServlet - Initializing servlet 'dispatcherServlet'
....
Spring Boot application started successfully.
....
```

The first move did not hit anything.

This step matters. If the Pod itself is not running, then checking the network too early is a detour. If the application is not alive, the road can be perfectly open and it still will not help.

Mike then checked the Service:

```bash
# Check the Service status
kubectl get svc test-tool -n tool

# The output looks normal:
NAME      TYPE       CLUSTER-IP     EXTERNAL-IP   PORT(S)        AGE
test-tool NodePort   10.96.128.10   <none>        80:32531/TCP   11m

# Check the Service details
kubectl describe svc -n tool <service-name>

# The output also looks fine. The type is NodePort, and the ports match.
Name:                     test-tool
Namespace:                tool
....
Annotations:              meta.helm.sh/release-name: tool
Selector:                 app.kubernetes.io/instance=tool,app.kubernetes.io/name=springboot
Type:                     NodePort
IP Family Policy:         SingleStack
IP Families:              IPv4
IP:                       10.96.128.10
IPs:                      10.96.128.10
Port:                     http  80/TCP
TargetPort:               8080/TCP
NodePort:                 http  32531/TCP
Endpoints:                10.244.1.10:8080
Session Affinity:         None
External Traffic Policy:  Cluster
Events:                   <none>

# Check the Endpoint:
kubectl get endpoints test-tool -n tool

# The Endpoint also looks normal. The Service has matched the backend Pod correctly.
NAME      ENDPOINTS           AGE
test-tool 10.244.1.10:8080    12m
```

At this point, Mike had an initial judgment:

- The Pod looked fine.
- The Service looked fine.
- The Endpoint also looked fine.

The second move did not hit anything either. The problem no longer looked like an application issue, nor did it look like a wrong Service selector.

## 3. Curl Directly from a Cluster Node

To rule out his own laptop, local network, browser, proxy, and other distractions, Mike logged in to one Kubernetes node and tested from there.

```bash
# Access NodeIP:NodePort from the node
curl -i --max-time 5 http://$NODE_IP:32531/health

# The result is clear:
curl: (28) Connection timed out after 5001 milliseconds
```

A few details are important here:

- This was not `404`.
- This was not `500`.
- This was not an application-level response after the connection was established.
- It was `Connection timed out`.

This kind of error usually means the request got stuck somewhere on the way, or was never allowed to reach the destination.

If the application itself returned an error, Mike would still see an HTTP response. If nobody was listening on the port, a common symptom would be `connection refused`. But this was a timeout, so the focus started moving toward the network side.

Mike was still not fully convinced. He created a temporary test Pod in another namespace and tried to access the Service DNS across namespaces:

```bash
kubectl run curl-test -n production --rm -it --image=curlimages/curl --restart=Never -- \
  curl -i --max-time 5 http://test-tool.tool.svc.cluster.local:80/health

# Same result:
curl: (28) Connection timed out after 5001 milliseconds
```

The third move failed again: NodePort was unreachable, and accessing the Service from another namespace also timed out.

At this point, Mike started to feel that the problem might be on the network side. Otherwise, after this first round of checks, he should already have found the cause.

First round completed. Still no clear answer.

## 4. Network-Side Check: Is a Firewall Blocking It?

Mike paused for a moment. Since NodePort was still unreachable, it was time to look at the network side.

Common suspects in the NodePort access path include:

- Node firewall
- Security group
- Routing
- `kube-proxy`

Mike started with the most obvious one: the firewall. After checking around, he did not find any obvious issue. The NodePort port was not blocked by the system firewall, and node-level networking looked normal.

Mike was a bit stuck. He had not seen this exact issue before, and naturally he started to feel some pressure. Then he suddenly remembered something: not long ago, he had tested another service exposed by NodePort in the same cluster, and it worked fine at the time.

So why was this one failing?

## 5. Comparing Another Namespace Narrows the Scope

Mike quickly found the NodePort service he had tested earlier. He tried it again, and surprisingly, it still worked.

What was different?

The NodePort number was different, of course, but that was assigned by the cluster and should not be the key difference.

What else?

Then Mike noticed something: the working service was in the `production` namespace, while the unreachable `test-tool` service was in the `tool` namespace.

That narrowed the scope a lot.

If NodePort services in other namespaces were also unreachable, then the problem might be the node firewall, cluster networking, `kube-proxy`, or some outer network policy.

But the current situation in the same cluster was:

- NodePort in another namespace was reachable.
- NodePort for this service in the `tool` namespace was unreachable.

This suggested that the cluster's NodePort capability was probably fine, and node port forwarding was not completely broken. The problem looked more related to the `tool` namespace, or to the access rules around Pods inside that namespace.

At this point, Mike thought of an object that is easy to overlook: `NetworkPolicy`.

But he had not used it much before, so he asked AI to help confirm the direction:

```bash
# Question 1
My k8s cluster has two namespaces: production and tool.
NodePort in production is reachable, but NodePort in tool is not.
What could cause this? I already checked the node firewall and found no issue.

# Answer
Based on the information you provided, possible causes include:
1. NetworkPolicy isolation: the tool namespace may have NetworkPolicy rules that block external access through NodePort.
2. Network plugin behavior: if the cluster uses Calico, Cilium, or a similar CNI plugin, stricter network policies may be applied to the tool namespace.
3. Node network issue: although you have checked the node firewall, it is still worth checking other node network settings.
....

# Question 2
How can I confirm whether this is a NetworkPolicy issue?

# Answer
You can inspect the NetworkPolicy rules in the tool namespace and check whether they block external access.
You can also compare traffic from different namespaces:
if same-namespace access works, but cross-namespace access or NodePort access does not,
then it is more likely to be a source restriction caused by NetworkPolicy.
....
```

## 6. NetworkPolicy Appears: There Was a Gate at the Entrance

Based on the information he got, Mike first listed the policies:

```bash
# Check NetworkPolicies in the tool namespace
kubectl get networkpolicy -n tool

# Output
NAME               AGE
default-deny-all   10d

# There is indeed a default isolation policy in this namespace.
# Continue checking the policy content:
kubectl get networkpolicy -n tool default-deny-all -o yaml

# YAML output:
podSelector: {}
policyTypes:
- Ingress
- Egress
ingress:
- from:
  - podSelector: {}
```

This can be understood roughly as:

- Pods in this namespace are controlled by the policy.
- Ingress traffic is only allowed from sources explicitly listed in the policy.
- If the rule only allows `podSelector: {}`, it usually means traffic from Pods in the same namespace is allowed.

But Mike was accessing the service through NodePort.

NodePort traffic comes from a node IP, an external machine, or some specific network entry point. From the backend Pod's perspective, the source is not necessarily a Pod inside the `tool` namespace.

That was when Mike finally realized something:

The Pod, Service, and Endpoint all being normal does not mean the request is guaranteed to reach the Pod. The Service points the traffic in the right direction, but NetworkPolicy decides whether that traffic is allowed to enter.

Mike had not paid much attention to this before because he had barely used it.

The office-building analogy now made sense:

- The street address is correct.
- Mike is waiting upstairs.
- The lobby and elevators are there.
- But security only lets employees with badges past the front desk.
- The courier does not have a badge, so of course they cannot reach the office.

## 7. About NetworkPolicy

`NetworkPolicy` is a Kubernetes resource used to control Pod network access.

In plain language, it is not responsible for "making services reachable." It is responsible for "limiting who can access whom."

By default, if no NetworkPolicy selects a Pod in a namespace, that Pod is usually relatively open. If traffic can be routed to it, it can generally try to access it.

But once a Pod is selected by a NetworkPolicy, things change:

- Traffic that is not explicitly allowed is denied by default.

That is the tricky part of NetworkPolicy.

It does not show up as an application error in the logs. It does not show as an abnormal Service. The Pod looks good, the Service looks good, and the Endpoint looks good, but the request still cannot reach the Pod.

## 8. Fixing It: Do Not Tear Down the Gate, Add a Clear Rule

After finding the cause, Mike's first thought was the simplest and roughest fix: delete the NetworkPolicy.

But he knew he could not do that casually.

NetworkPolicy usually exists to isolate namespaces, restrict lateral access, and prevent test tools, internal services, and monitoring components from freely reaching each other. Deleting it directly would be like removing the gate entirely. At the very least, its purpose should be confirmed first.

Who created it and why could be clarified later. The immediate task was still to complete the tool test.

Mike had two options:

- If the service stayed in the `tool` namespace, add an explicit allow rule based on the testing requirement.
- If the service was deployed into the `production` namespace, it could be accessed directly.

After weighing the trade-offs, Mike decided to first deploy the tool into the `production` namespace. After updating the Helm chart configuration, CI/CD redeployed the service quickly, and the test passed soon after.

But Mike also knew this was not the best long-term solution. It was only a temporary way to finish this test. A more proper follow-up would be to add an explicit allow rule for the `tool` namespace, or clearly define that this service should not be exposed through NodePort and should only be accessed inside the `tool` namespace.

## 9. What Mike Took Away

After this troubleshooting session, Mike gained a deeper understanding of NodePort.

In the past, when NodePort was unreachable, his first reactions were usually:

- Is the Pod down?
- Is the Service selector wrong?
- Is the firewall closed?

All of these still need to be checked. But if the usual first round of checks does not reveal the cause, the next thing to check is whether NetworkPolicy is standing in the way.

This is especially common in internal company clusters. Many namespaces have default isolation policies. Most of the time they stay quiet. But when you temporarily open NodePort, run a quick test, or access a service from a node, they suddenly make their presence known.

Mike reorganized his troubleshooting checklist:

1. Check whether the Pod is `Running`.
2. Check whether the Pod logs look normal.
3. Check whether the Service and Endpoint match.
4. Curl `NodeIP:NodePort/health` from a node.
5. Check firewall and network connectivity.
6. Compare whether NodePort works in another namespace.
7. Check the NetworkPolicy in the current namespace.

One sentence to summarize it:

- NodePort only puts the address outside the building.
- NetworkPolicy decides whether you can actually enter the room.
