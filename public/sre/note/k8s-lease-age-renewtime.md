# K8S 节点的心跳？跳在哪儿？

在 K8S 集群中，一个节点如果突然断网，却没机会告诉集群：“我掉线了。” 这种场合，集群怎么知道它出了问题？

## 没有消息，也是一种消息

不少应用也要解决类似的问题。比如管理程序带着几个 worker 干活，它怎么知道哪个 worker 还在？一个常见办法是让 worker 隔一段时间报到。如果持续收不到报到消息，管理程序就会怀疑它失联。

这就是心跳的思路：不是等对方报告自己坏了，而是等不到它的下一次报告。不过，能报到也不代表它处理的每项工作都正常。

## K8S 的节点在哪里报到？

K8S 节点上的 kubelet 也会向控制面报告状态。除了更新 Node 的状态，它还会定期更新一个叫 `Lease` 的对象，作为更轻量的节点心跳记录。

这些节点 Lease 放在专门的 `kube-node-lease` namespace 中。明白这个概念以后，就可以到集群里看一眼，从最简单的 get 命令开始：

```console
$ kubectl get pods -n kube-node-lease
No resources found in kube-node-lease namespace.

$ kubectl get all -n kube-node-lease
No resources found in kube-node-lease namespace.
```

咋一看可能感觉有点奇怪，连 `all` 都查不到东西。文档说的心跳到底写到哪儿了？

## 一个看起来空着的 namespace

换成查 Lease，结果就不一样了。举例如下：

```console
$ kubectl get lease -n kube-node-lease
NAME       HOLDER     AGE
worker-a   worker-a   152d
worker-b   worker-b   152d
```

原来 namespace 并不空。
- `get pods` 查的是 Pod；
- `get all` 也只查一组常见资源，并非所有资源，Lease 不在其中。
- 每个节点通常有一个同名 Lease，`HOLDER` 列显示的就是节点名。

这里的 `AGE: 152d` 也容易误导人：它表示 Lease 对象创建了多久，不表示节点 152 天没报到。要看最近一次更新，就到对象定义里查 `renewTime`：

```bash
kubectl get lease worker-a -n kube-node-lease \
  -o jsonpath='{.spec.renewTime}{"\n"}'
```

隔一会儿再查一次，就能比较它是否向前更新。`renewTime` 在变化，说明 kubelet 最近还能向 API Server 报到，但不代表节点上所有服务都正常。

正常时，`Node.status` 和 Lease 都由 kubelet 更新。节点失联后，kubelet 的上报无法送达；控制面的 Node controller 发现心跳持续缺失，便会把 `Node.status` 中的 `Ready` 条件改为 `Unknown`。这个 `Unknown` 是控制面的判断，不是 kubelet 报告了“自己断网”。

## 再看 Lease 对象

乍一看，Lease 是“租约”。既然已经有了 Node 对象，为什么还需要它？

Node 的 `status` 记录着节点状态，也是一种心跳；频繁的报到则只需要回答一个更简单的问题：节点最近有没有报到？如果每次报到都去更新 Node 状态，节点多了，控制面就要处理大量状态更新。Lease 更轻量，kubelet 定期刷新其中的 `renewTime`，控制面据此判断节点是否还在持续报到。
这也是 K8S 官方文档所说的：用 Lease 传递心跳，能减轻大集群的更新开销。

“租约”还有一层意思：不能因为对象还在，就认定节点一直在线；关键是它有没有继续续期。Lease 也可用于组件选主，但这里的节点 Lease 只是在记录心跳，并不是给节点选一个“领导”。

## 一句话记住

节点失联时不会主动通知集群。kubelet 平时持续更新心跳记录，控制面收不到新的报告，才有线索判断节点可能失联。而那个看似空着的 namespace，存的不是 Pod，是 Lease。虽然它看着不怎么起眼，可是有大用处的！
