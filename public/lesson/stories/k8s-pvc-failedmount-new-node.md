----- Chinese
# K8S Pod 创建容器 17 分钟，还在 ContainerCreating？

## 故事背景

上周二，业务团队按计划部署一个新服务。CI/CD 跑完以后，发布群里却安静了很久，一直没有等到发布成功的消息。小李一度以为是不是自己电脑断网了。结果发现不是网络问题，而是大家都在等这个新服务启动，启动成功以后才能关闭发布工单。

这是一个新的报表服务 `report-api`：
- 用于生成库存和订单相关的运营报表。
- 连接数据库，读取数据，进而生成报表文件。所以 Deployment 通过 K8S secret 注入了数据库的账号密码。
- 服务依赖持久化存储，用来保存临时生成的报表文件，所以 Deployment 里挂载了一个 PVC。

发布刚开始时一切看起来都正常，CI/CD 流水线也没有报错。但过了好一会儿，发布团队的同学在群里发了一句：report-api 发布 17 分钟了，Pod 还没 Running！麻烦 SRE 帮忙看一下，是不是服务启动有问题？

小李看到“17 分钟”这几个字，心里先停了一下。如果只是普通 Java 服务启动慢，几分钟还能解释；如果 17 分钟还停在那里，就不能再简单理解成“应用还在启动”。更何况，Pod 没起来这件事，本身也分很多阶段：可能是没调度，可能是镜像没拉下来，也可能是容器运行环境还没准备好。

于是小李先在群里回复：我先看一下 Pod 状态和事件，稍后同步。

## 1. 新服务一直卡在 ContainerCreating

小李登录到集群以后，先看 Pod 状态：

```bash
kubectl get pods -n production | grep report-api
NAME                          READY   STATUS              RESTARTS   AGE
report-api-6b7f9c8d7c-kt92m   0/1     ContainerCreating   0          17m
```

Pod 已经创建了 17 分钟，但状态一直是 `ContainerCreating`。看到这个状态，小李心里先把几个方向分开了：
- 如果是应用启动后崩溃，通常会看到 `CrashLoopBackOff`
- 如果是镜像拉取失败，通常会看到 `ErrImagePull` 或 `ImagePullBackOff`
- 如果是调度失败，Pod 多半会停在 `Pending`
- 但现在是 `ContainerCreating`，说明调度已经完成，kubelet 正在节点上准备容器运行环境

小李之前看过很多 Crashloopbackoff， Imagepullbackoff，Pending 之类的状态，但这个 ContainerCreating 看起来不常见。于是小李试着看日志：

```bash
# 查看 POD log
kubectl logs report-api-6b7f9c8d7c-kt92m -n production

# 结果没有拿到有效日志：
Error from server (BadRequest): container "report-api" in pod "report-api-6b7f9c8d7c-kt92m" is waiting to start: ContainerCreating
```

这也进一步说明：应用进程还没有真正启动。这个时候继续盯应用日志没有意义，真正的现场要到 Pod 的 Events 里去找了。

## 2. Events 里出现 FailedMount

小李接着查看 Pod 详情：

```bash
# 描述 POD 详情
kubectl describe pod report-api-6b7f9c8d7c-kt92m -n production

# 在 Events 里，找到了关键信息：
Events:
  Type     Reason       Age                   From               Message
  ----     ------       ----                  ----               -------
  Normal   Scheduled    17m                   default-scheduler  Successfully assigned production/report-api-6b7f9c8d7c-kt92m to worker-new-07
  Warning  FailedMount  12s (x13 over 12m)    kubelet            MountVolume.SetUp failed for volume "pvc-f217921e-7e0b-46f5-8101-cf0b087763ce" : mount failed: exit status 32
```

这行 `FailedMount` 很关键。小李看到这里（mount failed: exit status 32），问题排查方向基本变了：这不是应用启动慢，也不是应用配置错了。Pod 卡在 `ContainerCreating`，是因为 kubelet 在准备 volume 挂载时失败了。

换句话说，容器还没启动，报表服务还没机会跑起来，问题已经卡在 PVC 挂载阶段。

## 3. 先确认 PVC 和 PV 是否正常

既然 Events 指向 volume 挂载失败，小李检查了服务的各项配置及其状态：

```bash
# 查看 PVC
kubectl get pvc -n production | grep report
NAME                 STATUS   VOLUME                                     CAPACITY   ACCESS MODES   STORAGECLASS   AGE
report-api-data      Bound    pvc-f217921e-7e0b-46f5-8101-cf0b087763ce   50Gi       RWX            nfs-sc         2h

# PVC 是 `Bound` 状态，看起来已经成功绑定到了 PV。接着看 PV：
kubectl get pv | grep f217921e
pvc-f217921e-7e0b-46f5-8101-cf0b087763ce   50Gi   RWX   Retain   Bound   production/report-api-data   nfs-sc   2h

# PV 也存在，绑定关系也没问题。继续查看 PVC 的详情：
kubectl describe pvc report-api-data -n production

# 关键部分如下：
Name:          report-api-data
Namespace:     production
StorageClass:  nfs-sc
Status:        Bound
Volume:        pvc-f217921e-7e0b-46f5-8101-cf0b087763ce
Access Modes:  RWX
Capacity:      50Gi
```

从这些信息看，PVC 和 PV 本身没有明显异常。存储资源已经分配出来了，K8S 控制面也完成了绑定。检查到这里，一切看着都还 OK，而且问题进一步缩小了：不是 PVC 没创建，也不是 PV 没绑定，而是 kubelet 在某个节点上执行挂载操作时 （mount） 失败。
小李有点懵：集群里的很多服务都有 PVC 的挂载，而且上个月才发布的另外一个服务也执行了 mount 操作，都没有失败，咋突然不行了？

## 4. 发现 Pod 落在新加的节点上

小李重新看了一眼 Pod 分布：

```bash
kubectl get pod report-api-6b7f9c8d7c-kt92m -n production -o wide
NAME                          READY   STATUS              RESTARTS   AGE   IP       NODE           NOMINATED NODE   READINESS GATES
report-api-6b7f9c8d7c-kt92m   0/1     ContainerCreating   0          17m   <none>   worker-new-07  <none>           <none>
```

Pod 被调度到了 `worker-new-07`。这个节点名让小李心里咯噔一下：因为他记得，平台团队前两天刚给这个生产集群扩容过一批 worker node，其中就有 `worker-new-07`。

为了确认不是自己记错，小李看了一下节点创建时间：

```bash
kubectl get nodes | grep worker-new-07
worker-new-07   Ready    <none>   2d    v1.27.8
```

节点是 `Ready`，但加入集群才 2 天。为了交叉对比，小李又看了几个已经正常运行、同样挂载 PVC 的 Pod：

```bash
kubectl get pods -n production -o wide | grep -E "report|file|export"
report-api-6b7f9c8d7c-kt92m    0/1   ContainerCreating   0   17m   <none>        worker-new-07
file-api-75d8b6f9c4-p7q2x      1/1   Running             0   6d    10.244.2.81   worker-03
export-api-8699f6d8c9-hk8m     1/1   Running             0   4d    10.244.4.16   worker-05
```

老节点上的类似服务都是正常的，只有这个新服务刚好落到了新节点上，而且挂载失败。这时候，小李的判断开始变得明确：问题很可能不是这个 PVC 本身，而是新节点还不具备正常挂载这类存储卷的能力。

## 5. 继续验证：问题是不是只发生在新节点

为了避免误判，小李没有立刻下结论。他先看了一下这个 Pod 使用的存储类型：

```bash
kubectl get pvc report-api-data -n production -o yaml | grep -A5 storageClassName
storageClassName: nfs-sc
volumeMode: Filesystem
volumeName: pvc-f217921e-7e0b-46f5-8101-cf0b087763ce
```

这个 PVC 使用的是 `nfs-sc`。于是小李检查集群里和存储相关的组件：

```bash
kubectl get pods -n kube-system | grep -E "csi|nfs"
nfs-csi-controller-6c88df7bb9-2ptkv   3/3   Running   0   15d
nfs-csi-node-4pq8s                    3/3   Running   0   15d
nfs-csi-node-8h6pt                    3/3   Running   0   15d
nfs-csi-node-mc92k                    3/3   Running   0   15d
nfs-csi-node-r7k2n                    3/3   Running   0   15d
```

控制面组件看起来正常。但小李注意到一个细节：DaemonSet 的 node 插件数量和当前节点数量似乎对不上。于是他继续查：

```bash
kubectl get ds -n kube-system | grep nfs-csi-node
nfs-csi-node   6   6   5   5   5   kubernetes.io/os=linux   15d
```

这里就有点不对了。集群里应该有 6 个 worker node，但 nfs-csi-node 的副本只有 5 个可用。于是他再看新节点上有没有对应的 CSI node Pod：

```bash
kubectl get pods -n kube-system -o wide | grep nfs-csi | grep worker-new-07
```

没有输出。这条线索和 `FailedMount` 对上了：新节点虽然是 `Ready`，但存储相关的节点插件或者挂载依赖并没有在这台机器上正常就绪。

## 6. 临时止血：先避开新节点

这时候业务还在等新服务上线，小李想到了两个临时止血方案：
1. 给新节点打上标签，再通过 `nodeAffinity` 或 `nodeSelector` 让这个 Pod 避开 `worker-new-07`。
2. 将整个新节点 cordon，避免新的 Pod 继续调度过去。

评估下来，选项1会增加额外的复杂度，而且如果新节点的问题没有解决，其他有挂载需求的新 Pod 还是会继续调度到 `worker-new-07`。
小李又检查了这个07节点上有没有其他正在运行的 Pod：

```bash
kubectl get pods -A -o wide | grep worker-new-07
production   report-api-6b7f9c8d7c-kt92m    0/1   ContainerCreating   0   17m   <none>        worker-new-07
kube-system  node-exporter-7m2kp             1/1   Running             0   2d    10.244.7.10   worker-new-07
kube-system  log-agent-p9x4c                 1/1   Running             0   2d    10.244.7.11   worker-new-07
monitoring   kube-state-metrics-6b8f9d7c7    1/1   Running             0   2d    10.244.7.13   worker-new-07
```

从输出看，新节点上只有一些基础 DaemonSet 和平台组件，暂时没有其他生产业务 Pod。真正卡住的业务 Pod 只有 `report-api`。于是，小李决定先把新节点临时 cordon，避免新的业务 Pod 继续调度过去：

```bash
kubectl cordon worker-new-07

# 命令输出
node/worker-new-07 cordoned
```

然后删除当前卡住的 Pod，让 Deployment 重新拉起一个新 Pod：

```bash
kubectl delete pod report-api-6b7f9c8d7c-kt92m -n production
pod "report-api-6b7f9c8d7c-kt92m" deleted
```

确认新的 Pod 被调度到了老节点后，执行各项检查：

```bash
# 检查最新调度
kubectl get pods -n production -o wide | grep report-api
report-api-6b7f9c8d7c-mx8q9   1/1   Running   0   2m   10.244.3.91   worker-04

# 再看日志：
kubectl logs report-api-6b7f9c8d7c-mx8q9 -n production

# 输出正常：
2026-06-02 10:41:18.221 INFO  ReportApiApplication - Starting ReportApiApplication
2026-06-02 10:41:24.386 INFO  ReportApiApplication - Started ReportApiApplication in 6.182 seconds

# 健康检查也恢复：
curl http://report-api.production.svc.cluster.local:8080/health
ok
```

小李松了一口气，先在群里同步：report-api 已经恢复启动，目前 Pod 已调度到老节点并正常 Running。初步判断是新加 worker node 上存储挂载能力没有就绪，导致 PVC 挂载失败。我会继续跟平台侧确认新节点配置。

## 7. 上报平台团队，确认新节点缺少存储挂载能力
临时恢复以后，小李继续整理证据，准备上报平台团队。他把几个关键点列了出来：
1. `report-api` Pod 长时间卡在 `ContainerCreating`
2. Pod Events 显示 `FailedMount`
3. PVC 和 PV 都是 `Bound`
4. Pod 被调度到两天前新增的 `worker-new-07`
5. 同类 PVC 挂载在老节点上正常
6. 新节点上没有正常运行对应的存储 node 插件

接着创建工单，上报信息大概如下：
```bash
问题现象：
production namespace 下 report-api Pod 持续 ContainerCreating，时长 17m+

关键事件：
MountVolume.SetUp failed for volume "pvc-f217921e-7e0b-46f5-8101-cf0b087763ce" : mount failed: exit status 32

当前判断：
PVC/PV 已 Bound，问题集中在 worker-new-07 的节点挂载阶段。
worker-new-07 是前两天新加节点，疑似 NFS CSI node 插件没有正常运行，节点侧 NFS 客户端依赖也可能未补齐。

临时处理：
已 cordon worker-new-07，并删除卡住的 Pod，使 report-api 调度到老节点恢复。
```

平台团队进一步检查后确认：`worker-new-07` 加入集群时，基础 kubelet 和网络配置已经完成，所以节点状态是 `Ready`；但这台新节点上的 NFS CSI node 插件没有正常运行，节点侧也缺少用于执行 NFS 挂载的客户端依赖。结果就是 kubelet 在执行 PVC 挂载时无法完成 `mount` 操作，最终报出了 `mount failed: exit status 32`。

这也解释了为什么节点看起来是正常的，但一旦 Pod 需要挂载 NFS 类型的 PVC，就会卡在 `ContainerCreating`。对于不依赖 PVC 的普通 Pod 来说，这个问题可能暂时不会暴露；但只要业务 Pod 需要挂载这类存储卷，新节点的缺陷就会立刻出现。

## 8. 最终修复：补齐新节点配置并重新验证
平台团队修复了 `worker-new-07` 上的存储挂载能力：先补齐 NFS 客户端依赖，再重新拉起 NFS CSI node 插件，最后检查新节点到存储服务的网络连通性。

修复后，小李执行如下操作，验证修复结果：

```bash
# 先确认存储插件已经在新节点上运行：
kubectl get pods -n kube-system -o wide | grep nfs-csi | grep worker-new-07
nfs-csi-node-x7m2p   3/3   Running   0   3m   10.244.7.12   worker-new-07

# 然后解除 cordon：
kubectl uncordon worker-new-07
node/worker-new-07 uncordoned
```

为了确认新节点真的可用，小李没有直接认为事情结束，而是在 `production` namespace 下创建了一个测试 Pod，挂载同类型 PVC 做验证。

```bash
# 创建测试 Pod 和 PVC
kubectl apply -f pvc-mount-test.yaml

# 测试 Pod 正常启动：
kubectl get pod pvc-mount-test -n production -o wide
NAME             READY   STATUS    RESTARTS   AGE   IP            NODE
pvc-mount-test   1/1     Running   0          1m    10.244.7.31   worker-new-07

# 进入容器检查挂载目录：
kubectl exec -it pvc-mount-test -n production -- sh
df -h | grep report

# 确保输出正常：
storage.example.com:/k8s/report-api   500G   120G   380G   25%   /data/report
```

这说明新节点已经具备正常挂载这类 PVC 的能力。最后，小李删除测试 Pod，并确认后续新建的业务 Pod 在新节点上也能正常启动。

## 9. 为什么这个问题容易误导人

这次问题看起来只是一个新服务部署失败，但它容易误导人的地方在于：Pod 状态是 `ContainerCreating`，不是一个非常具体的错误。

如果只从“服务没启动”这个角度看，很容易先怀疑：
- 应用启动慢
- 镜像问题
- 配置问题
- JVM 参数问题
- readiness probe 问题

但实际上，应用根本还没启动。真正的线索藏在 Events 里：

```bash
Warning  FailedMount  MountVolume.SetUp failed for volume ... mount failed: exit status 32
```

这行事件把排查方向从“应用问题”拉回到了“节点挂载问题”。

另一个容易误导人的点是：新节点是 `Ready`。但 `Ready` 只能说明 kubelet 能和控制面通信，节点基础状态满足调度条件。它不等于这个节点已经具备所有生产能力。对于真实生产环境来说，一个 worker node 至少还要验证：
- DNS 是否正常
- CNI 网络是否正常
- 镜像仓库是否可访问
- 日志采集是否正常
- 监控采集是否正常
- CSI / NFS / 存储挂载是否正常
- 安全策略和防火墙是否符合生产要求

这也是这次事故最值得记住的地方：节点 `Ready`，不代表业务一定能安全落上去。

## 10. 改进建议：新节点加入集群后要做准入验证

小李在复盘时提了一个问题：新节点加入集群以后，能不能只看 `kubectl get nodes` 里的 `Ready`？

答案显然是不够。

对于生产集群，新节点加入以后，至少应该有一套准入检查，而不是只确认 kubelet 注册成功。

### 操作规范

小李建议，新节点加入集群以后，先不要立刻承接生产业务 Pod，而是先执行一轮基础验证：

1. 确认节点状态为 `Ready`
2. 确认核心 DaemonSet 已经在新节点上正常运行
3. 确认 CNI 网络正常
4. 确认 DNS 解析正常
5. 确认镜像仓库拉取正常
6. 确认日志和监控采集正常
7. 确认常用 StorageClass 的 PVC 挂载正常

只有这些检查都通过以后，新节点才应该解除保护，正式承接业务流量。

### 最佳实践
更长期的做法，是把新节点准入做成自动化流程。比如：
- 新节点加入后先自动打上 `NoSchedule` taint
- 自动运行网络、DNS、镜像、存储、监控等 smoke test
- smoke test 全部通过后，再自动移除 taint
- 如果任一检查失败，保留 taint，并通知平台团队处理

这样可以避免一种很危险的情况：节点表面 `Ready`，但实际只有一部分能力可用。等业务 Pod 真正调度上去以后，问题才暴露出来。

这次的 `FailedMount` 只是其中一种表现。如果新节点缺的是 DNS 配置，可能表现为服务调用失败；如果缺的是镜像仓库访问，可能表现为 `ImagePullBackOff`；如果缺的是日志采集，可能表现为出了问题以后查不到日志。

## 补充说明

- `ContainerCreating`：表示 Pod 已经调度到节点，kubelet 正在准备容器运行环境，例如拉取镜像、创建 sandbox、挂载 volume 等。
- `FailedMount`：Pod Events 中常见的 volume 挂载失败事件，通常需要检查 PVC/PV、StorageClass、CSI 插件、节点挂载依赖和存储网络。
- PVC：PersistentVolumeClaim，Pod 申请持久化存储的方式。
- PV：PersistentVolume，集群中的实际存储资源。
- StorageClass：用于定义动态存储供应方式的资源，例如 NFS、CSI 云盘、Ceph、EBS 等。
- CSI Node Plugin：运行在每个 worker node 上的存储插件，负责节点侧的卷挂载和卸载。
- `kubectl cordon`：将节点标记为不可调度，新的 Pod 不会再调度到该节点。
- `kubectl uncordon`：解除节点不可调度状态，让节点重新参与调度。

----- English
# K8S Pod Spent 17 Minutes Creating a Container and Was Still ContainerCreating?

## Background

Last Tuesday, the business team deployed a new service as planned. After the CI/CD pipeline finished, the release group chat stayed quiet for a long time. No one posted the usual release success message. Mike even wondered if his own laptop had lost network connectivity. It turned out the network was fine. Everyone was simply waiting for the new service to start, because the release ticket could only be closed after the service came up.

This was a new reporting service called `report-api`:

- It generated operational reports for inventory and orders.
- It connected to the database, read data, and generated report files. The Deployment injected the database username and password through a K8S Secret.
- It depended on persistent storage to save temporary report files, so the Deployment mounted a PVC.

At first, the release looked normal. The CI/CD pipeline did not report any errors. But after quite a while, someone from the release team posted in the group chat: `report-api` has been releasing for 17 minutes, and the Pod is still not `Running`. Can SRE take a look? Is the service startup stuck?

When Mike saw "17 minutes," he paused for a moment. If it were just an ordinary Java service starting slowly, a few minutes might be understandable. But if it had been stuck for 17 minutes, he could no longer simply treat it as "the application is still starting." Besides, when a Pod does not come up, there are many possible stages involved: it may not have been scheduled, the image may not have been pulled, or the container runtime environment may not have been prepared.

So Mike replied in the group chat: I'll check the Pod status and events first, then update everyone.

## 1. The New Service Was Stuck in ContainerCreating

After logging into the cluster, Mike first checked the Pod status:

```bash
kubectl get pods -n production | grep report-api
NAME                          READY   STATUS              RESTARTS   AGE
report-api-6b7f9c8d7c-kt92m   0/1     ContainerCreating   0          17m
```

The Pod had been created for 17 minutes, but its status was still `ContainerCreating`. Seeing this status, Mike first separated a few possibilities in his head:

- If the application started and then crashed, he would usually see `CrashLoopBackOff`
- If the image pull failed, he would usually see `ErrImagePull` or `ImagePullBackOff`
- If scheduling failed, the Pod would most likely stay in `Pending`
- But now the status was `ContainerCreating`, which meant scheduling had completed, and kubelet was preparing the container runtime environment on the node

Mike had seen many statuses such as `CrashLoopBackOff`, `ImagePullBackOff`, and `Pending` before, but `ContainerCreating` was less common. So he tried checking the logs:

```bash
# Check Pod logs
kubectl logs report-api-6b7f9c8d7c-kt92m -n production

# No useful logs were returned:
Error from server (BadRequest): container "report-api" in pod "report-api-6b7f9c8d7c-kt92m" is waiting to start: ContainerCreating
```

This further confirmed that the application process had not really started yet. At this point, staring at application logs was not useful. The real scene had to be found in the Pod Events.

## 2. FailedMount Appeared in Events

Mike then described the Pod:

```bash
# Describe the Pod
kubectl describe pod report-api-6b7f9c8d7c-kt92m -n production

# In Events, he found the key information:
Events:
  Type     Reason       Age                   From               Message
  ----     ------       ----                  ----               -------
  Normal   Scheduled    17m                   default-scheduler  Successfully assigned production/report-api-6b7f9c8d7c-kt92m to worker-new-07
  Warning  FailedMount  12s (x13 over 12m)    kubelet            MountVolume.SetUp failed for volume "pvc-f217921e-7e0b-46f5-8101-cf0b087763ce" : mount failed: exit status 32
```

This `FailedMount` line was critical. When Mike saw `mount failed: exit status 32`, the direction of the investigation changed. This was not a slow application startup, and it was not an application configuration issue. The Pod was stuck in `ContainerCreating` because kubelet failed while preparing the volume mount.

In other words, the container had not started yet. The reporting service had not even had a chance to run. The problem was already stuck at the PVC mount stage.

## 3. First Confirm Whether the PVC and PV Were Normal

Since Events pointed to a volume mount failure, Mike checked the service configuration and status:

```bash
# Check PVC
kubectl get pvc -n production | grep report
NAME                 STATUS   VOLUME                                     CAPACITY   ACCESS MODES   STORAGECLASS   AGE
report-api-data      Bound    pvc-f217921e-7e0b-46f5-8101-cf0b087763ce   50Gi       RWX            nfs-sc         2h

# The PVC was Bound and seemed to have successfully bound to a PV. Then check the PV:
kubectl get pv | grep f217921e
pvc-f217921e-7e0b-46f5-8101-cf0b087763ce   50Gi   RWX   Retain   Bound   production/report-api-data   nfs-sc   2h

# The PV existed, and the binding relationship looked fine. Continue checking PVC details:
kubectl describe pvc report-api-data -n production

# Key fields:
Name:          report-api-data
Namespace:     production
StorageClass:  nfs-sc
Status:        Bound
Volume:        pvc-f217921e-7e0b-46f5-8101-cf0b087763ce
Access Modes:  RWX
Capacity:      50Gi
```

From this information, the PVC and PV themselves did not show any obvious problem. The storage resource had been provisioned, and the K8S control plane had completed the binding. Up to this point, everything still looked okay, and the scope narrowed further: the PVC was created, the PV was bound, but kubelet failed when performing the mount operation on a specific node.

Mike was a bit puzzled. Many services in the cluster mounted PVCs, and another service released last month also performed a mount operation without any issue. Why did it suddenly fail now?

## 4. The Pod Landed on a Newly Added Node

Mike looked again at where the Pod had been scheduled:

```bash
kubectl get pod report-api-6b7f9c8d7c-kt92m -n production -o wide
NAME                          READY   STATUS              RESTARTS   AGE   IP       NODE           NOMINATED NODE   READINESS GATES
report-api-6b7f9c8d7c-kt92m   0/1     ContainerCreating   0          17m   <none>   worker-new-07  <none>           <none>
```

The Pod had been scheduled to `worker-new-07`. That node name made Mike pause, because he remembered that the platform team had added a batch of worker nodes to this production cluster two days earlier, and `worker-new-07` was one of them.

To make sure he was not misremembering, Mike checked the node age:

```bash
kubectl get nodes | grep worker-new-07
worker-new-07   Ready    <none>   2d    v1.27.8
```

The node was `Ready`, but it had only joined the cluster two days ago. For comparison, Mike checked a few other running Pods that also mounted PVCs:

```bash
kubectl get pods -n production -o wide | grep -E "report|file|export"
report-api-6b7f9c8d7c-kt92m    0/1   ContainerCreating   0   17m   <none>        worker-new-07
file-api-75d8b6f9c4-p7q2x      1/1   Running             0   6d    10.244.2.81   worker-03
export-api-8699f6d8c9-hk8m     1/1   Running             0   4d    10.244.4.16   worker-05
```

Similar services on old nodes were running normally. Only this new service happened to land on the new node, and only this one failed to mount the volume. At this point, Mike's judgment became clearer: the problem was probably not the PVC itself. The new node might not yet have the ability to mount this type of storage volume correctly.

## 5. Continue Verifying Whether the Problem Was Specific to the New Node

To avoid jumping to conclusions, Mike first checked what storage type this Pod was using:

```bash
kubectl get pvc report-api-data -n production -o yaml | grep -A5 storageClassName
storageClassName: nfs-sc
volumeMode: Filesystem
volumeName: pvc-f217921e-7e0b-46f5-8101-cf0b087763ce
```

This PVC used `nfs-sc`. So Mike checked the storage-related components in the cluster:

```bash
kubectl get pods -n kube-system | grep -E "csi|nfs"
nfs-csi-controller-6c88df7bb9-2ptkv   3/3   Running   0   15d
nfs-csi-node-4pq8s                    3/3   Running   0   15d
nfs-csi-node-8h6pt                    3/3   Running   0   15d
nfs-csi-node-mc92k                    3/3   Running   0   15d
nfs-csi-node-r7k2n                    3/3   Running   0   15d
```

The control plane components looked normal. But Mike noticed a detail: the number of DaemonSet node plugin Pods did not seem to match the number of nodes. So he continued checking:

```bash
kubectl get ds -n kube-system | grep nfs-csi-node
nfs-csi-node   6   6   5   5   5   kubernetes.io/os=linux   15d
```

That looked wrong. The cluster should have had 6 worker nodes, but only 5 `nfs-csi-node` Pods were available. So he checked whether the new node had the corresponding CSI node Pod:

```bash
kubectl get pods -n kube-system -o wide | grep nfs-csi | grep worker-new-07
```

There was no output. This matched the `FailedMount` event: although the new node was `Ready`, the storage node plugin or mount dependency was not properly ready on that machine.

## 6. Temporary Mitigation: Avoid the New Node

At this point, the business team was still waiting for the new service to go live. Mike thought of two temporary mitigation options:

1. Add a label to the new node, then use `nodeAffinity` or `nodeSelector` to make this Pod avoid `worker-new-07`.
2. Cordon the entire new node to prevent new Pods from being scheduled there.

After evaluating the options, Mike chose the second one. The first option would add extra complexity, and if the new node problem was not fixed, other new Pods that needed storage mounts could still be scheduled to `worker-new-07`.

Mike also checked whether any other Pods were running on node 07:

```bash
kubectl get pods -A -o wide | grep worker-new-07
production   report-api-6b7f9c8d7c-kt92m    0/1   ContainerCreating   0   17m   <none>        worker-new-07
kube-system  node-exporter-7m2kp             1/1   Running             0   2d    10.244.7.10   worker-new-07
kube-system  log-agent-p9x4c                 1/1   Running             0   2d    10.244.7.11   worker-new-07
monitoring   kube-state-metrics-6b8f9d7c7    1/1   Running             0   2d    10.244.7.13   worker-new-07
```

From the output, the new node only had some basic DaemonSets and platform components. There were no other production business Pods. The only stuck business Pod was `report-api`. So Mike decided to temporarily cordon the new node to prevent more business Pods from being scheduled there:

```bash
kubectl cordon worker-new-07

# Command output
node/worker-new-07 cordoned
```

Then he deleted the stuck Pod so the Deployment could create a new one:

```bash
kubectl delete pod report-api-6b7f9c8d7c-kt92m -n production
pod "report-api-6b7f9c8d7c-kt92m" deleted
```

After confirming that the new Pod was scheduled to an old node, he ran several checks:

```bash
# Check the latest scheduling result
kubectl get pods -n production -o wide | grep report-api
report-api-6b7f9c8d7c-mx8q9   1/1   Running   0   2m   10.244.3.91   worker-04

# Check logs:
kubectl logs report-api-6b7f9c8d7c-mx8q9 -n production

# Output was normal:
2026-06-02 10:41:18.221 INFO  ReportApiApplication - Starting ReportApiApplication
2026-06-02 10:41:24.386 INFO  ReportApiApplication - Started ReportApiApplication in 6.182 seconds

# Health check recovered:
curl http://report-api.production.svc.cluster.local:8080/health
ok
```

Mike breathed a sigh of relief and updated the group chat: `report-api` has recovered and is now running on an old node. The initial judgment is that the newly added worker node does not yet have its storage mount capability ready, causing the PVC mount failure. I will continue confirming the new node configuration with the platform team.

## 7. Report to the Platform Team and Confirm the New Node Lacked Storage Mount Capability

After temporary recovery, Mike continued collecting evidence and prepared to report the issue to the platform team. He listed the key points:

1. The `report-api` Pod had been stuck in `ContainerCreating` for a long time
2. Pod Events showed `FailedMount`
3. Both the PVC and PV were `Bound`
4. The Pod was scheduled to `worker-new-07`, a node added two days earlier
5. Similar PVC mounts worked normally on old nodes
6. The corresponding storage node plugin was not running normally on the new node

Then he created a ticket. The report looked roughly like this:

```bash
Problem:
In the production namespace, report-api Pod has been stuck in ContainerCreating for 17m+

Key event:
MountVolume.SetUp failed for volume "pvc-f217921e-7e0b-46f5-8101-cf0b087763ce" : mount failed: exit status 32

Current judgment:
PVC/PV are Bound. The issue is concentrated in the mount phase on worker-new-07.
worker-new-07 was added two days ago. The NFS CSI node plugin may not be running normally, and the node-side NFS client dependency may also be missing.

Temporary action:
Cordoned worker-new-07 and deleted the stuck Pod, so report-api was rescheduled to an old node and recovered.
```

After further investigation, the platform team confirmed the issue: when `worker-new-07` joined the cluster, its basic kubelet and network configuration had been completed, so the node status was `Ready`. But the NFS CSI node plugin on this new node was not running normally, and the node also lacked the client dependency needed to perform NFS mounts. As a result, kubelet could not complete the PVC `mount` operation and eventually reported `mount failed: exit status 32`.

This also explained why the node looked normal, but any Pod that needed to mount an NFS-type PVC would get stuck in `ContainerCreating`. For ordinary Pods that did not depend on PVCs, the issue might not appear immediately. But as soon as a business Pod needed this type of storage volume, the new node's incomplete setup became visible.

## 8. Final Fix: Complete the New Node Configuration and Verify Again

The platform team fixed the storage mount capability on `worker-new-07`: they installed the missing NFS client dependency, restarted the NFS CSI node plugin, and checked network connectivity from the new node to the storage service.

After the fix, Mike ran the following checks:

```bash
# First confirm that the storage plugin is running on the new node:
kubectl get pods -n kube-system -o wide | grep nfs-csi | grep worker-new-07
nfs-csi-node-x7m2p   3/3   Running   0   3m   10.244.7.12   worker-new-07

# Then uncordon the node:
kubectl uncordon worker-new-07
node/worker-new-07 uncordoned
```

To make sure the new node was really usable, Mike did not consider the issue closed yet. He created a test Pod in the `production` namespace and mounted the same type of PVC for verification.

```bash
# Create the test Pod and PVC
kubectl apply -f pvc-mount-test.yaml

# The test Pod started normally:
kubectl get pod pvc-mount-test -n production -o wide
NAME             READY   STATUS    RESTARTS   AGE   IP            NODE
pvc-mount-test   1/1     Running   0          1m    10.244.7.31   worker-new-07

# Enter the container and check the mount directory:
kubectl exec -it pvc-mount-test -n production -- sh
df -h | grep report

# Confirm the output is normal:
storage.example.com:/k8s/report-api   500G   120G   380G   25%   /data/report
```

This showed that the new node could now mount this type of PVC correctly. Finally, Mike deleted the test Pod and confirmed that newly created business Pods could also start normally on the new node.

## 9. Why This Problem Is Misleading

At first glance, this looked like a new service deployment failure. What made it misleading was that the Pod status was `ContainerCreating`, which is not a very specific error.

If you only look at it as "the service did not start," it is easy to suspect:

- Slow application startup
- Image problems
- Configuration problems
- JVM parameter problems
- Readiness probe problems

But in reality, the application had not started at all. The real clue was hidden in Events:

```bash
Warning  FailedMount  MountVolume.SetUp failed for volume ... mount failed: exit status 32
```

This event changed the investigation direction from "application problem" back to "node mount problem."

Another misleading point was that the new node was `Ready`. But `Ready` only means kubelet can communicate with the control plane and that the node's basic condition satisfies scheduling requirements. It does not mean the node has every production capability ready. In a real production environment, a worker node should at least be verified for:

- DNS
- CNI networking
- Image registry access
- Log collection
- Monitoring collection
- CSI / NFS / storage mounting
- Security policies and firewall rules

This was the most important lesson from the incident: a node being `Ready` does not mean business workloads can safely land on it.

## 10. Improvement: New Nodes Need Admission Verification

During the post-incident review, Mike raised a question: after a new node joins the cluster, is it enough to only check `Ready` in `kubectl get nodes`?

The answer is clearly no.

For a production cluster, after a new node joins, there should be a set of admission checks instead of only confirming that kubelet has registered successfully.

### Operational Rules

Mike suggested that after a new node joins the cluster, it should not immediately take production business Pods. A basic verification round should run first:

1. Confirm the node is `Ready`
2. Confirm core DaemonSets are running normally on the new node
3. Confirm CNI networking works
4. Confirm DNS resolution works
5. Confirm image registry pulls work
6. Confirm log and monitoring collection work
7. Confirm commonly used StorageClasses can mount PVCs normally

Only after these checks pass should the new node be released to take business workloads.

### Best Practice

In the long run, the better approach is to automate new-node admission. For example:

- Automatically add a `NoSchedule` taint when a new node joins
- Automatically run network, DNS, image, storage, and monitoring smoke tests
- Remove the taint only after all smoke tests pass
- If any check fails, keep the taint and notify the platform team

This avoids a dangerous situation: a node looks `Ready`, but only part of its capabilities are actually usable. The problem is not exposed until a business Pod is scheduled there.

This `FailedMount` was only one possible symptom. If the missing piece on the new node were DNS configuration, the symptom might be service call failure. If it were image registry access, it might show up as `ImagePullBackOff`. If it were log collection, the issue might only appear when something goes wrong and no logs can be found.

## Additional Notes

- `ContainerCreating`: Indicates that the Pod has been scheduled to a node, and kubelet is preparing the container runtime environment, such as pulling the image, creating the sandbox, and mounting volumes.
- `FailedMount`: A common Pod Event for volume mount failures. It usually requires checking PVC/PV, StorageClass, CSI plugins, node-side mount dependencies, and storage network connectivity.
- PVC: PersistentVolumeClaim, the way a Pod requests persistent storage.
- PV: PersistentVolume, the actual storage resource in the cluster.
- StorageClass: A resource that defines dynamic storage provisioning, such as NFS, CSI cloud disks, Ceph, EBS, and similar backends.
- CSI Node Plugin: A storage plugin that runs on each worker node and handles node-side volume mount and unmount operations.
- `kubectl cordon`: Marks a node as unschedulable, so new Pods will no longer be scheduled to that node.
- `kubectl uncordon`: Removes the unschedulable state and allows the node to participate in scheduling again.
