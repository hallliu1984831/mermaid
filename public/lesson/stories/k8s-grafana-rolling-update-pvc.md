# K8S 滚动升级也会翻车：小李踩了个升级的坑

## 故事背景

作为 SRE（Site Reliability Engineer），小李的日常工作除了处理告警，监控工具的维护也是重要的一部分。小李所在的 SRE 团队维护着公司内部的监控平台，主要的监控工具自然是主流的 Prometheus + Grafana 工具集：
- 时序数据采集：Prometheus
- 告警处理：Prometheus Alertmanager
- 可视化展示：Grafana
- 日志查询：Grafana Loki
- 其他工具

作为主流的监控工具，它们本身很成熟，但成熟不代表不用维护和升级。时间一长，工具的版本升级问题就逐渐浮出了水面：不久之前，小李就收到了工单，升级监控工具中的 Grafana 版本。
对小李来说，Grafana 可是再熟悉不过了，基本每天都会用到。作为公司内部监控平台的重要入口，平时大家查 Prometheus 指标、看业务大盘、排查接口延迟、确认发布影响，基本也都会打开 Grafana 的各种监控仪表盘。

所以这次升级前，小李心里并不紧张。之前做过功课的他，已经大致了解了 Grafana 的部署方式：
- 工具没有 CI 阶段，直接使用官方发布的版本
- 现有版本是通过 helm 来进行管理发布的
- Grafana 是以一个副本的方式运行在 K8S 集群中
- Grafana 使用了 K8S 的 Deployment 进行管理，使用了滚动升级的策略

基于已有的部署，小李很快就创建了工单，预约了操作时间。出于变更规范，他在工单里预留了 30 分钟操作窗口，但心里其实觉得这次应该不会真的中断这么久。

工单的操作步骤如下：
- 通知监控团队，Grafana 会进入变更窗口
- 登录到 K8S 集群，执行如下升级命令：
```bash
helm repo update
helm upgrade grafana grafana/grafana \
  -n monitoring \
  -f values-prod.yaml \
  --version 12.2.0
```
- 确认 Grafana 已经升级完成，然后通知监控团队，Grafana 已经可以使用了

小李当时想得很简单，按照 K8S 的滚动升级（rolling update）策略，应该不会对 Grafana 产生影响：
- 旧 Pod 先保留。
- 新 Pod 先启动。
- 新 Pod Ready 以后，再删除旧 Pod。
- 整个过程应该不会中断服务。

这不就是 RollingUpdate 最擅长的事情吗？很快到了预约操作的时间，生产环境的升级错误又给小李上了一课。

## 1. 升级开始：新 Pod 一直起不来

升级命令执行以后，小李先看 rollout 状态：

```bash
kubectl rollout status deployment/grafana -n monitoring
```

等了一会儿，命令迟迟没有返回成功。小李马上查看 Pod：

```bash
# 查看 Pod
kubectl get pods -n monitoring -l app=grafana -o wide

# 结果有点不对劲：
NAME                       READY   STATUS              RESTARTS   AGE
grafana-6f8b7c9b9d-km2xq    1/1     Running             0         320d
grafana-7c96d5f45b-r9p4s    0/1     ContainerCreating   0          3m
```

旧 Pod 还在正常运行，新 Pod 却一直卡在 `ContainerCreating`。刚开始，小李还没觉得问题很严重。因为滚动升级本来就是先让新 Pod 起起来，只要旧 Pod 还在，Grafana 入口暂时应该还能访问。

但这个状态持续了几分钟以后，小李开始意识到不对劲。想起来之前有 Pod 持续17分钟的 `ContainerCreating` 经历，小李觉得应该要及早介入检查。如果新 Pod 一直起不来，rollout 就会一直卡住。

## 2. 先看 Events：问题指向存储

小李先查看新 Pod 的详细信息：

```bash
# 查看 Pod 详情
kubectl describe pod grafana-7c96d5f45b-r9p4s -n monitoring

# 命令输出内容的 Events 里出现了类似这样的信息：
Warning  FailedMount  kubelet  Unable to attach or mount volumes:
unmounted volumes=[grafana-storage], unattached volumes=[grafana-storage]:
timed out waiting for the condition

Warning  FailedAttachVolume  attachdetach-controller
Multi-Attach error for volume "pvc-grafana-data":
Volume is already exclusively attached to one node and can't be attached to another
```

看到 `Multi-Attach` 的时候，小李心里大概有了方向：这不是镜像拉取失败，也不是 Grafana 配置写错，而是新 Pod 在挂载名为 grafana-storage 的存储卷的时候卡住了。看字面意思，是这块 volume 已经被旧 Pod 所在节点独占挂载，新 Pod 所在节点暂时无法再挂载。

小李继续查看 PVC 及其状态：

```bash
# 查看 PVC
kubectl get pvc -n monitoring

# 输出里可以看到 Grafana 使用的是一个持久化存储：
NAME              STATUS   VOLUME                                     CAPACITY   ACCESS MODES
grafana-storage   Bound    pvc-grafana-data                           10Gi       RWO

# 关键点在最后一列：RWO 也就是 `ReadWriteOnce`
ACCESS MODES: RWO
```
看到访问模式设置的 RWO（ReadWriteOnce） 和 `Multi-Attach` 后，根据已知信息，RWO 不是简单等于“只能一个 Pod 使用”，更准确地说，是这个卷通常只能被一个节点以读写方式挂载。小李心里马上有了一个判断：如果旧 Pod 和新 Pod 被调度到了不同节点，而旧 Pod 还占着这块 PVC，新 Pod 就可能挂载不上。

## 3. 小李顺着 PVC 往里看了一层
小李心想，如果上述判断正确的话， 那 RollingUpdate 在当前的这个场合就玩不起来了啊！
报错很清楚：新旧 Pod 无法共同使用一块存储！如果只是从 K8S 存储挂载的角度看，问题似乎已经找到了：旧 Pod 还在运行，新 Pod 又想挂同一块 RWO PVC，结果新 Pod 卡在了 `ContainerCreating`。

但小李又觉得哪里不太对：如果问题只是“新 Pod 挂不上 PVC”，那是不是把新旧 Pod 调度到同一个节点就可以了？或者反复删除新 Pod，多试几次，等它落到旧 Pod 所在节点就好了？

这个念头刚冒出来，小李自己先停了一下。因为他还没有确认一个更关键的问题：
- Grafana 为什么一定要挂这块 PVC？
- 这块 PVC 里到底放了什么？

为了澄清这个问题，小李决定先进入旧 Grafana Pod 看了一眼数据目录：

```bash
# 进入 Grafana Pod
kubectl exec -it grafana-6f8b7c9b9d-km2xq -n monitoring -- sh

# 查看数据目录
ls -lah /var/lib/grafana

# 目录里很快出现了几个让他在意的东西：
drwxr-xr-x    3 grafana grafana      4.0K plugins
drwxr-xr-x    2 grafana grafana      4.0K png
-rw-r--r--    1 grafana grafana      8.5M grafana.db
```

看到 `grafana.db` 这个文件，小李觉得就不能再只把它当成一个普通挂载目录了。指向很明确， `/var/lib/grafana` 里放的不只是一些可有可无的缓存文件，而是 Grafana 的本地数据库和运行状态。

他继续查看 Grafana 的 Deployment：

```bash
# 查看 Deployment
kubectl get deployment grafana -n monitoring -o yaml

# 关键配置大概是这样：
spec:
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  template:
    spec:
      containers:
        - name: grafana
          image: grafana/grafana:latest
          volumeMounts:
            - name: grafana-storage
              mountPath: /var/lib/grafana
      volumes:
        - name: grafana-storage
          persistentVolumeClaim:
            claimName: grafana-storage
```

这个配置看起来很熟悉：
- “maxSurge: 1” 表示升级时允许多起一个新 Pod。
- “maxUnavailable: 0” 表示升级过程中希望旧 Pod 不可用数量为 0，也就是尽量不中断服务。

对无状态 Web 服务来说，这个策略很合理。但 Grafana 这里有一个关键区别：它挂载了 `/var/lib/grafana`，也就是刚才看到 `grafana.db` 的那个目录。换句话说，这个目录里不仅可能包含 Grafana 的本地数据库，还可能包含插件和本地配置、会话等信息。

为了确认这个判断，小李又去翻了 Grafana 官方文档。很快就查到了如下结果：
- 官方文档里提到，Grafana 默认使用内嵌的 SQLite 数据库存储用户、Dashboard 和其他持久化数据，也就是当前看到的 `grafana.db` 文件等；
- 如果要做高可用，需要使用共享数据库，比如 MySQL 或 PostgreSQL；
- 默认 SQLite 并不是给多个 Grafana 实例共同读写使用的共享后端。

到这儿，小李心里基本明确了：
- 这次问题不是单纯的 PVC 挂载失败。
- 这个 Grafana 本质上就是一个带本地状态的应用。
- 在当前这种单副本 + 本地 PVC + SQLite 的部署方式下，不能直接套用 RollingUpdate。
- 滚动升级会让新旧 Pod 短时间并存，而单实例 Grafana 的本地状态存储并不支持这样做。

## 4. 操作窗口的时间到了
在小李忙碌的检查时，根据操作工单，操作窗口的时间所剩不多了。小李快速评估了当前的状态：
1. 旧的 Grafana Pod 还在运行，暂时不影响监控的正常访问。
2. 新 Pod 卡在 `ContainerCreating`，且无法使用滚动升级继续操作。

按照常理，操作应该在设定时间内正常完成升级，或者按照预定步骤回滚。但这次情况特殊：旧 Pod 仍然可访问，根因也已经比较明确。小李在变更群里同步了当前风险，申请延长操作窗口，继续完成这次升级。


## 5. 现场处理：先 scale 到 0，释放 PVC
接下来，他没有继续死磕 RollingUpdate，也没有再试图让新 Pod 和旧 Pod 同时存在。他的处理思路很直接：
- 先停旧 Pod。
- 释放 PVC。
- 再起新 Pod。

于是小李在键盘上飞快地敲击：
```bash
# 先把 Grafana scale 到 0
kubectl scale deployment grafana -n monitoring --replicas=0

# 然后确认旧 Pod 已经退出：
kubectl get pods -n monitoring -l app=grafana

# 确保命令输出为空

# 等旧 Pod 删除以后，重新 scale 到 1
kubectl scale deployment grafana -n monitoring --replicas=1

# 再看 Pod：
kubectl get pods -n monitoring -l app=grafana

# 输出恢复正常：
NAME                       READY   STATUS    RESTARTS   AGE
grafana-7c96d5f45b-r9p4s    1/1     Running   0          2m
```

Grafana 页面也可以正常打开。升级完成了！关闭工单以后，小李并没有觉得轻松。因为这次虽然升级成功了，但操作的过程不如预想的那么平滑；另一方面 Grafana 的后续升级并且需要找一个更稳妥的解决方案！

## 6. 复盘与总结：不是所有服务都适合 RollingUpdate
### 复盘
升级完成以后，小李重新整理了这次过程。他把第一条结论写得很直接：
- K8S 提供了 RollingUpdate，但 RollingUpdate 不是万能模板。

RollingUpdate 很适合这类服务：
- 无状态
- 多副本可以并存
- 新 Pod Ready 后就可以接流量
- 旧 Pod 删除前不会影响共享状态

但如果服务有这些特点，像这次升级的 Grafana，就要谨慎：
- 单实例
- 本地状态
- 本地 SQLite
- 独占 PVC
- 不支持多副本同时运行
- 启动时可能会做数据迁移

这类服务不是一定不能升级，而是升级策略要先看应用自己的状态模型。

另外，小李也明确了后续更合适的升级策略：对于当前这种单副本 Grafana，可以把 Deployment 的 `strategy` 配成 `Recreate`。

这样后续升级时，K8S 会先删除旧 Pod，再创建新 Pod，避免新旧实例同时争用同一份本地状态。如果这个 Deployment 是通过 Helm 管理的，就应该把对应的 `strategy` 配置写进 custom values，而不是每次临时手动处理。

### 总结

这次 Grafana 升级以后，小李对 K8S 滚动升级多了一层理解。他把这次踩坑总结成两句话：
- K8S 的 RollingUpdate 解决的是 Pod 替换顺序问题。
- 应用自己的状态模型，决定了它能不能安全地滚动升级。

同时，Grafana 作为监控系统， 它并不是旁观者，它自己也是生产系统。也需要合理的监控并升级，并有完备的升级方案。至于 Grafana 怎么真正做高可用，采集和告警链路又该怎么避免单点，那就是小李后面要考虑的问题了！

毕竟，对 SRE 来说，最尴尬的事情不是系统出问题，而是系统出问题的时候，监控也正好看不见。

## 参考
- Grafana: Set up Grafana for high availability  
  https://grafana.com/docs/grafana/latest/setup-grafana/set-up-for-high-availability/
- Grafana: Configure Grafana  
  https://grafana.com/docs/grafana/latest/setup-grafana/configure-grafana/

----- English
# K8S Rolling Updates Can Fail Too: Mike Hit an Upgrade Pitfall

## Background

As an SRE, or Site Reliability Engineer, Mike's daily work is not only about handling alerts. Maintaining the monitoring tools is also an important part of the job. Mike's SRE team maintains the company's internal monitoring platform, which mainly uses the mainstream Prometheus and Grafana stack:
- Time series data collection: Prometheus
- Alert handling: Prometheus Alertmanager
- Visualization: Grafana
- Log querying: Grafana Loki
- Other tools

These tools are mature and widely used, but maturity does not mean they no longer need maintenance or upgrades. After running for a long time, version upgrades gradually became something the team had to deal with. Not long ago, Mike received a change request to upgrade Grafana.

Grafana was something Mike knew very well. He used it almost every day. As an important entry point into the company's monitoring platform, people used Grafana dashboards to check Prometheus metrics, review business dashboards, investigate API latency, and confirm the impact of releases.

So before this upgrade, Mike was not too nervous. He had done some homework and roughly understood how Grafana was deployed:
- There was no CI stage for this tool. It used the official released version directly.
- The existing release was managed through Helm.
- Grafana was running as a single replica in the K8S cluster.
- Grafana was managed by a K8S Deployment and used the rolling update strategy.

Based on the existing deployment, Mike quickly created the change ticket and scheduled the operation window. According to the change process, he reserved a 30-minute operation window. But deep down, he felt the actual interruption should not be that long.

The operation steps in the ticket were:
- Notify the monitoring team that Grafana would enter a change window.
- Log in to the K8S cluster and run the upgrade command:

```bash
helm repo update
helm upgrade grafana grafana/grafana \
  -n monitoring \
  -f values-prod.yaml \
  --version 12.2.0
```

- Confirm that Grafana had been upgraded, then notify the monitoring team that Grafana was available again.

Mike's thinking at the time was simple. With the K8S rolling update strategy, Grafana should not be affected:
- Keep the old Pod running first.
- Start the new Pod.
- Once the new Pod becomes Ready, delete the old Pod.
- The whole process should not interrupt the service.

Isn't that exactly what RollingUpdate is good at?

Soon, the scheduled operation time arrived. Production taught Mike another lesson through this upgrade.

## 1. The Upgrade Started: The New Pod Would Not Come Up

After running the upgrade command, Mike first checked the rollout status:

```bash
kubectl rollout status deployment/grafana -n monitoring
```

After waiting for a while, the command still did not return successfully. Mike immediately checked the Pods:

```bash
# Check Pods
kubectl get pods -n monitoring -l app=grafana -o wide

# The result looked wrong:
NAME                       READY   STATUS              RESTARTS   AGE
grafana-6f8b7c9b9d-km2xq    1/1     Running             0         320d
grafana-7c96d5f45b-r9p4s    0/1     ContainerCreating   0          3m
```

The old Pod was still running normally, but the new Pod was stuck in `ContainerCreating`.

At first, Mike did not think the problem was serious. A rolling update is supposed to bring up the new Pod while keeping the old one alive. As long as the old Pod was still running, the Grafana entry point should still be available.

But after the status stayed like this for several minutes, Mike started to feel something was wrong. Remembering a previous case where a Pod stayed in `ContainerCreating` for 17 minutes, he decided to step in early. If the new Pod never came up, the rollout would remain stuck.

## 2. Check Events First: The Problem Pointed to Storage

Mike first inspected the new Pod:

```bash
# Check Pod details
kubectl describe pod grafana-7c96d5f45b-r9p4s -n monitoring

# The Events section showed something like this:
Warning  FailedMount  kubelet  Unable to attach or mount volumes:
unmounted volumes=[grafana-storage], unattached volumes=[grafana-storage]:
timed out waiting for the condition

Warning  FailedAttachVolume  attachdetach-controller
Multi-Attach error for volume "pvc-grafana-data":
Volume is already exclusively attached to one node and can't be attached to another
```

When Mike saw `Multi-Attach`, he had a rough direction. This was not an image pull failure, and it was not a Grafana configuration error. The new Pod was stuck while mounting the volume named `grafana-storage`. From the message, the volume had already been exclusively attached to the node where the old Pod was running, so the new Pod's node could not attach it.

Mike continued checking the PVC and its status:

```bash
# Check PVCs
kubectl get pvc -n monitoring

# The output showed that Grafana was using persistent storage:
NAME              STATUS   VOLUME                                     CAPACITY   ACCESS MODES
grafana-storage   Bound    pvc-grafana-data                           10Gi       RWO

# The key point is the last column: RWO, or ReadWriteOnce
ACCESS MODES: RWO
```

After seeing both the RWO access mode and the `Multi-Attach` error, Mike formed an initial judgment. RWO does not simply mean "only one Pod can use this volume." More accurately, it usually means the volume can be mounted as read-write by only one node. If the old Pod and the new Pod were scheduled to different nodes, and the old Pod was still holding the PVC, the new Pod could fail to mount it.

## 3. Mike Looked One Layer Deeper Into the PVC

Mike thought to himself: if that judgment was correct, then RollingUpdate would not work in this situation.

The error was clear enough: the old and new Pods could not use the same storage at the same time. If he only looked at it from the K8S storage-mounting perspective, the problem seemed to be found. The old Pod was still running, the new Pod wanted to mount the same RWO PVC, and the new Pod got stuck in `ContainerCreating`.

But Mike still felt something was missing.

If the problem was only that the new Pod could not mount the PVC, would it work if both Pods landed on the same node? Or could he delete the new Pod a few times and wait until it happened to be scheduled onto the node where the old Pod was running?

The thought had just come up when Mike stopped himself. He had not yet confirmed a more important question:
- Why does Grafana need this PVC in the first place?
- What exactly is inside this PVC?

To clarify that, Mike decided to enter the old Grafana Pod and inspect the data directory:

```bash
# Enter the Grafana Pod
kubectl exec -it grafana-6f8b7c9b9d-km2xq -n monitoring -- sh

# Check the data directory
ls -lah /var/lib/grafana

# A few things immediately caught his eye:
drwxr-xr-x    3 grafana grafana      4.0K plugins
drwxr-xr-x    2 grafana grafana      4.0K png
-rw-r--r--    1 grafana grafana      8.5M grafana.db
```

When Mike saw the `grafana.db` file, he could no longer treat this as just an ordinary mounted directory. The signal was clear: `/var/lib/grafana` did not only contain optional cache files. It contained Grafana's local database and runtime state.

He continued checking the Grafana Deployment:

```bash
# Check the Deployment
kubectl get deployment grafana -n monitoring -o yaml

# The key configuration looked roughly like this:
spec:
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  template:
    spec:
      containers:
        - name: grafana
          image: grafana/grafana:latest
          volumeMounts:
            - name: grafana-storage
              mountPath: /var/lib/grafana
      volumes:
        - name: grafana-storage
          persistentVolumeClaim:
            claimName: grafana-storage
```

This configuration looked familiar:
- `maxSurge: 1` means one extra new Pod is allowed during the upgrade.
- `maxUnavailable: 0` means the upgrade tries to keep the old Pod available, minimizing service interruption.

For a stateless web service, this strategy makes sense. But Grafana had one important difference: it mounted `/var/lib/grafana`, the same directory where Mike had just seen `grafana.db`. In other words, this directory could contain Grafana's local database, plugins, local configuration, sessions, and other state.

To confirm his understanding, Mike checked Grafana's official documentation. He quickly found a few important points:
- Grafana uses an embedded SQLite database by default to store users, dashboards, and other persistent data, which corresponds to the `grafana.db` file he had just seen.
- For high availability, Grafana needs a shared database such as MySQL or PostgreSQL.
- The default SQLite database is not a shared backend designed for multiple Grafana instances to read and write together.

At this point, Mike had a much clearer picture:
- This was not only a PVC mount failure.
- This Grafana instance was essentially a stateful application.
- With the current single-replica + local PVC + SQLite deployment model, RollingUpdate should not be applied directly.
- Rolling updates make old and new Pods coexist for a short time, but this single-instance Grafana's local state did not support that model.

## 4. The Operation Window Was Running Out

While Mike was investigating, the operation window in the change ticket was running low. He quickly evaluated the current situation:

1. The old Grafana Pod was still running, so monitoring access was not affected for now.
2. The new Pod was stuck in `ContainerCreating`, and the upgrade could not continue through rolling update.

Normally, the upgrade should either be completed within the scheduled window or rolled back according to the plan. But this case was special: the old Pod was still accessible, and the root cause was already fairly clear. Mike updated the change chat with the current risk, requested an extension of the operation window, and continued the upgrade.

## 5. On-Site Handling: Scale to 0 First, Release the PVC

At this point, Mike stopped fighting RollingUpdate and stopped trying to let the old and new Pods coexist. His approach was straightforward:
- Stop the old Pod first.
- Release the PVC.
- Start the new Pod.

Mike quickly typed the commands:

```bash
# First scale Grafana to 0
kubectl scale deployment grafana -n monitoring --replicas=0

# Then confirm that the old Pod has exited:
kubectl get pods -n monitoring -l app=grafana

# Make sure the command returns no Pods

# After the old Pod is deleted, scale back to 1
kubectl scale deployment grafana -n monitoring --replicas=1

# Check the Pod again:
kubectl get pods -n monitoring -l app=grafana

# The output returned to normal:
NAME                       READY   STATUS    RESTARTS   AGE
grafana-7c96d5f45b-r9p4s    1/1     Running   0          2m
```

The Grafana page opened normally again. The upgrade was complete.

After closing the change ticket, Mike still did not feel relaxed. The upgrade had succeeded, but the process had not been as smooth as he expected. More importantly, future Grafana upgrades needed a more reliable plan.

## 6. Post-Upgrade Review: Not Every Service Fits RollingUpdate

### Review

After the upgrade, Mike reviewed the process and wrote down the first conclusion very directly:

- K8S provides RollingUpdate, but RollingUpdate is not a universal template.

RollingUpdate works well for services like these:
- Stateless
- Multiple replicas can coexist
- A new Pod can receive traffic after it becomes Ready
- Removing the old Pod does not affect shared state

But for services with the following characteristics, like this Grafana deployment, the upgrade strategy needs extra care:
- Single instance
- Local state
- Local SQLite
- Exclusive PVC
- Multiple replicas are not supported at the same time
- Startup may perform data migration

These services are not impossible to upgrade. But the upgrade strategy must first consider the application's own state model.

Mike also identified a better long-term upgrade strategy for this current single-replica Grafana: configure the Deployment's `strategy` as `Recreate`.

With this strategy, K8S deletes the old Pod before creating the new Pod during future upgrades. This avoids old and new instances competing for the same local state. If the Deployment is managed through Helm, the corresponding `strategy` should be written into the custom values file instead of being handled manually every time.

### Summary

After this Grafana upgrade, Mike gained a deeper understanding of K8S rolling updates. He summarized the pitfall in two sentences:

- K8S RollingUpdate solves the order of Pod replacement.
- The application's own state model determines whether it can be safely upgraded that way.

At the same time, Grafana is part of the monitoring system. It is not just an observer; it is also a production system. It also needs proper monitoring, planned upgrades, and a reliable upgrade strategy. As for how Grafana should truly achieve high availability, and how the collection and alerting chain should avoid single points of failure, those are questions Mike will need to think about later.

After all, for an SRE, the most awkward thing is not that a system fails.

It is that when the system fails, monitoring happens to be unavailable too.

## References

- Grafana: Set up Grafana for high availability  
  https://grafana.com/docs/grafana/latest/setup-grafana/set-up-for-high-availability/
- Grafana: Configure Grafana  
  https://grafana.com/docs/grafana/latest/setup-grafana/configure-grafana/
