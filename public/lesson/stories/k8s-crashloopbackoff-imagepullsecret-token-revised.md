----- Chinese
# K8S 生产环境一片 Pod Crash，告警刷屏了

某天上午，小李还在上班的路上，接到了告警电话，接着告警消息就开始在手机屏不上不断弹出，开始刷屏：
```text
ALERT: K8S Pod Restart Too Many Times
Namespace: production
Status: CrashLoopBackOff
```

小李大致看了下：不是一个服务，也不是两个服务，而是 `production` namespace 下好几个服务同时异常。看到这小李坐不住了，赶紧在最近的地铁站下车，就近找了个座椅支起电脑开始干活。

很快，小李打开终端开始检查：

```bash
kubectl get pod -n production
```

输出里一片异常：

```text
NAME                              READY   STATUS             RESTARTS   AGE
service-a-6f69fddc9f-7n2kq        0/1     CrashLoopBackOff   6          12m
service-a-6f69fddc9f-x8p2c        0/1     CrashLoopBackOff   5          12m
service-b-7d8f9c9b67-qz8h4        0/1     CrashLoopBackOff   6          13m
service-b-7d8f9c9b67-nt4kl        0/1     CrashLoopBackOff   5          13m
service-c-5f6f87db6b-m9x2p        0/1     ImagePullBackOff   0          14m
```

看到这场面，小李的第一反应是：这看起来不太像单个应用的代码问题啊！

一个应用因为代码 Bug 崩了很常见，但同一个 namespace 下多个服务一起异常，更像是共同依赖、共同配置或者底层环境出了问题。

于是，小李在群里回复：我暂时不做批量重启操作，先看看现场。

这个时候把所有 Pod 删一遍，看起来是在恢复服务，也可能顺手把现场证据一起清掉。

## 1. 满屏 Crash 里，有一个状态不一样

小李重新看了一遍异常列表，很快注意到一个细节：

```text
service-a   CrashLoopBackOff
service-b   CrashLoopBackOff
service-c   ImagePullBackOff
```

大部分 Pod 都是 `CrashLoopBackOff`，其中却夹着一个 `ImagePullBackOff`。

这两个状态看起来都像“Pod 没起来”，实际发生在不同阶段：

- `CrashLoopBackOff`：容器已经启动，但进程反复退出。
- `ImagePullBackOff`：镜像没有拉下来，容器还没真正启动。

不过，眼前毕竟是多个服务同时出问题。小李没有马上追着某一个 Pod 查，而是先从共性入手：

```text
先找共同点，再查单点。
```

## 2. 第一轮共性排查：是不是 NFS 出问题了？

这些服务中，有不少挂载了外部 NFS 存储。

如果 NFS 出了问题，确实可能同时影响多个服务。顺着这个思路，小李先检查 PVC：

```bash
kubectl get pvc -n production

## 输出
NAME                 STATUS   VOLUME                         ACCESS MODES   STORAGECLASS
service-a-data       Bound    pvc-1f8d7c1b-xxxx-5aa2a2f12345   RWX            nfs-sc
service-b-data       Bound    pvc-2a9e8d2c-xxxx-6bb3b3f67890   RWX            nfs-sc
shared-cache-data    Bound    pvc-3b0f9e3d-xxxx-7cc4c4a11111   RWX            nfs-sc
```

PVC 都是 `Bound`。不过，`Bound` 只能说明 PVC 和 PV 已经绑定，不能单凭这一项证明 NFS 一定正常。

小李接着查看异常 Pod 的 Events：

```bash
kubectl describe pod service-a-6f69fddc9f-7n2kq -n production

## 没有看到下面这些挂载错误：
FailedMount
MountVolume.SetUp failed
Unable to attach or mount volumes
```

而且 `service-a` 和 `service-b` 都是 `CrashLoopBackOff`，说明它们的容器至少已经启动过，只是进程很快退出。如果卷一直挂不上，Pod 更常见的状态会是 `ContainerCreating`。

综合这几条信息，小李暂时降低了 NFS 的优先级：

```text
PVC 已绑定，没有 FailedMount，容器也实际启动过。
NFS 不是第一嫌疑人。
```

## 3. service-a 指向 service-b，service-b 又指向 service-c

小李先挑了告警最频繁的 `service-a` 查看上一轮容器日志：

```bash
kubectl logs service-a-6f69fddc9f-7n2kq -n production --previous

## 日志里有一行很显眼：
ERROR Failed to initialize client for SERVICE_B_ENDPOINT
java.lang.IllegalStateException: service-b endpoint is not available
```

Deployment 的启动参数也证实了这层依赖：

```yaml
env:
- name: SERVICE_B_ENDPOINT
  value: "http://service-b.production.svc.cluster.local:8080"
```

`service-a` 可能只是被 `service-b` 拖下了水。

小李继续查看 `service-b` 的上一轮日志：

```bash
kubectl logs service-b-7d8f9c9b67-qz8h4 -n production --previous

## 结果又出现了相似的错误：
ERROR Failed to initialize dependency SERVICE_C_ENDPOINT
java.lang.IllegalStateException: service-c endpoint is not available
```

它的 Deployment 里同样配置了下游地址：

```yaml
env:
- name: SERVICE_C_ENDPOINT
  value: "http://service-c.production.svc.cluster.local:8080"
```

到这里，依赖链逐渐清楚了：

```text
service-a 启动失败，因为它依赖 service-b
service-b 启动失败，因为它依赖 service-c
```

真正应该继续追查的，是 `service-c`。

## 4. service-c 根本没有启动

小李回到最开始的 Pod 列表：

```text
service-c-5f6f87db6b-m9x2p   0/1   ImagePullBackOff   0   14m
```

`service-c` 和前两个服务不同。它不是启动后崩溃，而是连镜像都没有拉下来。

小李马上检查它的 Events：

```bash
kubectl describe pod service-c-5f6f87db6b-m9x2p -n production

## 关键线索很快出现了：
Warning  Failed   kubelet  Failed to pull image "registry.example.com/prod/service-c:v2.8.1":
rpc error: code = Unknown desc = failed to authorize:
failed to fetch oauth token: 401 Unauthorized

Warning  Failed   kubelet  Error: ErrImagePull
Warning  BackOff  kubelet  Back-off pulling image "registry.example.com/prod/service-c:v2.8.1"
Warning  Failed   kubelet  Error: ImagePullBackOff
```

看到 `401 Unauthorized`，排查方向一下收窄了: 这不是 `service-c` 的应用代码有问题，而是 kubelet 拉取镜像时没有通过 registry 认证。

## 5. 顺着 imagePullSecret 找到过期 token

小李查看 `service-c` 使用的 `imagePullSecrets`：

```bash
kubectl get deployment service-c -n production -o yaml

## 配置里显示了 imagePullSecrets：
....
spec:
  template:
    spec:
      imagePullSecrets:
      - name: registry-credential
....
```

接着查看这个 Secret：

```bash
kubectl get secret registry-credential -n production

## 输出
NAME                  TYPE                             DATA   AGE
registry-credential   kubernetes.io/dockerconfigjson   1      180d
```

Secret 类型没有问题，正是私有镜像仓库认证使用的 `kubernetes.io/dockerconfigjson`。

`AGE` 显示 180 天，但小李没有只凭这个数字下结论。`AGE` 代表 Secret 对象的创建时间，即使中途更新过内容，这个时间也不会重新计算。

他继续核对部署文档和平台侧的 token 信息，发现这份凭据来自人工生成的 registry token，而且 token 本身设置了有效期。

经过和平台同事进一步确认：registry token 已过期。

整条故障链终于串了起来：

```text
registry token 过期
  -> imagePullSecret 中的认证信息失效
  -> service-c 无法拉取镜像，进入 ImagePullBackOff
  -> service-b 启动时无法连接 service-c，进入 CrashLoopBackOff
  -> service-a 启动时无法连接 service-b，进入 CrashLoopBackOff
  -> production namespace 告警刷屏
```

表面上是一片服务 Crash，源头却是一份过期的镜像仓库凭据。

## 6. 更新 Secret，服务按依赖顺序恢复

平台同事重新生成 registry token 后，小李更新了 `production` namespace 下的 imagePullSecret：

```bash
kubectl create secret docker-registry registry-credential \
  --docker-server=registry.example.com \
  --docker-username=<username> \
  --docker-password=<new-token> \
  --docker-email=<email> \
  -n production \
  --dry-run=client -o yaml | kubectl apply -f -
```

`ImagePullBackOff` 状态下，kubelet 本来就会按照退避机制继续尝试拉取镜像。为了缩短等待时间，小李删除了当前失败的 `service-c` Pod，让 Deployment 立即创建新 Pod：

```bash
kubectl delete pod service-c-5f6f87db6b-m9x2p -n production

## 这一次，镜像拉取成功：
service-c-5f6f87db6b-r4x7m   1/1   Running   0   1m
```

随着 `service-b` 和 `service-a` 进入下一轮重启，它们的下游依赖已经恢复，状态也陆续变成 `Running`，随着告警逐渐消失，小李才在群里同步：

```text
服务已恢复。根因是 imagePullSecret 使用的 registry token 过期，
导致 service-c 镜像拉取失败。
service-b 和 service-a 是依赖链传导产生的 CrashLoopBackOff。
```
接着，小李收起电脑，站到站台前等待下一班开往公司的地铁。

## 7. 一个 token，为什么能拖垮一串服务？

这次故障中，过期 token 是直接原因，但它并不是告警刷屏的全部原因。

`service-b` 在启动时连接不到 `service-c`，便直接退出；`service-a` 连接不到 `service-b`，也选择退出。于是，一个服务无法拉取镜像，沿着启动依赖变成了三个服务一起异常。

复盘后，小李把经验收敛成了三点。

第一，多个服务同时异常时，先找共同点，但不要把所有异常状态当成一回事。

`CrashLoopBackOff` 应该重点查看应用日志和 `--previous` 日志；`ImagePullBackOff` 则应该优先查看 Pod Events、镜像地址和 registry 认证。满屏 Crash 中那个不一样的状态，很可能更接近根因。

第二，凭据不能只负责创建，还要负责整个生命周期。

registry token、证书、数据库密码和 API key 都应该有明确的负责人、过期提醒和更新机制。条件允许时，还应通过统一的 Secret 管理和自动轮换，减少长期依赖人工更新。

第三，看到的第一个错误，未必是最早发生的错误；最吵的告警，也未必来自根因。

这次满屏都是 `CrashLoopBackOff`，真正应该优先处理的，却是那个差点被忽略的 `ImagePullBackOff`。

----- English
# K8S Production Was Full of Crashing Pods, and the Alerts Wouldn't Stop

One morning, while Mike was still on his way to work, his phone rang with an alert. A moment later, notifications began popping up one after another across the screen:

```text
ALERT: K8S Pod Restart Too Many Times
Namespace: production
Status: CrashLoopBackOff
```

A quick glance told him that this was not one service or even two. Several services in the `production` namespace were failing at the same time. Mike got off at the next subway stop, found a nearby bench, and opened his laptop.

He quickly brought up a terminal and started checking the cluster:

```bash
kubectl get pod -n production
```

The output was full of failures:

```text
NAME                              READY   STATUS             RESTARTS   AGE
service-a-6f69fddc9f-7n2kq        0/1     CrashLoopBackOff   6          12m
service-a-6f69fddc9f-x8p2c        0/1     CrashLoopBackOff   5          12m
service-b-7d8f9c9b67-qz8h4        0/1     CrashLoopBackOff   6          13m
service-b-7d8f9c9b67-nt4kl        0/1     CrashLoopBackOff   5          13m
service-c-5f6f87db6b-m9x2p        0/1     ImagePullBackOff   0          14m
```

His first thought was, "This doesn't look like a bug in a single application."

One application crashing because of a code bug is common. Several services failing at once in the same namespace is more likely to point to a shared dependency, a shared configuration, or an infrastructure problem.

Mike sent a quick message to the team: "I'm not going to restart anything in bulk yet. Let me inspect the current state first."

Deleting every Pod might look like an attempt to restore service, but it could also destroy useful evidence before anyone understood what had happened.

## 1. One Pod Had a Different Status

Mike looked through the failed Pods again and noticed an important detail:

```text
service-a   CrashLoopBackOff
service-b   CrashLoopBackOff
service-c   ImagePullBackOff
```

Most of the Pods were in `CrashLoopBackOff`, but one was in `ImagePullBackOff`.

Both statuses mean that a Pod is not coming up successfully, but they occur at different stages:

- `CrashLoopBackOff`: The container started, but its process keeps exiting.
- `ImagePullBackOff`: Kubernetes could not pull the image, so the container never started.

Still, several services were failing at once. Instead of immediately focusing on one Pod, Mike started with the things they had in common:

```text
Look for shared dependencies first, then investigate individual failures.
```

## 2. First Shared Dependency to Check: NFS

Several of these services mounted external NFS storage.

An NFS failure could certainly affect multiple services at once, so Mike checked the PVCs first:

```bash
kubectl get pvc -n production

## Output
NAME                 STATUS   VOLUME                         ACCESS MODES   STORAGECLASS
service-a-data       Bound    pvc-1f8d7c1b-xxxx-5aa2a2f12345   RWX            nfs-sc
service-b-data       Bound    pvc-2a9e8d2c-xxxx-6bb3b3f67890   RWX            nfs-sc
shared-cache-data    Bound    pvc-3b0f9e3d-xxxx-7cc4c4a11111   RWX            nfs-sc
```

All of the PVCs were `Bound`. That only confirmed that each PVC had been bound to a PV; it did not prove by itself that NFS was healthy.

Mike then checked the Events for one of the failed Pods:

```bash
kubectl describe pod service-a-6f69fddc9f-7n2kq -n production

## None of the following mount errors appeared:
FailedMount
MountVolume.SetUp failed
Unable to attach or mount volumes
```

Also, both `service-a` and `service-b` were in `CrashLoopBackOff`. Their containers had started at least once, but their processes exited soon afterward. If the volumes could not be mounted at all, the Pods would more commonly remain in `ContainerCreating`.

Taken together, those clues moved NFS down Mike's list of suspects:

```text
The PVCs are bound, there are no FailedMount Events, and the containers did start.
NFS is not the primary suspect.
```

## 3. service-a Pointed to service-b, Which Pointed to service-c

Mike started with `service-a`, the service generating the most alerts, and checked the logs from its previous container instance:

```bash
kubectl logs service-a-6f69fddc9f-7n2kq -n production --previous

## One line immediately stood out:
ERROR Failed to initialize client for SERVICE_B_ENDPOINT
java.lang.IllegalStateException: service-b endpoint is not available
```

The Deployment configuration confirmed the dependency:

```yaml
env:
- name: SERVICE_B_ENDPOINT
  value: "http://service-b.production.svc.cluster.local:8080"
```

`service-a` might simply have been taken down by the failure of `service-b`.

Mike checked the previous logs for `service-b` next:

```bash
kubectl logs service-b-7d8f9c9b67-qz8h4 -n production --previous

## A similar error appeared:
ERROR Failed to initialize dependency SERVICE_C_ENDPOINT
java.lang.IllegalStateException: service-c endpoint is not available
```

Its Deployment also contained a downstream endpoint:

```yaml
env:
- name: SERVICE_C_ENDPOINT
  value: "http://service-c.production.svc.cluster.local:8080"
```

The dependency chain was becoming clear:

```text
service-a failed to start because it depended on service-b
service-b failed to start because it depended on service-c
```

The next service to investigate was `service-c`.

## 4. service-c Never Started

Mike returned to the original Pod list:

```text
service-c-5f6f87db6b-m9x2p   0/1   ImagePullBackOff   0   14m
```

Unlike the other two services, `service-c` had not crashed after startup. Its image had never been pulled, so its container had never started.

Mike immediately checked its Events:

```bash
kubectl describe pod service-c-5f6f87db6b-m9x2p -n production

## The key clue appeared quickly:
Warning  Failed   kubelet  Failed to pull image "registry.example.com/prod/service-c:v2.8.1":
rpc error: code = Unknown desc = failed to authorize:
failed to fetch oauth token: 401 Unauthorized

Warning  Failed   kubelet  Error: ErrImagePull
Warning  BackOff  kubelet  Back-off pulling image "registry.example.com/prod/service-c:v2.8.1"
Warning  Failed   kubelet  Error: ImagePullBackOff
```

The `401 Unauthorized` narrowed the investigation considerably.

This was not a bug in the `service-c` application. The kubelet could not authenticate to the registry while pulling the image.

## 5. The imagePullSecret Led to an Expired Token

Mike checked the `imagePullSecrets` used by `service-c`:

```bash
kubectl get deployment service-c -n production -o yaml

## The configuration includes imagePullSecrets:
....
spec:
  template:
    spec:
      imagePullSecrets:
      - name: registry-credential
....
```

Then he looked up the Secret:

```bash
kubectl get secret registry-credential -n production

## Output
NAME                  TYPE                             DATA   AGE
registry-credential   kubernetes.io/dockerconfigjson   1      180d
```

The Secret type was correct: `kubernetes.io/dockerconfigjson`, which is used for private registry credentials.

Its `AGE` was 180 days, but Mike did not treat that number as proof that the credentials were 180 days old. `AGE` shows when the Secret object was created. Updating its contents does not reset that value.

He checked the deployment documentation and the token information on the registry platform. The credentials had come from a manually generated registry token, and that token had an expiration date.

After checking with the platform team, Mike had his answer: the registry token had expired.

The entire failure chain now made sense:

```text
Expired registry token
  -> invalid credentials in the imagePullSecret
  -> service-c cannot pull its image and enters ImagePullBackOff
  -> service-b cannot reach service-c during startup and enters CrashLoopBackOff
  -> service-a cannot reach service-b during startup and enters CrashLoopBackOff
  -> production alerts start flooding in
```

What looked like a wave of crashing services had started with one expired registry credential.

## 6. Update the Secret, Then Watch the Services Recover

After the platform team generated a new registry token, Mike updated the imagePullSecret in the `production` namespace:

```bash
kubectl create secret docker-registry registry-credential \
  --docker-server=registry.example.com \
  --docker-username=<username> \
  --docker-password=<new-token> \
  --docker-email=<email> \
  -n production \
  --dry-run=client -o yaml | kubectl apply -f -
```

When a Pod is in `ImagePullBackOff`, the kubelet continues retrying the image pull with an increasing delay. To avoid waiting for the next retry, Mike deleted the failed `service-c` Pod so the Deployment would create a new one immediately:

```bash
kubectl delete pod service-c-5f6f87db6b-m9x2p -n production

## This time, the image pull succeeded:
service-c-5f6f87db6b-r4x7m   1/1   Running   0   1m
```

As `service-b` and `service-a` entered their next restart attempts, their downstream dependencies were available again and both gradually returned to `Running`. Only after the alerts began clearing did Mike update the team:

```text
Services have recovered. The root cause was an expired registry token used by the imagePullSecret,
which prevented service-c from pulling its image.
The CrashLoopBackOff failures in service-b and service-a were caused by the dependency chain.
```

Mike closed his laptop, walked back to the platform, and waited for the next train to the office.

## 7. How Could One Token Take Down a Chain of Services?

The expired token was the direct cause of this incident, but it did not fully explain why so many alerts fired.

When `service-b` could not connect to `service-c` during startup, it exited. When `service-a` could not connect to `service-b`, it exited too. One image-pull failure propagated through the startup dependency chain until three services appeared unhealthy.

During the post-incident review, Mike distilled the incident into three lessons.

First, when several services fail at once, look for shared dependencies, but do not treat every failed status as the same problem.

For `CrashLoopBackOff`, start with application logs and the `--previous` logs. For `ImagePullBackOff`, start with Pod Events, the image reference, and registry authentication. The one different status in a long list of failures may be the clue closest to the root cause.

Second, creating a credential is not enough. Its entire lifecycle has to be managed.

Registry tokens, certificates, database passwords, and API keys all need a clear owner, expiration alerts, and a rotation process. Where possible, centralized Secret management and automated rotation can reduce the risk of relying on manual updates.

Third, the first error you see may not be the first error that occurred, and the loudest alert may not come from the root cause.

This incident produced a screen full of `CrashLoopBackOff` Pods. The failure that deserved attention first, however, was the nearly overlooked `ImagePullBackOff`.
