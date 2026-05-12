----- Chinese
# K8S工作节点 NotReady：小李的一次被动救火

## 故事背景
最近，小李所在的 SRE 团队接手了一套新的生产环境 K8S 集群。这个集群规模不算大，但承载的是对外服务，稳定性要求一点都不低。

为了维护好这个“烫手山芋”，小李和小伙伴们一起对这个集群做了初步的评估、检查和监控梳理。

### 集群拓扑
集群的整体拓扑很清晰：
- 3 个 master 节点，负责控制面管理，每个节点的配置都是8核16G
- 4 个 worker 节点，负责承载业务 Pod，每个节点的配置都是16核64G
小李当时看完拓扑图，心里还挺踏实：
"3 个 master 做高可用，4 个 worker 跑业务，怎么说也算比较标准了。只要资源别压得太满，日常应该问题不大。"

### 集群及服务的监控
- 集群每个节点都安装了 telegraf，定时收集 CPU、内存、硬盘、网络等宿主机基础监控数据，并由 prometheus 配置扫描 job 来抓取这些 telegraf 暴露出来的指标
- 集群中运行服务的 HTTP 指标，通过 prometheus 配置的 target 来定时收集
- 可能是还未有业务负载，集群的资源使用量不高。
- 在 alert manager 中配置了报警规则，当节点的 CPU、内存、硬盘、网络等基础监控数据超过阈值时，会发送报警至监控系统

初步监控完成后，新的生产环境就上线并开门营业了。

## 第一步：平静运行的表象

在最初的一段时间里，这套集群运行得还算稳定。小李平时偶尔会做一些例行检查，比如看看节点状态、Pod 状态，以及各个 namespace 里的资源分布：

```bash
kubectl get nodes
NAME            STATUS   ROLES           AGE    VERSION
master-1        Ready    control-plane   180d   v1.28.3
master-2        Ready    control-plane   180d   v1.28.3
master-3        Ready    control-plane   180d   v1.28.3
worker-1        Ready    <none>          180d   v1.28.3
worker-2        Ready    <none>          180d   v1.28.3
worker-3        Ready    <none>          180d   v1.28.3
worker-4        Ready    <none>          180d   v1.28.3
```

看着整整齐齐的 `Ready`，小李也没多想："节点都在线，业务也没报警，先这样吧。"

## 第二步：先出问题的，不是节点状态，而是业务

有一天上午，业务群里突然热闹了起来。

先是内部同事在群里问：
"怎么有几个页面一直打不开？"

没过多久，客户侧也反馈：
"服务访问异常，重试以后还是失败。"

收到消息后，小李赶紧介入排查。按照以往经验，他第一反应并不是直接去看节点，而是先看业务 Pod 是否正常。结果一查，果然已经出现了异常：

```bash
kubectl get pods -A | grep -E "Pending|Unknown|Evicted|Terminating"
payment/payment-api-7db6c7b9c8-8m9wd         0/1   Pending    0   4m
order/order-worker-68f8d6f98f-j7x2p          0/1   Pending    0   4m
gateway/gateway-5bb7fc4b9c-p2mkg             0/1   Pending    0   3m
recommend/recommend-api-746f76b6b8-bkq4z     0/1   Pending    0   3m
```

小李皱了皱眉：“奇怪，怎么一下子多了这么多 Pending？”

继续看调度失败详情，问题开始浮出水面：

```bash
kubectl describe pod payment-api-7db6c7b9c8-8m9wd -n payment
...
Events:
  Warning  FailedScheduling  2m  default-scheduler  0/3 nodes are available:
  1 node(s) were unschedulable,
  2 Insufficient cpu,
  2 Insufficient memory.
```

看到这里，小李心里已经有了不好的预感："不是单个 Pod 配置有问题，而是集群层面出了状况。"

这时候，他才把视线转向节点状态。

## 第三步：顺着 Pod 异常，定位到工作节点 NotReady

小李接着执行了最常规、也最关键的一条命令：

```bash
kubectl get nodes
NAME            STATUS     ROLES           AGE    VERSION
master-1        Ready      control-plane   180d   v1.28.3
master-2        Ready      control-plane   180d   v1.28.3
master-3        Ready      control-plane   180d   v1.28.3
worker-1        Ready      <none>          180d   v1.28.3
worker-2        Ready      <none>          180d   v1.28.3
worker-3        NotReady   <none>          180d   v1.28.3
worker-4        Ready      <none>          180d   v1.28.3
```

“坏了，掉了一个 worker 节点。” 小李当时心里一沉。

再进一步看节点详情，问题就更明显了：

```bash
kubectl describe node worker-3
...
Conditions:
  Type             Status    LastHeartbeatTime                 Reason
  Ready            False     2026-04-28T09:13:11Z             KubeletNotReady
  MemoryPressure   Unknown   2026-04-28T09:12:58Z             NodeStatusUnknown
  DiskPressure     Unknown   2026-04-28T09:12:58Z             NodeStatusUnknown
...
Events:
  Warning  NodeNotReady  3m    node-controller  Node worker-3 status is now: NodeNotReady
```

从现象上看，控制面已经收不到这个节点上 kubelet 的正常心跳了。此时能看到的是 `KubeletNotReady` 这个表象，但随着后续排查推进，团队最终确认：这次节点 `NotReady` 的直接原因并不是 kubelet 本身，而是节点上的 `containerd` 服务异常，进一步连带导致 kubelet 无法正常上报状态。

但此时更紧急的问题不是“为什么坏”，而是“坏了以后业务顶不顶得住”。

## 第四步：节点掉了，资源也跟着紧张了

按理说，少一个 worker 节点，不应该立刻把业务打趴下。

可小李很快发现，这个集群的资源余量其实比想象中更紧。随着业务负载的缓慢增加，之前使用率并不高的集群慢慢忙碌了起来。原来普遍只跑 1～2 个 Pod 的服务，不少已经 scale 到了 4 个，有的甚至更多。平时 4 个 worker 节点一起分担负载，大家看起来都还能跑；一旦少掉 1 个，可调度空间立刻就被挤爆了。

小李这下彻底明白了：

- `worker-3` 已经 `NotReady`，节点上的 Pod 实际上无法继续稳定提供服务
- 剩下 3 个 worker 节点虽然还活着，但资源余量不足
- 新建出来的替代 Pod 想调度到别的节点，结果发现 CPU 和内存都不够

这就形成了一个非常典型、也非常危险的局面：

一个工作节点故障，本来只是一台机器的问题；但因为集群没有足够冗余，最终演变成了业务容量下降，Pod 起不来，服务对外不可用。

小李盯着 `Pending` 的 Pod 列表，忍不住嘀咕："这不是单点故障了，这是故障放大。"

## 第五步：最尴尬的地方，不是故障本身，而是没人第一时间发现

更让小李难受的是，这个问题并不是团队自己先发现的。

SRE 团队当时并没有针对 K8S 节点状态建立完善的监控和告警机制：

- 没有针对 `Node NotReady` 的告警
- 没有针对节点资源余量的持续观察
- 没有针对调度失败数量的异常告警
- 也没有从节点层面去监控 kubelet、container runtime 等关键组件

所以这次故障发生后，团队并没有在第一时间收到报警。

真正让大家介入的，是客户投诉。

事后复盘时，小李对这段印象特别深："节点已经 NotReady 了，Pod 也已经 Pending 了，服务容量也掉了，但我们居然是等客户来告诉我们服务挂了。这个顺序本身就说明监控体系有漏洞。"

## 第六步：紧急修复 NotReady 节点

定位到故障中心后，小李和同事先集中处理 `worker-3`。

他们的排查思路很直接：

1. 登录宿主机检查系统状态
2. 检查 kubelet 是否正常
3. 检查容器运行时是否正常
4. 检查节点到 control-plane 的网络连通性

现场命令大概如下：

```bash
ssh worker-3

systemctl status kubelet
systemctl status containerd

journalctl -u kubelet -n 100
journalctl -u containerd -n 100
```

很快，他们确认这个节点上的 `containerd` 服务异常，就是这次节点 `NotReady` 的直接原因。正是因为 `containerd` 先出了问题，才进一步导致 kubelet 无法稳定向 apiserver 上报状态。查看日志时，还能看到类似这样的报错：

```bash
journalctl -u containerd -n 20
...
level=error msg="failed to handle container task" error="transport is closing"
------
journalctl -u kubelet -n 20
...
failed to run Kubelet: validate service connection: CRI v1 runtime API is not implemented
```

问题确认后，大家重新拉起相关服务，并确认节点恢复心跳：

```bash
systemctl restart containerd
systemctl restart kubelet
```

过了一会儿，小李再次查看节点状态：

```bash
kubectl get nodes
NAME            STATUS   ROLES           AGE    VERSION
master-1        Ready    control-plane   180d   v1.28.3
master-2        Ready    control-plane   180d   v1.28.3
master-3        Ready    control-plane   180d   v1.28.3
worker-1        Ready    <none>          180d   v1.28.3
worker-2        Ready    <none>          180d   v1.28.3
worker-3        Ready    <none>          180d   v1.28.3
worker-4        Ready    <none>          180d   v1.28.3
```

接着，那些之前因为资源不足而 `Pending` 的 Pod，也开始重新调度并恢复运行。对外服务也逐步恢复。

看到业务恢复后，小李总算松了口气："火是灭掉了，还要继续打扫战场。"

## 第七步：复盘才是重点

事故结束后，小李没有急着把这个 case 归档，而是拉着团队做了一次比较认真的事后总结。

他把问题拆成了两个层面：

### 1. 监控缺失

这次故障之所以会拖到客户投诉才介入，核心原因是节点监控不完整。最初建设的监控更多还是停留在“宿主机基础资源”层面和应用层面，比如接口可用率、响应时间、容器重启次数这些指标。小李和团队并没有把 K8S 节点状态、调度余量、kubelet 心跳、Pod 调度失败这类更贴近集群运行状态的指标纳入重点观察范围。虽然大家都默认 K8S 节点层面的健康度“很重要”，但监控并没有覆盖 `Node Ready` 状态、调度余量和 kubelet 可达性这些关键视角。

于是，小李推动团队补上了节点侧可观测性建设：

- 补充采集 kubelet 暴露的 cAdvisor 指标
- 在集群中安装 `metrics-server`
- 在 Prometheus 中增加对节点和 kubelet 的采集与监控

补齐后的监控目标包括但不限于：

- 节点是否 `Ready`
- 节点 CPU / 内存 / 文件系统使用率
- kubelet 是否可达
- Pod 调度失败数量
- 节点可分配资源与实际使用资源的差值
- 节点 allocatable、requests、实际 usage 之间的余量关系

小李还专门加了几条更实用的告警思路：

```yaml
- alert: K8SNodeNotReady
  expr: kube_node_status_condition{condition="Ready",status="true"} == 0
  for: 2m

- alert: K8SNodeResourcePressure
  expr: (1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)) > 0.9
  for: 5m

- alert: K8SPodSchedulingFailure
  expr: increase(scheduler_schedule_attempts_total{result="unschedulable"}[5m]) > 5
  for: 0m
```
TIPS:
- `kube_node_status_condition` 来源于 `kube-state-metrics`，用于反映 Kubernetes Node 对象的状态条件，例如 `Ready`、`MemoryPressure`、`DiskPressure` 等。
- `node_memory_MemAvailable_bytes` 和 `node_memory_MemTotal_bytes` 来源于 `node_exporter` 的 `meminfo` 采集器，反映节点操作系统层面的内存可用量和总内存。
- `scheduler_schedule_attempts_total` 来源于 `kube-scheduler` 组件自身暴露的 `/metrics` 指标，用于统计 Pod 调度尝试结果，其中 `result="unschedulable"` 可用于判断调度失败是否在增加。

小李心想："至少以后再有节点掉线，不能再等客户打电话了。"

### 2. 容错率不足

另一个问题也很现实：4 个 worker 节点看起来不少，但在这套业务负载下，其实冗余不够。

因为现网 Pod 的资源申请比较保守，很多 workload 平时就把节点资源吃得比较满。一旦损失一个 worker 节点，剩余节点根本没有足够的空间接住这些 Pod。

于是，团队最终做了一个很务实的动作：新增 1 个 worker 节点，提升集群容错能力

加节点以后，集群从原来的：

- 3 个 master
- 4 个 worker

变成了：

- 3 个 master
- 5 个 worker

这个动作不花哨，但很有效。它至少让集群在“坏掉一个 worker 节点”的情况下，不至于马上把容量打穿。

## 第八步：小李的总结

这次事故之后，小李对 K8S 集群的理解又深了一层。
- 节点会坏，而且坏起来并不稀奇
- 真正的问题不是节点坏，而是坏了以后你能不能第一时间知道
- 更关键的是，坏了一个节点以后，剩余资源能不能把业务兜住

小李后来把这次复盘记在了团队知识库里，并在末尾写下了一句感悟：真正决定稳定性的，是监控、容量余量和故障发生时的兜底能力。

----- English
# A K8S Worker Node Went NotReady: Mike's Firefight in Production

## Background

Recently, Mike's SRE team took over a new production Kubernetes cluster. The cluster was not especially large, but it was serving external traffic, so reliability mattered a lot.

To get this "hot potato" under control, Mike and his teammates did an initial round of assessment, health checks, and monitoring setup.

### Cluster Topology

The cluster layout looked straightforward:

- 3 master nodes for the control plane, each with 8 vCPUs and 16 GB of memory
- 4 worker nodes for running application Pods, each with 16 vCPUs and 64 GB of memory

After looking at the topology, Mike felt reasonably comfortable:

"Three masters for high availability, four workers for the workloads. That's a pretty standard-looking production setup. As long as resource usage doesn't get too tight, day-to-day operations should be fine."

### Cluster and Service Monitoring

- Each node had Telegraf installed to collect basic host-level metrics such as CPU, memory, disk, and network usage
- Prometheus was configured with scrape jobs to collect the metrics exposed by Telegraf
- HTTP metrics from the services running in the cluster were also collected by Prometheus
- Since business traffic was still light at the time, overall cluster resource consumption looked low
- Alertmanager had threshold-based alerts for host-level CPU, memory, disk, and network usage

With that initial monitoring setup in place, the new production environment officially went live.

## Step 1: Everything Looked Fine

For a while, the cluster ran smoothly.

Mike occasionally did routine checks, looking at node health, Pod status, and resource distribution across namespaces:

```bash
kubectl get nodes
NAME            STATUS   ROLES           AGE    VERSION
master-1        Ready    control-plane   180d   v1.28.3
master-2        Ready    control-plane   180d   v1.28.3
master-3        Ready    control-plane   180d   v1.28.3
worker-1        Ready    <none>          180d   v1.28.3
worker-2        Ready    <none>          180d   v1.28.3
worker-3        Ready    <none>          180d   v1.28.3
worker-4        Ready    <none>          180d   v1.28.3
```

Seeing a clean wall of `Ready`, Mike did not think much of it:

"All the nodes are up, nothing is alerting, looks good for now."

## Step 2: The First Symptom Wasn't the Node State. It Was the Business Impact.

One morning, the business chat channel suddenly got noisy.

An internal teammate asked:

"Why are some of the pages not loading at all?"

Not long after that, a customer also reported:

"The service is unreachable. Retrying doesn't help."

As soon as Mike saw the messages, he jumped into troubleshooting.

Based on experience, his first instinct was not to check the nodes. He started with the application Pods.

That was where the first clear sign appeared:

```bash
kubectl get pods -A | grep -E "Pending|Unknown|Evicted|Terminating"
payment/payment-api-7db6c7b9c8-8m9wd         0/1   Pending    0   4m
order/order-worker-68f8d6f98f-j7x2p          0/1   Pending    0   4m
gateway/gateway-5bb7fc4b9c-p2mkg             0/1   Pending    0   3m
recommend/recommend-api-746f76b6b8-bkq4z     0/1   Pending    0   3m
```

"That's odd. Why are there suddenly so many `Pending` Pods?"

Mike dug deeper into the scheduling failure details:

```bash
kubectl describe pod payment-api-7db6c7b9c8-8m9wd -n payment
...
Events:
  Warning  FailedScheduling  2m  default-scheduler  0/3 nodes are available:
  1 node(s) were unschedulable,
  2 Insufficient cpu,
  2 Insufficient memory.
```

At that point, he had a bad feeling:

"This isn't just a Pod-level misconfiguration. Something is wrong at the cluster level."

That was when he turned his attention to the nodes.

## Step 3: Tracing the Pod Failures Back to a NotReady Worker Node

Mike then ran one of the most basic and most important commands in Kubernetes troubleshooting:

```bash
kubectl get nodes
NAME            STATUS     ROLES           AGE    VERSION
master-1        Ready      control-plane   180d   v1.28.3
master-2        Ready      control-plane   180d   v1.28.3
master-3        Ready      control-plane   180d   v1.28.3
worker-1        Ready      <none>          180d   v1.28.3
worker-2        Ready      <none>          180d   v1.28.3
worker-3        NotReady   <none>          180d   v1.28.3
worker-4        Ready      <none>          180d   v1.28.3
```

"Uh-oh. We lost a worker node."

He immediately checked the node details:

```bash
kubectl describe node worker-3
...
Conditions:
  Type             Status    LastHeartbeatTime                 Reason
  Ready            False     2026-04-28T09:13:11Z             KubeletNotReady
  MemoryPressure   Unknown   2026-04-28T09:12:58Z             NodeStatusUnknown
  DiskPressure     Unknown   2026-04-28T09:12:58Z             NodeStatusUnknown
...
Events:
  Warning  NodeNotReady  3m    node-controller  Node worker-3 status is now: NodeNotReady
```

From the symptoms, the control plane was no longer receiving healthy kubelet heartbeats from that node.

At that point, all they knew was that the node was showing a `KubeletNotReady` symptom. As the investigation continued, however, the team ultimately confirmed that kubelet itself was not the original trigger. The direct cause of the node going `NotReady` was a failure in `containerd`, which then prevented kubelet from reporting healthy status back to the control plane.

But the more urgent question was no longer:

"Why did the node fail?"

It was:

"Can the rest of the cluster absorb the failure?"

## Step 4: The Real Problem Wasn't the Failed Node. It Was That the Rest of the Cluster Couldn't Absorb It.

At first glance, losing a single worker node does not sound like something that should immediately bring down a service.

But Mike quickly realized the cluster had much less spare capacity than it seemed.

As traffic gradually increased, the cluster that had once looked lightly utilized started getting busy. Services that used to run with only one or two replicas had already been scaled up to four, and some had even more.

With all four worker nodes available, the workloads still fit.

But the moment one worker disappeared, the remaining scheduling headroom collapsed.

At that point, the full chain of events became obvious:

- `worker-3` went `NotReady`
- The Pods that had been running on that node could no longer provide service reliably
- The controllers tried to create replacement Pods
- But the remaining three worker nodes did not have enough CPU and memory available to schedule them

What started as a single-node failure quickly turned into a much bigger problem:

- reduced service capacity
- replacement Pods stuck in `Pending`
- customer-facing impact

Looking at the list of `Pending` Pods, Mike muttered to himself:

"This isn't just a single-point failure anymore. It's failure amplification."

## Step 5: The Most Embarrassing Part Wasn't the Failure. It Was That We Didn't Catch It First.

What made this incident especially painful was that the team did not discover it first.

The real trigger for the investigation was customer complaints.

That stuck with Mike afterward.

Because by the time people started digging in, the failure signals were already there:

- the node was already `NotReady`
- Pods were already stuck in `Pending`
- service capacity had already dropped
- users were already affected

The problem was not that the team had no monitoring at all.

The problem was that they had never built monitoring around the signals that actually mattered for Kubernetes runtime health:

- no alert for `Node NotReady`
- no ongoing visibility into node scheduling headroom
- no alert for abnormal Pod scheduling failures
- no component-level monitoring for kubelet or the container runtime

That was why one line from the postmortem stayed with Mike:

"The node was already NotReady. The Pods were already Pending. Capacity had already dropped. And yet the first real signal we acted on was a customer telling us the service was down. That alone tells you the monitoring model had a hole in it."

## Step 6: Recovering the Failed Node

Once the team identified `worker-3` as the center of the problem, they focused on recovering it.

Their troubleshooting path was simple and practical:

1. Log into the host and check overall system health
2. Verify kubelet
3. Verify the container runtime
4. Check connectivity between the node and the control plane

The commands looked something like this:

```bash
ssh worker-3

systemctl status kubelet
systemctl status containerd

journalctl -u kubelet -n 100
journalctl -u containerd -n 100
```

They quickly confirmed that `containerd` on the node was unhealthy, and that this was the direct cause of the node going `NotReady`. Once `containerd` failed, kubelet could no longer maintain a healthy connection to the API server.

The logs showed errors like these:

```bash
journalctl -u containerd -n 20
...
level=error msg="failed to handle container task" error="transport is closing"

journalctl -u kubelet -n 20
...
failed to run Kubelet: validate service connection: CRI v1 runtime API is not implemented
```

After confirming the issue, they restarted the critical services:

```bash
systemctl restart containerd
systemctl restart kubelet
```

After a short wait, the node came back:

```bash
kubectl get nodes
NAME            STATUS   ROLES           AGE    VERSION
master-1        Ready    control-plane   180d   v1.28.3
master-2        Ready    control-plane   180d   v1.28.3
master-3        Ready    control-plane   180d   v1.28.3
worker-1        Ready    <none>          180d   v1.28.3
worker-2        Ready    <none>          180d   v1.28.3
worker-3        Ready    <none>          180d   v1.28.3
worker-4        Ready    <none>          180d   v1.28.3
```

And the `Pending` Pods finally started scheduling again:

```bash
kubectl get pods -A | grep Pending
# no output
```

Service availability gradually returned.

Mike finally exhaled.

But he also knew this only meant the fire was out.

The important part was what came next.

## Step 7: The Postmortem Mattered More Than the Recovery

After the incident, Mike and the team did a serious postmortem.

In the end, they realized the incident exposed two separate weaknesses.

### 1. Monitoring Gaps

The reason the issue dragged on until customers complained was simple: node monitoring was incomplete.

Their initial monitoring setup focused mostly on:

- host-level resource metrics
- application-level signals such as API availability, response time, and container restarts

But they were not watching the Kubernetes-native signals that really described cluster health:

- node state
- kubelet heartbeat health
- Pod scheduling failures
- scheduling headroom
- the relationship between `allocatable`, `requests`, and actual `usage`

So Mike pushed the team to improve observability around the node layer:

- collect kubelet/cAdvisor metrics
- install `metrics-server`
- add Prometheus scraping and dashboards for nodes and kubelet

After that, the team started tracking things like:

- whether a node is `Ready`
- node CPU, memory, and filesystem usage
- kubelet reachability
- the number of failed Pod scheduling attempts
- the difference between allocatable resources and actual consumption
- the remaining headroom between node `allocatable`, `requests`, and live `usage`

They also added more practical alerting rules:

```yaml
- alert: K8SNodeNotReady
  expr: kube_node_status_condition{condition="Ready",status="true"} == 0
  for: 2m

- alert: K8SNodeResourcePressure
  expr: (1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)) > 0.9
  for: 5m

- alert: K8SPodSchedulingFailure
  expr: increase(scheduler_pod_scheduling_attempts_total{result="unschedulable"}[5m]) > 5
  for: 0m
```

On the surface, that looked like "just adding more monitoring."

In reality, it fixed something much more important:

next time a node failed, the first alert should come from the system, not from a customer.

### 2. Not Enough Fault Tolerance

The second problem was just as real.

Four worker nodes may sound like enough.

But under this workload, they were not leaving enough safety margin.

Many workloads had conservative resource requests on paper, but there were simply too many of them already spread across the cluster. Under normal conditions, things still fit. But once one worker node disappeared, the remaining nodes had no room to catch the displaced Pods.

So the team took a simple and practical step:

- add one more worker node

After that, the cluster changed from:

- 3 masters
- 4 workers

to:

- 3 masters
- 5 workers

It was not flashy.

But it worked.

At the very least, losing one worker node would no longer immediately punch through the cluster's capacity limits.

## Step 8: What Mike Took Away From the Incident

After this incident, Mike's understanding of Kubernetes became much deeper.

- Nodes fail, and that is not unusual
- The real question is not whether a node can fail, but whether you will know immediately when it does
- Even more importantly, once a node fails, can the rest of the cluster still keep the business running?

Later, Mike documented the postmortem in the team's internal knowledge base and ended it with one takeaway:

What really determines stability is not the topology diagram by itself. It is monitoring, spare capacity, and the ability to absorb failure when it happens.
