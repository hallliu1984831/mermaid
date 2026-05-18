----- Chinese
# K8S DNS 解析失败：小李把 DNS 查了个遍

## 故事背景

经历过上一次 K8S 工作节点 `NotReady` 的故障以后，小李所在的 SRE 团队对这套生产集群的监控更有把握了。不是因为集群从此不会出问题，而是因为团队补上了很多以前缺失的监控：
- 节点 `Ready` 状态
- Pod 调度失败
- kubelet 和 containerd 状态
- 节点资源余量
- 关键业务接口可用性

有了这些监控以后，小李心里踏实了不少。在事后的复盘里，他和同事们都再次意识到了有效监控的重要性："K8S 集群出问题不可怕，可怕的是它已经坏了，但 SRE 还不知道。"

不成想没过多久，小李又被 K8S 上了一课。这一次，节点都是 `Ready`，Pod 也都是 `Running`，Deployment 副本数也正常。可部署在集群里的业务就是访问失败。

踩过坑的小李又一次踏上了检查问题的路程，一番检查下来，问题最后指向了一个大家平时不太在意的地方：DNS。

## 1. 第一次 DNS 故障：服务名突然解析失败

### 1.1：业务开始报错
某天上午，业务群里突然有人反馈，抛出了经典的灵魂三问："支付服务调用用户服务一直失败，请值班 SRE 检查出了什么问题？ 有什么业务影响？ 啥时候能恢复服务？"

看到消息后，小李第一时间回复：“检查中，稍后更新！”，接下来的反应是先看业务服务本身。先检查用户服务的 Pod 状态：Pod 正常如下：

```bash
kubectl get pods -n user
NAME                        READY   STATUS    RESTARTS   AGE
user-api-6c9f7f8d5f-b2n9x   1/1     Running   0          3d
user-api-6c9f7f8d5f-jtq4p   1/1     Running   0          3d
user-api-6c9f7f8d5f-zk82m   1/1     Running   0          3d
```

再看对应的 Service 和 Endpoint：两者也正常如下。

```bash
kubectl get svc -n user
NAME       TYPE        CLUSTER-IP     EXTERNAL-IP   PORT(S)    AGE
user-api   ClusterIP   10.96.128.37   <none>        8080/TCP   120d

kubectl get endpoints user-api -n user
NAME       ENDPOINTS                                            AGE
user-api   10.244.2.31:8080,10.244.3.44:8080,10.244.4.19:8080   120d
```

小李心里有点纳闷："服务没挂，Endpoint 也有，那支付服务为什么说访问不了？总不能是调用方写错了地址吧？"，再一想这不大可能，之前都是好好的。而且支付服务的 pod 也都是 Running 状态且近期没有更新或者重启。

### 1.2：进入业务 Pod 内部验证
小李没有急着下结论，而是进入报错的支付服务 Pod 里做验证，直接访问完整 Service 域名，看是否能复现业务报错：

```bash
# 进入 Pod
kubectl exec -it payment-api-7b7b7df66c-p8m2q -n payment -- sh
# 进入 Pod 后，直接访问完整 Service 域名
curl -v http://user-api.user.svc.cluster.local:8080/health
```

结果没有返回健康检查，而是卡住了一会儿后报错：

```bash
curl: (6) Could not resolve host: user-api.user.svc.cluster.local
```

再用 `nslookup` 看一下：

```bash
nslookup user-api.user.svc.cluster.local
;; connection timed out; no servers could be reached
```

检查到这，问题就清楚了一半：不是 HTTP 调用失败，也不是用户服务本身不可用，而是服务名解析失败了。

小李当时心里一紧："这不是业务问题，是集群 DNS 出问题了。"

### 1.3：确认 DNS 服务地址

小李继续看 Pod 里的 DNS 配置，看着也是 OK 的：

```bash
cat /etc/resolv.conf
nameserver 10.96.0.10
search payment.svc.cluster.local svc.cluster.local cluster.local corp.example.com
options ndots:5
```
`nameserver 10.96.0.10` 是集群里的 `kube-dns` Service，也就是 CoreDNS 对外提供服务的 ClusterIP。

于是小李退出 Pod，切换到 kube-system namespace 下检查集群的核心组件 CoreDNS：

```bash
kubectl get svc -n kube-system kube-dns
NAME       TYPE        CLUSTER-IP   EXTERNAL-IP   PORT(S)                  AGE
kube-dns   ClusterIP   10.96.0.10   <none>        53/UDP,53/TCP,9153/TCP   180d

kubectl get pods -n kube-system -l k8s-app=kube-dns -o wide
NAME                       READY   STATUS    RESTARTS   AGE   IP            NODE
coredns-6d4b75cb6d-7n6xs   1/1     Running   0          45d   10.244.1.12   worker-1
coredns-6d4b75cb6d-lp9kq   1/1     Running   0          45d   10.244.2.18   worker-2
```

这下小李有点懵了，因为 kube-dns Service 存在，而且 CoreDNS Pod 也是 `Running`。从表面上看，业务 Pod 正常，业务 Service 正常，CoreDNS Pod 也正常，可 DNS 查询就是超时！

### 1.4：Running 不代表真的好用

小李接着看 CoreDNS 日志：

```bash
kubectl logs -n kube-system coredns-6d4b75cb6d-7n6xs
```

日志里开始出现大量类似信息：

```bash
[ERROR] plugin/errors: 2 api.external.example.com. A: read udp 10.244.1.12:42531->10.10.10.10:53: i/o timeout
[ERROR] plugin/errors: 2 auth.external.example.com. A: read udp 10.244.1.12:48122->10.10.10.10:53: i/o timeout
```

这些日志看起来都是外部域名解析超时，但它反映出的更大问题是：CoreDNS 当时已经不只是某个外部域名查不到，而是整体 DNS 查询开始堆积，响应延迟明显变高。集群内 Service 域名的解析请求也被拖慢，最终表现成业务 Pod 里访问 `user-api.user.svc.cluster.local` 也会超时。

再看 CoreDNS 的指标，P99 查询延迟也明显被打高：

```bash
CoreDNS Query P99 Latency: 3.8s
CoreDNS Error Rate: 18%
CoreDNS QPS: 4.6k
```

再看 CoreDNS 的资源使用情况：

```bash
kubectl top pod -n kube-system | grep coredns
coredns-6d4b75cb6d-7n6xs   240m   165Mi
coredns-6d4b75cb6d-lp9kq   260m   172Mi
```

CPU 看起来不算特别夸张，但对照相应的 grafana dashboard，可以发现当前的 CPU 使用率比平时高了不少。

小李又查了一下业务侧最近的变更，发现当天上午有一个服务发布后，短时间内产生了大量对外部域名和内部服务名的解析请求。CoreDNS 的请求量被打高以后，开始出现明显的查询延迟和超时。小李心想：这应该是上面检查到 timeout、P99 延迟升高和 CPU 偏高的直接原因。

### 1.5：先重启 CoreDNS 修复问题

既然 CoreDNS 已经成为故障链路上的关键瓶颈，而且当时大量业务调用已经受影响，小李决定先做一次最直接的修复动作：滚动重启 CoreDNS。

```bash
# 重启 CoreDNS
kubectl rollout restart deployment coredns -n kube-system
# 随后观察 CoreDNS Pod：
kubectl get pods -n kube-system -l k8s-app=kube-dns -w
```

等新的 CoreDNS Pod 都变成 `Running` 后，小李再次进入业务 Pod 测试 DNS 并再访问健康检查：

```bash
# 测试 DNS
nslookup user-api.user.svc.cluster.local
Server:    10.96.0.10
Address 1: 10.96.0.10 kube-dns.kube-system.svc.cluster.local

Name:      user-api.user.svc.cluster.local
Address 1: 10.96.128.37 user-api.user.svc.cluster.local

# 访问健康检查
curl http://user-api.user.svc.cluster.local:8080/health
ok
```
业务调用逐步恢复，群里的报错也开始减少，灭火成功。

## 2. 第二次故障：这次不是 CoreDNS 的锅

### 2.1：熟悉的报错又来了

过了一段时间，业务群里又出现了熟悉的反馈："订单服务访问库存服务失败"。联想到之前才解决的问题，小李第一反应就是："不会又是 CoreDNS 出问题了吧？"

但这次他没有急着重启 CoreDNS。因为上一次故障以后，团队已经补了 CoreDNS 监控。如果 CoreDNS 有问题，监控早就应该报警了啊？！
小李先打开 Grafana 看了一眼：
- CoreDNS QPS 正常
- CoreDNS 错误率正常
- CoreDNS P99 延迟正常
- CoreDNS Pod 没有重启
- kube-dns Service Endpoint 正常

看完这些指标，小李心里反而更疑惑了："DNS 服务看着没问题，那为什么业务还说解析失败？"

### 2.2：短域名失败，完整域名正常
这次小李查看报错日志，内容如下 -- ‘lookup inventory on 10.96.0.10:53: no such host’

日志里的 “inventory”看起来是一个短域名，接着小李查看了订单服务的部署，确认了应用访问的是短域名：`inventory`。随后，小李进入报错的订单服务 Pod ，继续检查：

```bash
# 进入 Pod
kubectl exec -it order-api-68f8d6f98f-j7x2p -n order -- sh

# 测试短域名：
nslookup inventory
Server:    10.96.0.10
Address 1: 10.96.0.10 kube-dns.kube-system.svc.cluster.local

** server can't find inventory: NXDOMAIN
```
意料之中，短域名果然解析失败。很自然的，小李又试了一下完整域名是否可以使用：

```bash
nslookup inventory.prod.internal.example.com
Server:    10.96.0.10
Address 1: 10.96.0.10 kube-dns.kube-system.svc.cluster.local

Name:      inventory.prod.internal.example.com
Address 1: 10.20.30.41
```

完整域名可以解析，这下方向变了：基本排除了 CoreDNS 整体故障的可能。如果 CoreDNS 整体有问题，完整域名也应该受影响。现在完整域名能解析，短域名不能解析，说明问题更可能出在解析器的搜索路径上。

小李盯着终端想了一会儿："这次可能不是 DNS 服务坏了，而是它根本没有往正确的域名后缀上查。"

### 2.3：检查 Pod 里的 resolv.conf

小李查看 Pod 内的 `/etc/resolv.conf`：

```bash
cat /etc/resolv.conf
nameserver 10.96.0.10
search order.svc.cluster.local svc.cluster.local cluster.local old.example.com legacy.example.com
options ndots:5
```

问题逐渐清楚了：应用访问的是短域名 `inventory`，它真正对应的完整域名是：`inventory.prod.internal.example.com`

但 Pod 的 `search` 列表里并没有这个配置。也就是说，当应用访问 `inventory` 时，系统解析器会尝试这些名字：

```bash
inventory.order.svc.cluster.local
inventory.svc.cluster.local
inventory.cluster.local
inventory.old.example.com
inventory.legacy.example.com
```

它从来没有尝试过：`inventory.prod.internal.example.com`，所以 CoreDNS 不是没查到，而是压根没有收到正确方向上的查询。

### 2.4：为什么 search 列表里少了这个域名

小李继续往下查。发现这个 Pod 使用的是默认 DNS 策略：
```yaml
dnsPolicy: ClusterFirst
```

在这种配置下，Pod 内的 `/etc/resolv.conf` 会由 kubelet 在创建 Pod 时生成。通常会包含 K8S 集群内部的搜索域，比如：
- 当前 namespace 的 service 域
- `svc.cluster.local`
- `cluster.local`

同时，在一些环境里，节点上的 DNS search 配置也会被合并进 Pod 的解析配置里。于是小李登录到这个 Pod 所在的 worker 节点：

```bash
# 找到 Pod 所在的节点
kubectl get pod order-api-68f8d6f98f-j7x2p -n order -o wide
NAME                           READY   STATUS    IP            NODE
order-api-68f8d6f98f-j7x2p     1/1     Running   10.244.3.71   worker-2
# 登录到节点并查看配置
ssh worker-2
cat /etc/resolv.conf
# 输出如下：
nameserver 10.10.10.10
search old.example.com legacy.example.com
```
这里面没有 `prod.internal.example.com`。

更麻烦的是，在当前系统和运行时组合下，Pod 里的 `search` 列表实际能稳定生效的数量有限。在这套环境里，Pod 内最终只保留了 5 个 search domain。K8S 自己会先放入 3 个集群内部搜索域，剩下能留给公司内部域名的空间只有 2 个。如果节点上的 search domain 本来就堆着历史包袱，那么真正需要的域名后缀就很容易被挤掉。

小李看到这里，基本确认了根因：
- 不是 CoreDNS 故障。
- 不是 Service 没有 Endpoint。
- 不是 Pod 网络不通。

而是 Pod 的 `/etc/resolv.conf` 里缺少了业务依赖所需的 search domain。

### 2.5：先用 hostAliases 临时修复
虽然根因找到了，但修改节点 DNS 配置、重建 Pod、确认影响范围都需要时间，且安排好变更窗口。考虑业务还在报错，小李决定先对关键服务做临时修复：在订单服务的 Deployment 里临时增加 `hostAliases`：

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: order-api
  namespace: order
spec:
  template:
    spec:
      hostAliases:
        - ip: "10.20.30.41"
          hostnames:
            - "inventory"
            - "inventory.prod.internal.example.com"
```

保存这个配置后，K8S 重建 Pod ，并把 hostAliases 指定的域名和 IP 写进 Pod 的 `/etc/hosts`。

新的 Pod 启动并运行后，小李进入 Pod 再次检查：

```bash
# 在 Pod 中查看 /etc/hosts
cat /etc/hosts
10.20.30.41 inventory inventory.prod.internal.example.com

# 测试访问
curl http://inventory:8080/health
ok
```

关键业务先恢复了。但小李心里清楚："hostAliases 只是临时修复，不能作为最终方案。" 因为它的问题很明显：
- IP 是静态写死的，后端服务 IP 变化后会再次故障
- 把域名和 IP 强行写进 `/etc/hosts`。这相当于绕过了 DNS，而不是修好了 DNS。
- 配置散落在业务 Deployment 里，后续很容易忘

### 2.6：修正 worker 节点的 resolv.conf

临时恢复服务后，小李接着规划了下一步的修改：调整 worker 节点上的 DNS search 配置。

小李先把相关 worker 节点上的 `/etc/resolv.conf` 做了一轮对比检查：

```bash
# 登录到节点并查看配置
cat /etc/resolv.conf
nameserver 10.10.10.10
search old.example.com legacy.example.com

# 这个节点上没有 prod.internal.example.com
# `old.example.com` 已经很久没有生产业务依赖了，是可以被替换的配置
```

因为这属于集群节点层面的配置修改，小李没有直接在线上随手改。他先和业务侧确认了影响范围，又提了一个修改的工单，安排一个变更窗口，工单信息如下：
- 修改时间：某日零点（非业务高峰期）
- 概要说明：更新生产集群的 DNS 配置
- 修改步骤如下：

1. 在相关 worker 节点上统一调整 `/etc/resolv.conf`。

```bash
# 修改前
nameserver 10.10.10.10
search old.example.com legacy.example.com

# 修改后：
nameserver 10.10.10.10
search legacy.example.com prod.internal.example.com
```
2. 更改配置后，重启订单服务：

```bash
kubectl rollout restart deployment order-api -n order
```

3. 新的 Pod 启动以后，进入 Pod 检查，确保`prod.internal.example.com` 已经出现在 Pod 的 search 列表里

```bash
kubectl exec -it order-api-68f8d6f98f-x4m7c -n order -- sh
--- 进入容器
cat /etc/resolv.conf
nameserver 10.96.0.10
search order.svc.cluster.local svc.cluster.local cluster.local legacy.example.com prod.internal.example.com
options ndots:5
```

4. 验证短域名：

```bash
nslookup inventory
Server:    10.96.0.10
Address 1: 10.96.0.10 kube-dns.kube-system.svc.cluster.local

Name:      inventory.prod.internal.example.com
Address 1: 10.20.30.41
```
5. 应用实际访问方式验证：

```bash
curl http://inventory:8080/health
ok
```

6. 确保短域名解析恢复，业务访问也正常。

7. 把之前临时加上的 `hostAliases` 从 Deployment 里删掉，并再次滚动重启订单服务。

8. 等新的 Pod 全部起来以后，确认 `/etc/hosts` 里已经没有手工写死的 `inventory` 记录，业务访问仍然正常。

后续变更按工单完成后，短域名解析恢复，hostAliases 也被移除。

## 两次 DNS 故障的区别
这两次故障看起来都叫“域名解析失败”，但本质完全不一样。

第一次，是 DNS 服务本身出了问题：
- CoreDNS Pod 还活着
- 但解析延迟升高，请求大量超时
- 重启 CoreDNS 后恢复
- 后续重点是补 CoreDNS 容量、监控和告警
- 修复复杂度：低

第二次，是 DNS 解析路径出了问题：
- CoreDNS 本身正常
- 完整域名可以解析
- 短域名无法解析
- 根因是 Pod 的 `/etc/resolv.conf` 缺少必要的 search domain
- 临时用 `hostAliases` 止血，最终修正 worker 节点 DNS search 配置
- 修复复杂度：高


## 小李的复盘
这次 DNS 故障之后，小李对 K8S 里的“服务可用”又有了新的理解。

以前大家排查服务调用失败时，很容易按这个顺序看：

1. Pod 是否 Running
2. Service 是否存在
3. Endpoint 是否正常
4. 网络是否连通
5. 应用日志有没有异常

但这次以后，小李把 DNS 单独拎了出来。因为在 K8S 里，服务调用很多时候不是从 IP 开始的，而是从一个名字开始的。名字解析失败，后面的一切都无从谈起。


## 补充说明
- CoreDNS：K8S 集群内常见的 DNS 服务组件，负责解析集群内 Service 域名，也可以转发外部域名查询。
- kube-dns Service：集群里暴露 DNS 服务的 Service，很多集群中它的 ClusterIP 会被写入 Pod 的 `/etc/resolv.conf`。
- `/etc/resolv.conf`：Linux 系统里的 DNS 解析配置文件，通常包含 `nameserver`、`search`、`options` 等配置。
- search domain：当应用访问短域名时，系统解析器会按 search 列表自动拼接后缀再尝试解析。
- hostAliases：K8S Pod 里的一个配置项，可以把指定 IP 和域名写入 Pod 的 `/etc/hosts`，适合临时绕过 DNS 问题，但不建议作为长期方案。

----- English
# K8S DNS Resolution Failure: Mike Checked DNS from End to End

## Background

After the previous `NotReady` incident on a K8S worker node, Mike's SRE team felt much more confident about monitoring this production cluster. It was not because the cluster would never fail again, but because the team had filled in many monitoring gaps:
- Node `Ready` status
- Pod scheduling failures
- kubelet and containerd status
- Remaining node resources
- Availability of key business APIs

With those checks in place, Mike felt a lot more at ease. During the post-incident review, he and his teammates once again realized how important effective monitoring is: "A broken K8S cluster is not the scariest thing. The scariest thing is that it is already broken, and the SRE team still has no idea."

Not long after that, K8S taught Mike another lesson. This time, all nodes were `Ready`, all Pods were `Running`, and the Deployment replica counts were normal. But the application running inside the cluster still could not be accessed.

Having been through similar incidents before, Mike once again started walking through the troubleshooting path. After a round of checks, the problem eventually pointed to an area people often overlook: DNS.

## 1. First DNS Incident: Service Name Resolution Suddenly Failed

### 1.1 The Application Started Reporting Errors

One morning, someone suddenly reported an issue in the business chat and asked the classic three questions: "The payment service keeps failing when calling the user service. Can the on-call SRE check what is wrong? What is the business impact? When can service be restored?"

After seeing the message, Mike immediately replied, "Checking now. Will update shortly!" His first reaction was to inspect the application service itself. He started with the user service Pods, which looked normal:

```bash
kubectl get pods -n user
NAME                        READY   STATUS    RESTARTS   AGE
user-api-6c9f7f8d5f-b2n9x   1/1     Running   0          3d
user-api-6c9f7f8d5f-jtq4p   1/1     Running   0          3d
user-api-6c9f7f8d5f-zk82m   1/1     Running   0          3d
```

Then he checked the corresponding Service and Endpoint. Both were normal as well:

```bash
kubectl get svc -n user
NAME       TYPE        CLUSTER-IP     EXTERNAL-IP   PORT(S)    AGE
user-api   ClusterIP   10.96.128.37   <none>        8080/TCP   120d

kubectl get endpoints user-api -n user
NAME       ENDPOINTS                                            AGE
user-api   10.244.2.31:8080,10.244.3.44:8080,10.244.4.19:8080   120d
```

Mike was puzzled. "The service is up, and the Endpoint exists. Why does the payment service say it cannot reach it? Surely the caller did not use the wrong address?" That seemed unlikely, because everything had worked before. The payment service Pods were also `Running`, with no recent updates or restarts.

### 1.2 Verifying from Inside the Application Pod

Mike did not rush to a conclusion. Instead, he entered one of the failing payment service Pods and tested the full Service domain directly to see whether he could reproduce the application error:

```bash
# Enter the Pod
kubectl exec -it payment-api-7b7b7df66c-p8m2q -n payment -- sh
# After entering the Pod, access the full Service domain directly
curl -v http://user-api.user.svc.cluster.local:8080/health
```

Instead of returning the health check response, the command hung for a while and then failed:

```bash
curl: (6) Could not resolve host: user-api.user.svc.cluster.local
```

He tried `nslookup` as well:

```bash
nslookup user-api.user.svc.cluster.local
;; connection timed out; no servers could be reached
```

At this point, half of the picture was clear. This was not an HTTP call failure, and the user service itself was not unavailable. The service name could not be resolved.

Mike's stomach tightened a little: "This is not an application problem. The cluster DNS is having trouble."

### 1.3 Confirming the DNS Service Address

Mike then checked the DNS configuration inside the Pod. It also looked fine:

```bash
cat /etc/resolv.conf
nameserver 10.96.0.10
search payment.svc.cluster.local svc.cluster.local cluster.local corp.example.com
options ndots:5
```

`nameserver 10.96.0.10` was the in-cluster `kube-dns` Service, which is the ClusterIP through which CoreDNS serves DNS queries.

So Mike exited the Pod and switched to the `kube-system` namespace to inspect CoreDNS, one of the cluster's core components:

```bash
kubectl get svc -n kube-system kube-dns
NAME       TYPE        CLUSTER-IP   EXTERNAL-IP   PORT(S)                  AGE
kube-dns   ClusterIP   10.96.0.10   <none>        53/UDP,53/TCP,9153/TCP   180d

kubectl get pods -n kube-system -l k8s-app=kube-dns -o wide
NAME                       READY   STATUS    RESTARTS   AGE   IP            NODE
coredns-6d4b75cb6d-7n6xs   1/1     Running   0          45d   10.244.1.12   worker-1
coredns-6d4b75cb6d-lp9kq   1/1     Running   0          45d   10.244.2.18   worker-2
```

Now Mike was even more confused. The `kube-dns` Service existed, and the CoreDNS Pods were `Running`. On the surface, the application Pods were normal, the application Service was normal, and the CoreDNS Pods were normal. Yet DNS queries were timing out.

### 1.4 `Running` Does Not Mean It Is Actually Working

Mike then checked the CoreDNS logs:

```bash
kubectl logs -n kube-system coredns-6d4b75cb6d-7n6xs
```

The logs contained many messages like this:

```bash
[ERROR] plugin/errors: 2 api.external.example.com. A: read udp 10.244.1.12:42531->10.10.10.10:53: i/o timeout
[ERROR] plugin/errors: 2 auth.external.example.com. A: read udp 10.244.1.12:48122->10.10.10.10:53: i/o timeout
```

These messages were external-domain lookup timeouts, but they pointed to a larger issue: CoreDNS was no longer just failing to resolve a few external domains. DNS queries were piling up overall, and response latency had risen sharply. Requests for in-cluster Service domains were also being delayed, which eventually showed up as timeouts when application Pods tried to access `user-api.user.svc.cluster.local`.

CoreDNS metrics confirmed that P99 query latency had spiked:

```bash
CoreDNS Query P99 Latency: 3.8s
CoreDNS Error Rate: 18%
CoreDNS QPS: 4.6k
```

Then he checked CoreDNS resource usage:

```bash
kubectl top pod -n kube-system | grep coredns
coredns-6d4b75cb6d-7n6xs   240m   165Mi
coredns-6d4b75cb6d-lp9kq   260m   172Mi
```

The CPU usage did not look outrageous by itself, but compared with the corresponding Grafana dashboard, it was clearly much higher than usual.

Mike then checked recent application-side changes and found that a service released that morning had generated a large number of requests for both external domains and internal service names in a short period of time. Once CoreDNS QPS was driven up, query latency and timeouts became obvious. Mike thought, "This is probably the direct cause of the timeouts, the elevated P99 latency, and the higher CPU usage we just saw."

### 1.5 Restarting CoreDNS First to Restore Service

Since CoreDNS had become a key bottleneck in the failure path, and many business calls were already affected, Mike decided to take the most direct recovery action first: perform a rolling restart of CoreDNS.

```bash
# Restart CoreDNS
kubectl rollout restart deployment coredns -n kube-system
# Then watch the CoreDNS Pods:
kubectl get pods -n kube-system -l k8s-app=kube-dns -w
```

After the new CoreDNS Pods all became `Running`, Mike entered the application Pod again, tested DNS, and then retried the health check:

```bash
# Test DNS
nslookup user-api.user.svc.cluster.local
Server:    10.96.0.10
Address 1: 10.96.0.10 kube-dns.kube-system.svc.cluster.local

Name:      user-api.user.svc.cluster.local
Address 1: 10.96.128.37 user-api.user.svc.cluster.local

# Access the health check
curl http://user-api.user.svc.cluster.local:8080/health
ok
```

Business calls gradually recovered, the error reports in the chat started to drop, and the fire was out.

## 2. Second Incident: This Time CoreDNS Was Not to Blame

### 2.1 A Familiar Error Returned

Some time later, a familiar report appeared in the business chat again: "The order service cannot access the inventory service." Remembering the previous incident, Mike's first reaction was, "Is CoreDNS broken again?"

But this time, he did not rush to restart CoreDNS. After the previous incident, the team had added CoreDNS monitoring. If CoreDNS was unhealthy, the alerts should have fired already.

Mike opened Grafana first:
- CoreDNS QPS was normal
- CoreDNS error rate was normal
- CoreDNS P99 latency was normal
- CoreDNS Pods had not restarted
- The `kube-dns` Service Endpoints were normal

After reviewing these metrics, Mike was even more puzzled. "The DNS service looks fine. So why does the application still say resolution is failing?"

### 2.2 Short Name Failed, Full Domain Worked

This time, Mike checked the error logs and saw the following message: `lookup inventory on 10.96.0.10:53: no such host`

The `inventory` value in the log looked like a short name. Mike then checked the order service deployment and confirmed that the application was indeed accessing the short name `inventory`. Next, he entered the failing order service Pod and continued checking:

```bash
# Enter the Pod
kubectl exec -it order-api-68f8d6f98f-j7x2p -n order -- sh

# Test the short name:
nslookup inventory
Server:    10.96.0.10
Address 1: 10.96.0.10 kube-dns.kube-system.svc.cluster.local

** server can't find inventory: NXDOMAIN
```

As expected, the short name failed to resolve. Naturally, Mike then tried the full domain:

```bash
nslookup inventory.prod.internal.example.com
Server:    10.96.0.10
Address 1: 10.96.0.10 kube-dns.kube-system.svc.cluster.local

Name:      inventory.prod.internal.example.com
Address 1: 10.20.30.41
```

The full domain resolved successfully. That changed the direction of the investigation. A general CoreDNS failure was now unlikely. If CoreDNS itself were broken, the full domain should have been affected too. Since the full domain worked but the short name did not, the problem was more likely in the resolver search path.

Mike stared at the terminal for a moment. "Maybe the DNS service is not broken this time. Maybe the resolver is simply not trying the right suffix."

### 2.3 Checking `/etc/resolv.conf` Inside the Pod

Mike inspected `/etc/resolv.conf` inside the Pod:

```bash
cat /etc/resolv.conf
nameserver 10.96.0.10
search order.svc.cluster.local svc.cluster.local cluster.local old.example.com legacy.example.com
options ndots:5
```

The problem was becoming clear. The application accessed the short name `inventory`, but the actual full domain was `inventory.prod.internal.example.com`.

That suffix was missing from the Pod's `search` list. In other words, when the application accessed `inventory`, the system resolver tried these names:

```bash
inventory.order.svc.cluster.local
inventory.svc.cluster.local
inventory.cluster.local
inventory.old.example.com
inventory.legacy.example.com
```

It never tried `inventory.prod.internal.example.com`, so CoreDNS had not failed to find the right name. It had never received a query in the right direction.

### 2.4 Why the Domain Was Missing from the Search List

Mike kept digging and found that this Pod was using the default DNS policy:

```yaml
dnsPolicy: ClusterFirst
```

With this configuration, kubelet generates the Pod's `/etc/resolv.conf` when the Pod is created. It usually includes the K8S internal search domains, such as:
- The Service domain for the current namespace
- `svc.cluster.local`
- `cluster.local`

In some environments, the DNS search configuration on the node is also merged into the Pod resolver configuration. So Mike logged in to the worker node where the Pod was running:

```bash
# Find the node where the Pod is running
kubectl get pod order-api-68f8d6f98f-j7x2p -n order -o wide
NAME                           READY   STATUS    IP            NODE
order-api-68f8d6f98f-j7x2p     1/1     Running   10.244.3.71   worker-2
# Log in to the node and inspect the config
ssh worker-2
cat /etc/resolv.conf
# Output:
nameserver 10.10.10.10
search old.example.com legacy.example.com
```

`prod.internal.example.com` was not there.

What made things worse was that, with the current OS and runtime combination, only a limited number of search domains could reliably take effect inside the Pod. In this environment, the Pod ultimately kept only five search domains. K8S put its three internal cluster search domains first, leaving room for only two internal company domains. If the node's search domain list carried historical baggage, the domain suffix that the application actually needed could easily be pushed out.

At this point, Mike had essentially confirmed the root cause:
- It was not a CoreDNS outage.
- It was not a Service with no Endpoint.
- It was not a Pod networking issue.

The Pod's `/etc/resolv.conf` was missing the search domain required by a business dependency.

### 2.5 Using `hostAliases` as a Temporary Fix

Although the root cause had been found, changing node DNS configuration, recreating Pods, and confirming the impact scope would all take time and needed a proper change window. Since the business was still seeing errors, Mike decided to apply a temporary fix for the critical service by adding `hostAliases` to the order service Deployment:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: order-api
  namespace: order
spec:
  template:
    spec:
      hostAliases:
        - ip: "10.20.30.41"
          hostnames:
            - "inventory"
            - "inventory.prod.internal.example.com"
```

After the configuration was saved, K8S recreated the Pod and wrote the domain names and IP specified by `hostAliases` into the Pod's `/etc/hosts`.

Once the new Pod was up and running, Mike entered it again to verify:

```bash
# Check /etc/hosts in the Pod
cat /etc/hosts
10.20.30.41 inventory inventory.prod.internal.example.com

# Test access
curl http://inventory:8080/health
ok
```

The critical business path recovered first. But Mike knew very well that `hostAliases` was only a temporary workaround, not the final solution. Its drawbacks were obvious:
- The IP address was hard-coded, so the service would fail again if the backend IP changed
- The domain-to-IP mapping was forced into `/etc/hosts`, which bypassed DNS instead of fixing it
- The configuration was scattered inside the application Deployment and could easily be forgotten later

### 2.6 Fixing `resolv.conf` on the Worker Nodes

After the temporary recovery, Mike planned the next step: adjust the DNS search configuration on the worker nodes.

He first compared `/etc/resolv.conf` across the relevant worker nodes:

```bash
# Log in to the node and inspect the config
cat /etc/resolv.conf
nameserver 10.10.10.10
search old.example.com legacy.example.com

# This node does not have prod.internal.example.com
# `old.example.com` has not been used by production services for a long time and can be replaced
```

Because this was a cluster node-level configuration change, Mike did not casually edit it online. He first confirmed the impact scope with the business team, then filed a change ticket and scheduled a change window. The ticket included:
- Change time: midnight on a selected day, outside peak business hours
- Summary: update DNS configuration for the production cluster
- Change steps:

1. Standardize `/etc/resolv.conf` on the relevant worker nodes.

```bash
# Before
nameserver 10.10.10.10
search old.example.com legacy.example.com

# After:
nameserver 10.10.10.10
search legacy.example.com prod.internal.example.com
```

2. After changing the configuration, restart the order service:

```bash
kubectl rollout restart deployment order-api -n order
```

3. After the new Pod starts, enter the Pod and confirm that `prod.internal.example.com` appears in the Pod's search list:

```bash
kubectl exec -it order-api-68f8d6f98f-x4m7c -n order -- sh
--- Enter the container
cat /etc/resolv.conf
nameserver 10.96.0.10
search order.svc.cluster.local svc.cluster.local cluster.local legacy.example.com prod.internal.example.com
options ndots:5
```

4. Verify the short name:

```bash
nslookup inventory
Server:    10.96.0.10
Address 1: 10.96.0.10 kube-dns.kube-system.svc.cluster.local

Name:      inventory.prod.internal.example.com
Address 1: 10.20.30.41
```

5. Verify the application's actual access path:

```bash
curl http://inventory:8080/health
ok
```

6. Confirm that short-name resolution has recovered and business access is normal.

7. Remove the temporary `hostAliases` entry from the Deployment and perform another rolling restart of the order service.

8. After all new Pods are up, confirm that `/etc/hosts` no longer contains a manually pinned `inventory` record, and that business access still works.

After the change was completed according to the ticket, short-name resolution recovered and `hostAliases` was removed.

## The Difference Between the Two DNS Incidents

Both incidents looked like "domain name resolution failures," but they were fundamentally different.

In the first incident, the DNS service itself had a problem:
- The CoreDNS Pods were still alive
- Query latency increased, and many requests timed out
- Service recovered after CoreDNS was restarted
- Follow-up work focused on CoreDNS capacity, monitoring, and alerting
- Fix complexity: low

In the second incident, the DNS resolution path was wrong:
- CoreDNS itself was healthy
- The full domain could be resolved
- The short name could not be resolved
- The root cause was that the Pod's `/etc/resolv.conf` was missing a required search domain
- `hostAliases` was used to stop the bleeding temporarily, and the final fix was to correct the worker node DNS search configuration
- Fix complexity: high

## Mike's Post-Incident Review

After these DNS incidents, Mike gained a new understanding of what "service availability" means in K8S.

In the past, when people troubleshot service call failures, they often followed this sequence:

1. Is the Pod `Running`?
2. Does the Service exist?
3. Are the Endpoints normal?
4. Is the network reachable?
5. Are there any application log errors?

After this incident, Mike pulled DNS out as its own checkpoint. In K8S, service calls often do not start with an IP address. They start with a name. If name resolution fails, everything after that is out of reach.

## Additional Notes

- CoreDNS: A common DNS service component inside K8S clusters. It resolves in-cluster Service domains and can also forward external domain queries.
- kube-dns Service: The Service that exposes DNS inside the cluster. In many clusters, its ClusterIP is written into each Pod's `/etc/resolv.conf`.
- `/etc/resolv.conf`: The Linux DNS resolver configuration file. It usually contains settings such as `nameserver`, `search`, and `options`.
- search domain: When an application accesses a short name, the system resolver automatically appends suffixes from the search list and tries to resolve each resulting name.
- hostAliases: A K8S Pod setting that writes specified IP and hostname mappings into the Pod's `/etc/hosts`. It is useful as a temporary DNS workaround, but is not recommended as a long-term solution.
