----- Chinese
# K8S Pod 拉不起来：小李的目光最后落到了 CI/CD

## 故事背景

经历过几次 K8S 生产故障以后，小李越来越清楚一件事：集群里的现象，很多时候只是最后的结果。要根据这个结果去倒推出问题的原因，需要不停地、仔细地、抽丝剥茧般地检查 --> 验证 --> 直到找到问题的根源。
大多数场合下，检查 --> 验证的步骤要来回执行多次，才能最终找到问题的根源。这样的例子很多，例如：
- Pod 起不来，不一定是 K8S 本身坏了。
- Service 访问失败，不一定是网络坏了。
- 一次发布失败，也不一定是 Deployment 写错了。

真正的问题，可能藏在更前面的地方：代码仓库、镜像仓库、Helm Chart、CI/CD 流水线，甚至只是一个不起眼的 YAML 路径引用错误。

这一次，小李遇到的就是这样一个问题:
新版本发布以后，监控很快报了告警：Deployment 的 rollout 一直没有完成，新的 Pod 没有成功启动。刚看到告警时，小李的第一反应还是先看 K8S，毕竟问题最终表现为新版本 Pod 没起来。

但他没想到，这次排查绕了一圈以后，自己的目光最后落到了 CI/CD 上。

## 1. 新版本发布后，Pod 起不来

某天下午，业务团队按计划发布了一个新版本。发布开始没多久，监控系统就开始报警：

```bash
ALERT: K8S Deployment Rollout Not Complete
Namespace: production
Deployment: order-api
Message: deployment rollout has not completed within the expected time
```

发布群里也很快有人反馈：订单服务这次发布一直没有完成，新版本 Pod 起不来，麻烦看一下是不是发布有问题？

小李看到消息后，先在群里回复：我先看一下集群状态，稍后同步。

他登录到集群以后，第一步先看 Pod 状态。结果也很符合滚动升级的表现：旧版本 Pod 还在 `Running`，新的 Pod 卡在了镜像拉取阶段。

```bash
kubectl get pods -n production
NAME                         READY   STATUS          RESTARTS   AGE
order-api-6c9f7f8d5f-2k9lm   1/1     Running         0          3d
order-api-6c9f7f8d5f-8xq7p   1/1     Running         0          3d
order-api-7b8f6f9d6c-k4n8s   0/1     ErrImagePull    0          4m
order-api-7b8f6f9d6c-p9t2v   0/1     ErrImagePull    0          4m
```

看到 `ErrImagePull` 的一瞬间，小李心里大概有了方向: Pod 没起来，不是应用启动后崩了，也不是 readiness probe 没通过，而是镜像还没拉下来。

这种问题通常会落在几个方向：
- 镜像 tag 不存在
- 镜像仓库地址写错
- 镜像仓库权限有问题
- 节点到镜像仓库网络不通
- imagePullSecret 配置错误

小李没有急着判断是哪一个，而是继续检查 Pod Events 事件。

## 2. 事件里出现了 manifest unknown

小李选择其中一个失败的 Pod，查看详细事件：

```bash
kubectl describe pod order-api-7b8f6f9d6c-k4n8s -n production
```

在 Events 里，他看到了关键信息：

```bash
Events:
  Type     Reason     Age                   From               Message
  ----     ------     ----                  ----               -------
  Normal   Scheduled  4m                    default-scheduler  Successfully assigned production/order-api-7b8f6f9d6c-k4n8s to worker-3
  Normal   Pulling    3m58s                 kubelet            Pulling image "registry-test/app:v1.2.0"
  Warning  Failed     3m56s                 kubelet            Failed to pull image "registry-test/app:v1.2.0": rpc error: code = NotFound desc = failed to pull and unpack image "registry-test/app:v1.2.0": failed to resolve reference "registry-test/app:v1.2.0": manifest unknown
  Warning  Failed     3m56s                 kubelet            Error: ErrImagePull
  Normal   BackOff    3m20s                 kubelet            Back-off pulling image "registry-test/app:v1.2.0"
  Warning  Failed     3m20s                 kubelet            Error: ImagePullBackOff
```

`manifest unknown` 这个错误非常关键。

它通常说明镜像仓库能访问到，但对应的镜像 tag 找不到。换句话说，不像是网络完全不通，也不像是认证失败，更像是 kubelet 正在拉一个不存在的镜像。

小李盯着这行镜像地址看了一会儿：

```bash
registry-test/app:v1.2.0
```

这里就有点不对劲了！这是生产环境，为什么 Deployment 里出现 test 镜像仓库的地址 `registry-test`？

## 3. Deployment 里真的用了测试镜像仓库

为了确认不是事件里显示有误，小李继续查 Deployment：

```bash
kubectl get deployment order-api -n production -o yaml | grep image:
```

输出如下：

```bash
        image: registry-test/app:v1.2.0
```

小李心里更疑惑了！生产环境按理说应该使用如下生产镜像仓库：

```bash
registry-prod/app:v1.2.0
```

而不是：`registry-test/app:v1.2.0`

如果是普通的镜像 tag 不存在，那问题还算简单。可现在的问题是：生产 Deployment 里出现了测试 registry 地址。这就不只是 K8S 现场问题了。

小李开始意识到，K8S 只是把最终生成出来的 Deployment 执行了，至于这个错误的镜像地址是怎么进来的，很可能要往发布链路前面查。

## 4. CI/CD 流水线看起来都是绿色的

小李打开对应项目的 CI/CD 页面，先看这次发布对应的流水线。

从页面上看，几个阶段都是成功的：

```bash
stages:
  - build      success
  - test       success
  - package    success
  - deploy     success
```

再看 Git 提交记录：
- 代码已经 merge 到发布分支
- build stage 成功
- test stage 成功
- 镜像构建没有报错
- deploy stage 也执行完成

从 CI/CD 的结果看，这次发布流程是 OK 的。但发布结果是失败的：在生产环境里，Pod 正在拉一个错误的镜像仓库，而且对应镜像还不存在。

小李心里嘀咕了一句：流水线全绿，只能说明 deploy stage 执行完成了，但并不代表新版本真的发布成功，也不代表发布内容一定是对的。

接下来，他开始查这次发布用到的 repo 和 Helm Chart。

## 5. Helm Chart 里明明写了生产镜像仓库

检查下来，确认这个服务是通过 Helm 发布到 K8S 的。小李先看 CD 阶段的发布命令，确认生产环境发布时使用了自定义 values 文件：

```bash
helm upgrade --install order-api ./chart \
  -n production \
  -f ./values-prod.yaml
```

这个命令看着没问题！然后小李打开 `values-prod.yaml`，先快速搜索了一下生产镜像仓库：

```bash
grep -nE "registry-prod|tag" values-prod.yaml
12:    repository: registry-prod/app
13:    tag: v1.2.0
```

这就更奇怪了！发布命令里用了 `values-prod.yaml`，而 `values-prod.yaml` 里也确实能搜到正确的生产镜像仓库。

可真实部署到集群里的 Deployment，却变成了：

```yaml
image: registry-test/app:v1.2.0
```

小李一时有点卡住了：如果 CD 命令用错了 values 文件，那可以解释；如果 `values-prod.yaml` 里写错了 registry，那也可以解释。但现在看起来，命令没错，文件里也有正确配置。

那错误的 `registry-test` 到底是从哪里来的？

## 6. 先修复部署问题：手动修正 Deployment 镜像

虽然根因还没完全查清，但这次发布已经卡住了。旧版本 Pod 还在继续承接流量，业务暂时没有完全中断，但新版本一直发布不上去，后面的验证和发布窗口都会被拖住。

于是小李决定先把这次 rollout 走完，避免发布长时间停在半路上。

他先确认 `registry-prod/app:v1.2.0` 这个镜像是存在的，然后临时修改 Deployment 的镜像地址：

```bash
kubectl set image deployment/order-api \
  order-api=registry-prod/app:v1.2.0 \
  -n production
```

随后观察 rollout 状态：

```bash
kubectl rollout status deployment/order-api -n production
```

输出很快变成正常：

```bash
deployment "order-api" successfully rolled out
```

再看 Pod 状态：

```bash
kubectl get pods -n production
NAME                         READY   STATUS    RESTARTS   AGE
order-api-8449c8d7d6-4n2lx   1/1     Running   0          1m
order-api-8449c8d7d6-d8p6q   1/1     Running   0          1m
order-api-8449c8d7d6-k7m9s   1/1     Running   0          1m
```

新的 Pod 启动成功后，小李又做了一次健康检查：

```bash
curl http://order-api.production.svc.cluster.local:8080/health
ok
```

小李在群里先同步：新版本 Pod 已经拉起来了，rollout 已完成。当前看到的问题是生产 Deployment 使用了错误的镜像仓库地址，我先临时修正了镜像，后续继续查发布链路。

临时修复完成以后，小李没有停下来。

因为他知道，手动改 Deployment 只是把这一次 Pod 拉起来了。如果不把发布链路里的错误找出来，下次再发布，问题还会回来。

## 7. 错误地址来自默认 values.yaml

小李继续回到 Helm Chart 仓库里查。

他打开 Chart 里的默认 `values.yaml`，终于看到了熟悉的地址：

```yaml
image:
  repository: registry-test/app
  tag: v1.2.0
```

这下线索明显了：默认 `values.yaml` 里配置的是测试镜像仓库 `registry-test/app`。这本身不一定有问题，因为不同环境本来就会通过不同的 custom values 文件覆盖默认值。

生产环境应该由 `values-prod.yaml` 覆盖成：

```yaml
image:
  repository: registry-prod/app
  tag: v1.2.0
```

但真实结果还是用了默认的 `registry-test/app`。这说明一个很重要的问题：`values-prod.yaml` 被传给了 Helm，不代表里面的每个字段都成功覆盖了默认值。

小李开始怀疑：为啥配置没有覆盖？部署居然不报错？难道是 custom values 的字段路径和模板里引用的路径对不上？

## 8. 真正的问题是 Custom Values 路径写错了

小李决定重新来看看 Chart 的目录结构：
```bash
|- chart
|  |- Chart.yaml
|  |- templates
|  |  |- deployment.yaml
|  |  |- service.yaml
|  |  `- serviceaccount.yaml
|  `- values.yaml
|- values-prod.yaml
```
helm 命令执行的方式也没问题，选用 values-prod.yaml 来覆盖 values.yaml 里的默认值也是正确的。
接着，小李重新打开 `values-prod.yaml`，这次不再只看有没有 `registry-prod`，而是把前后几行一起看，仔细检查层级结构。

很快，他发现了问题。values-prod.yaml 文件里原来的配置是这样的：

```yaml
replicaCount: 3

deployment:
  image:
    repository: registry-prod/app
    tag: v1.2.0
```

乍一看，`repository` 和 `tag` 都在，`registry-prod/app` 也在。

但从 YAML 结构上看，这个 `image` 被放到了 `deployment` 下面。

也就是说，Helm 实际看到的是：

```yaml
deployment:
  image:
    repository: registry-prod/app
    tag: v1.2.0
```

而 Chart 模板里真正引用的是：

```yaml
image: "{{ .Values.image.repository }}:{{ .Values.image.tag }}"
```

它期望的 values 结构应该是：

```yaml
image:
  repository: registry-prod/app
  tag: v1.2.0
```

这就导致 `values-prod.yaml` 里的配置虽然是合法 YAML，Helm 也不会报错，但它覆盖的是 `.Values.deployment.image.repository`，不是模板真正使用的 `.Values.image.repository`。

于是 Helm 最终还是回落到了默认 `values.yaml` 里的配置：

```yaml
image:
  repository: registry-test/app
  tag: v1.2.0
```

小李看到这里，终于把这次故障串起来了：

1. 新版本修改了生产环境的 custom values 文件
2. `values-prod.yaml` 里镜像字段路径写错
3. Helm 没有按预期覆盖默认 `values.yaml`
4. 默认 values 中的 `registry-test/app` 被渲染进 Deployment
5. 生产集群尝试拉取 `registry-test/app:v1.2.0`
6. 测试镜像仓库中没有这个 tag
7. kubelet 拉镜像失败，Pod 进入 `ErrImagePull`

这不是 K8S 集群故障;也不是镜像仓库不可用;真正的问题，是 CI/CD 发布链路里使用的 Helm values 文件有 YAML 路径引用错误！

## 9. 修复 Custom Values 文件后重新发布

根因确认后，小李修复了 `values-prod.yaml`：

```yaml
image:
  repository: registry-prod/app
  tag: v1.2.0
```

然后重新执行 Helm 发布：

```bash
helm upgrade --install order-api ./chart \
  -n production \
  -f values-prod.yaml
```

发布完成后，再检查 Deployment：

```bash
kubectl get deployment order-api -n production -o yaml | grep image:
```

输出终于变成了预期结果：

```bash
        image: registry-prod/app:v1.2.0
```

再看 Pod 状态：

```bash
kubectl get pods -n production
NAME                         READY   STATUS    RESTARTS   AGE
order-api-8449c8d7d6-4n2lx   1/1     Running   0          6m
order-api-8449c8d7d6-d8p6q   1/1     Running   0          6m
order-api-8449c8d7d6-k7m9s   1/1     Running   0          6m
```

到这时候，这次问题才算真正闭环，完整解决了。

## 10. 小李的建议：让 Helm 先把答案说出来

故障恢复以后，小李继续想一个问题：这类问题有没有办法更早发现？

这次的问题不是 K8S 不稳定，也不是镜像仓库不可用，而是 Helm 最终渲染出来的资源和大家以为要发布的资源不一致。如果在真正发布前，就能看到 Helm 最终生成的 Deployment YAML，那么这个问题很可能在进入集群之前就被发现。

于是小李给发布团队的 CI/CD 流水线提了建议，补了一个发布前检查步骤。

1. 使用 `helm template` 查看最终渲染结果：

```bash
helm template order-api ./chart \
  -n production \
  -f values-prod.yaml | grep image:
```

预期输出必须是使用正确的镜像仓库地址，如果输出里出现了 `registry-test`，流水线就应该直接失败，而不是继续部署。
```bash
          image: registry-prod/app:<NEW_TAG>
```

2. 在发布前做一次 dry-run：

```bash
helm upgrade --install order-api ./chart \
  -n production \
  -f values-prod.yaml \
  --dry-run --debug
```

这可以模拟一次发布过程，看到 Helm 最终会提交给 K8S 的资源内容。

上述检查并不复杂，但它们能把很多低级错误挡在生产环境之前。这几个命令让小李意识到一件事：不要只相信 values 文件里“看起来写了什么”，要看 Helm 最后“真正渲染出了什么”。

## 小李的总结
### 事故复盘
这次问题让小李对发布链路有了更深的认识，于是他特意把两个判断写进了复盘里。

第一个判断：CI/CD 显示成功，不代表发布内容一定正确。
这次 build 成功、test 成功、deploy 也成功，但发布出来的镜像地址是错的。流水线绿色，只能说明流程跑完了，不代表结果符合预期。

第二个判断：K8S 里的 Deployment 是结果，不一定是根因。
Deployment 里确实出现了错误镜像，但这个错误不是小李手动写进去的，也不是 K8S 自己生成错了，而是 Helm values 覆盖失败以后渲染出来的结果。

如果只盯着 K8S 查，很容易停在“镜像地址错了”这一层。但真正要避免问题复发，必须继续往前查 CI/CD 和 Helm Chart。


### 总结回顾
小李以前看发布，更多关注流水线有没有成功、Pod 有没有起来、服务有没有通过健康检查。这次以后，他多加了一个检查点：最终渲染出来的 YAML，是否真的是我以为要发布的内容？

K8S 只是执行最终结果的地方，而 CI/CD 才是把代码、镜像、配置和集群连接起来的链路。在这个链路中，决定部署的最终行为又落在了 Helm Chart 和 custom values (或者默认的 values) 文件里。

Helm values 文件里的一个引用错误，看起来只是一个很小的配置问题，但它可以让生产环境拉错镜像仓库，最终导致 Pod 起不来。

理清楚这个坑以后，小李有些成就感，从此他的排障工具箱里，又多了一组 Helm 命令。

## 补充说明
- `ErrImagePull`：表示 kubelet 拉取容器镜像失败，常见原因包括镜像不存在、仓库认证失败、网络不通等。
- `ImagePullBackOff`：表示 kubelet 多次拉取镜像失败后进入退避重试状态。
- `manifest unknown`：通常表示镜像仓库中找不到指定的镜像 tag。
- Helm `values.yaml`：Helm Chart 的默认配置文件。
- Helm custom values 文件：发布不同环境时传入的自定义 values 文件，常见如 `values-dev.yaml`、`values-test.yaml`、`values-prod.yaml`。
- `helm template`：在本地渲染 Helm Chart，查看最终生成的 Kubernetes YAML。
- `helm upgrade --install --dry-run --debug`：模拟 Helm 安装或升级过程，不真正修改集群资源。

----- English
# K8S Pod Would Not Start: Mike Eventually Turned to CI/CD

## Background

After handling several K8S production incidents, Mike became increasingly clear about one thing: what you see in the cluster is often only the final symptom. To work backward from that symptom to the real cause, you have to keep checking, verifying, and peeling back the layers until you reach the root of the problem.

In most cases, the check-and-verify cycle has to be repeated several times before the real cause becomes clear. There are many examples:
- A Pod failing to start does not necessarily mean K8S itself is broken.
- A Service access failure does not necessarily mean the network is broken.
- A failed release does not necessarily mean the Deployment manifest is wrong.

The real problem may be hiding much earlier in the delivery chain: the code repository, image registry, Helm Chart, CI/CD pipeline, or even a small YAML path reference mistake that looks harmless at first glance.

This time, Mike ran into exactly that kind of problem.

After a new version was released, monitoring quickly fired an alert: the Deployment rollout had not completed, and the new Pods had not started successfully. When Mike first saw the alert, his instinct was still to check K8S first, because the final symptom was that the new version Pods were not coming up.

But after going around the troubleshooting loop, he did not expect his attention to eventually land on CI/CD.

## 1. After the New Release, the Pods Would Not Start

One afternoon, the business team released a new version as planned. Not long after the release started, the monitoring system began alerting:

```bash
ALERT: K8S Deployment Rollout Not Complete
Namespace: production
Deployment: order-api
Message: deployment rollout has not completed within the expected time
```

Someone soon posted in the release chat: the order service release has not completed, and the new Pods will not start. Could you check whether something is wrong with the release?

After seeing the message, Mike replied in the chat: "I'll check the cluster status first and update shortly."

After logging in to the cluster, his first step was to check the Pod status. The result matched what you would expect during a rolling update: the old Pods were still `Running`, while the new Pods were stuck at the image-pull stage.

```bash
kubectl get pods -n production
NAME                         READY   STATUS          RESTARTS   AGE
order-api-6c9f7f8d5f-2k9lm   1/1     Running         0          3d
order-api-6c9f7f8d5f-8xq7p   1/1     Running         0          3d
order-api-7b8f6f9d6c-k4n8s   0/1     ErrImagePull    0          4m
order-api-7b8f6f9d6c-p9t2v   0/1     ErrImagePull    0          4m
```

The moment he saw `ErrImagePull`, Mike had a rough direction in mind. The Pod had not failed after the application started, and it was not failing a readiness probe. The image had not even been pulled successfully.

This type of issue usually falls into a few categories:
- The image tag does not exist
- The image registry address is wrong
- The image registry permissions are incorrect
- The node cannot reach the image registry
- The `imagePullSecret` is misconfigured

Mike did not jump to any one conclusion. Instead, he continued by checking the Pod Events.

## 2. `manifest unknown` Appeared in the Events

Mike picked one of the failed Pods and inspected its details:

```bash
kubectl describe pod order-api-7b8f6f9d6c-k4n8s -n production
```

In the Events section, he saw the key message:

```bash
Events:
  Type     Reason     Age                   From               Message
  ----     ------     ----                  ----               -------
  Normal   Scheduled  4m                    default-scheduler  Successfully assigned production/order-api-7b8f6f9d6c-k4n8s to worker-3
  Normal   Pulling    3m58s                 kubelet            Pulling image "registry-test/app:v1.2.0"
  Warning  Failed     3m56s                 kubelet            Failed to pull image "registry-test/app:v1.2.0": rpc error: code = NotFound desc = failed to pull and unpack image "registry-test/app:v1.2.0": failed to resolve reference "registry-test/app:v1.2.0": manifest unknown
  Warning  Failed     3m56s                 kubelet            Error: ErrImagePull
  Normal   BackOff    3m20s                 kubelet            Back-off pulling image "registry-test/app:v1.2.0"
  Warning  Failed     3m20s                 kubelet            Error: ImagePullBackOff
```

The `manifest unknown` error was critical.

It usually means the image registry can be reached, but the specified image tag cannot be found. In other words, this did not look like a complete network outage or an authentication failure. It looked more like kubelet was trying to pull an image that did not exist.

Mike stared at the image address for a moment:

```bash
registry-test/app:v1.2.0
```

Something was off. This was the production environment. Why was the Deployment using the test image registry address, `registry-test`?

## 3. The Deployment Really Was Using the Test Registry

To make sure the Event output was not misleading, Mike checked the Deployment directly:

```bash
kubectl get deployment order-api -n production -o yaml | grep image:
```

The output was:

```bash
        image: registry-test/app:v1.2.0
```

Mike was even more puzzled. In production, the service should have been using the production image registry:

```bash
registry-prod/app:v1.2.0
```

Not `registry-test/app:v1.2.0`.

If this were just a missing image tag, the problem would be relatively simple. But now the issue was that the production Deployment contained a test registry address. This was no longer just an on-cluster K8S problem.

Mike began to realize that K8S had simply applied the final Deployment it was given. As for how the wrong image address got into that Deployment, he probably needed to look earlier in the release chain.

## 4. The CI/CD Pipeline Was All Green

Mike opened the project's CI/CD page and first checked the pipeline for this release.

On the page, all stages were successful:

```bash
stages:
  - build      success
  - test       success
  - package    success
  - deploy     success
```

Then he checked the Git commit history:
- The code had been merged into the release branch
- The build stage had succeeded
- The test stage had succeeded
- The image build had not reported any errors
- The deploy stage had also completed

Based on the CI/CD result, the release process looked OK. But the actual release result was a failure: in production, the Pod was pulling from the wrong image registry, and that image did not exist there.

Mike muttered to himself: a fully green pipeline only means the deploy stage finished. It does not mean the new version was actually released successfully, and it does not mean the deployed content is necessarily correct.

Next, he started checking the repository and Helm Chart used by this release.

## 5. The Helm Chart Clearly Had the Production Registry

After checking, Mike confirmed that this service was deployed to K8S through Helm. He first looked at the CD-stage release command and confirmed that the production deployment used a custom values file:

```bash
helm upgrade --install order-api ./chart \
  -n production \
  -f ./values-prod.yaml
```

The command looked fine. Then Mike opened `values-prod.yaml` and quickly searched for the production registry:

```bash
grep -nE "registry-prod|tag" values-prod.yaml
12:    repository: registry-prod/app
13:    tag: v1.2.0
```

That made the situation even stranger. The release command used `values-prod.yaml`, and `values-prod.yaml` did contain the correct production registry.

But the Deployment actually applied to the cluster had become:

```yaml
image: registry-test/app:v1.2.0
```

Mike got stuck for a moment. If the CD command had used the wrong values file, that would explain it. If `values-prod.yaml` had the wrong registry, that would also explain it. But now the command looked correct, and the file contained the right configuration.

So where did the incorrect `registry-test` value come from?

## 6. Restore the Deployment First: Manually Fix the Image

Although the root cause was not fully clear yet, this release was already stuck. The old Pods were still serving traffic, so the business was not completely down for the moment. But the new version could not be released, and the validation work and release window were being delayed.

So Mike decided to finish this rollout first and avoid leaving the release halfway through for too long.

He first confirmed that the image `registry-prod/app:v1.2.0` existed, then temporarily updated the Deployment image:

```bash
kubectl set image deployment/order-api \
  order-api=registry-prod/app:v1.2.0 \
  -n production
```

Then he watched the rollout status:

```bash
kubectl rollout status deployment/order-api -n production
```

The output soon became normal:

```bash
deployment "order-api" successfully rolled out
```

He checked the Pods again:

```bash
kubectl get pods -n production
NAME                         READY   STATUS    RESTARTS   AGE
order-api-8449c8d7d6-4n2lx   1/1     Running   0          1m
order-api-8449c8d7d6-d8p6q   1/1     Running   0          1m
order-api-8449c8d7d6-k7m9s   1/1     Running   0          1m
```

After the new Pods started successfully, Mike ran another health check:

```bash
curl http://order-api.production.svc.cluster.local:8080/health
ok
```

Mike then updated the chat: the new version Pods are up, and the rollout has completed. The current issue is that the production Deployment used the wrong image registry address. I have temporarily corrected the image and will continue checking the release chain.

After the temporary fix, Mike did not stop there.

He knew that manually changing the Deployment only got the Pods running this time. If the mistake in the release chain was not found, the same problem would come back in the next release.

## 7. The Wrong Address Came from the Default `values.yaml`

Mike returned to the Helm Chart repository and kept digging.

He opened the default `values.yaml` in the Chart and finally saw the familiar address:

```yaml
image:
  repository: registry-test/app
  tag: v1.2.0
```

Now the clue was obvious: the default `values.yaml` used the test image registry, `registry-test/app`. That was not necessarily wrong by itself, because different environments are supposed to override the defaults with different custom values files.

For production, `values-prod.yaml` should override it with:

```yaml
image:
  repository: registry-prod/app
  tag: v1.2.0
```

But the actual result still used the default `registry-test/app`. This revealed an important point: passing `values-prod.yaml` to Helm does not mean every field in that file successfully overrides the default value.

Mike started to wonder: why did the override not take effect? Why did the deployment not report an error? Could it be that the field path in the custom values file did not match the path referenced by the template?

## 8. The Real Problem Was a Wrong Path in Custom Values

Mike decided to look again at the Chart directory structure:

```bash
|- chart
|  |- Chart.yaml
|  |- templates
|  |  |- deployment.yaml
|  |  |- service.yaml
|  |  `- serviceaccount.yaml
|  `- values.yaml
|- values-prod.yaml
```

The way the Helm command was executed was also fine. Using `values-prod.yaml` to override the defaults in `values.yaml` was the correct approach.

Then Mike reopened `values-prod.yaml`. This time, he did not just check whether `registry-prod` existed. He looked at the surrounding lines and carefully inspected the hierarchy.

Soon, he found the problem. The original configuration in `values-prod.yaml` looked like this:

```yaml
replicaCount: 3

deployment:
  image:
    repository: registry-prod/app
    tag: v1.2.0
```

At first glance, both `repository` and `tag` were there, and `registry-prod/app` was there too.

But structurally, the `image` block had been placed under `deployment`.

In other words, what Helm actually saw was:

```yaml
deployment:
  image:
    repository: registry-prod/app
    tag: v1.2.0
```

But the Chart template actually referenced:

```yaml
image: "{{ .Values.image.repository }}:{{ .Values.image.tag }}"
```

The values structure it expected was:

```yaml
image:
  repository: registry-prod/app
  tag: v1.2.0
```

As a result, the configuration in `values-prod.yaml` was valid YAML and Helm did not report an error, but it was overriding `.Values.deployment.image.repository`, not the `.Values.image.repository` that the template actually used.

So Helm ultimately fell back to the configuration in the default `values.yaml`:

```yaml
image:
  repository: registry-test/app
  tag: v1.2.0
```

At this point, Mike finally connected the whole incident:

1. The new version changed the production custom values file
2. The image field path in `values-prod.yaml` was wrong
3. Helm did not override the default `values.yaml` as expected
4. The default `registry-test/app` value was rendered into the Deployment
5. The production cluster tried to pull `registry-test/app:v1.2.0`
6. That tag did not exist in the test image registry
7. kubelet failed to pull the image, and the Pods entered `ErrImagePull`

This was not a K8S cluster failure, and it was not an unavailable image registry. The real problem was a YAML path mistake in the Helm values file used by the CI/CD release chain.

## 9. Fix the Custom Values File and Release Again

After confirming the root cause, Mike fixed `values-prod.yaml`:

```yaml
image:
  repository: registry-prod/app
  tag: v1.2.0
```

Then he ran the Helm release again:

```bash
helm upgrade --install order-api ./chart \
  -n production \
  -f values-prod.yaml
```

After the release completed, he checked the Deployment again:

```bash
kubectl get deployment order-api -n production -o yaml | grep image:
```

The output finally became what he expected:

```bash
        image: registry-prod/app:v1.2.0
```

Then he checked the Pods:

```bash
kubectl get pods -n production
NAME                         READY   STATUS    RESTARTS   AGE
order-api-8449c8d7d6-4n2lx   1/1     Running   0          6m
order-api-8449c8d7d6-d8p6q   1/1     Running   0          6m
order-api-8449c8d7d6-k7m9s   1/1     Running   0          6m
```

Only now was the incident truly closed and fully resolved.

## 10. Mike's Suggestion: Let Helm Show the Answer First

After the incident was restored, Mike kept thinking about one question: could this kind of issue be caught earlier?

This problem was not caused by K8S instability or an unavailable image registry. It happened because the resources Helm ultimately rendered were not the resources everyone thought they were releasing. If the final Deployment YAML generated by Helm could be inspected before the actual release, this problem would likely have been caught before it entered the cluster.

So Mike suggested that the release team add a pre-release check to the CI/CD pipeline.

1. Use `helm template` to inspect the final rendered output:

```bash
helm template order-api ./chart \
  -n production \
  -f values-prod.yaml | grep image:
```

The expected output must use the correct image registry address. If `registry-test` appears in the output, the pipeline should fail immediately instead of continuing with the deployment.

```bash
          image: registry-prod/app:<NEW_TAG>
```

2. Run a dry-run before release:

```bash
helm upgrade --install order-api ./chart \
  -n production \
  -f values-prod.yaml \
  --dry-run --debug
```

This simulates the release process and shows the resources Helm would submit to K8S.

These checks are not complicated, but they can block many simple mistakes before they reach production. These commands made Mike realize one thing: do not only trust what a values file appears to contain. Look at what Helm actually renders in the end.

## Mike's Summary

### Incident Review

This incident gave Mike a deeper understanding of the release chain, so he wrote two conclusions into the post-incident review.

First conclusion: a successful CI/CD pipeline does not mean the released content is necessarily correct.

In this case, the build succeeded, the tests succeeded, and the deploy stage also succeeded. But the released image address was wrong. A green pipeline only means the process finished; it does not mean the result matched expectations.

Second conclusion: the Deployment in K8S is the result, not necessarily the root cause.

The Deployment did contain the wrong image, but Mike did not manually put that image there, and K8S did not invent it on its own. It was the result rendered by Helm after the values override failed.

If you only stare at K8S, it is easy to stop at the layer of "the image address is wrong." But to prevent the issue from recurring, you have to keep tracing backward into CI/CD and the Helm Chart.

### Recap

In the past, when Mike looked at releases, he mostly focused on whether the pipeline succeeded, whether the Pods came up, and whether the service passed its health check. After this incident, he added one more checkpoint: is the final rendered YAML really the content I think I am releasing?

K8S is where the final result is executed, while CI/CD is the chain that connects code, images, configuration, and the cluster. In that chain, the final deployment behavior is determined by the Helm Chart and the custom values file, or by the default values file.

A single reference mistake in a Helm values file may look like a tiny configuration issue, but it can make production pull from the wrong image registry and eventually prevent Pods from starting.

After sorting out this pitfall, Mike felt a small sense of accomplishment. From then on, his troubleshooting toolbox had gained another set of Helm commands.

## Additional Notes

- `ErrImagePull`: Indicates that kubelet failed to pull a container image. Common causes include a missing image, failed registry authentication, or network connectivity problems.
- `ImagePullBackOff`: Indicates that kubelet has failed to pull the image multiple times and has entered a backoff retry state.
- `manifest unknown`: Usually means the specified image tag cannot be found in the image registry.
- Helm `values.yaml`: The default configuration file for a Helm Chart.
- Helm custom values file: A custom values file passed in for different environments, commonly named `values-dev.yaml`, `values-test.yaml`, or `values-prod.yaml`.
- `helm template`: Renders a Helm Chart locally so you can inspect the final generated Kubernetes YAML.
- `helm upgrade --install --dry-run --debug`: Simulates a Helm install or upgrade without actually modifying cluster resources.
