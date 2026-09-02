# FluxCD Ready=True，为什么服务还是没更新？

看 FluxCD 状态时，最容易误判的一句话是：

```text
Ready=True
```

很多人第一眼看到它，会以为：

```text
FluxCD 已经把最新版本发布成功了。
```

但这不一定对。

## Ready=True 代表什么

`Ready=True` 更准确的意思是：这个对象当前观察到的状态是健康的。

它不等于：

```text
上游一定是最新的
Chart 一定是最新的
Deployment 一定生成了新的 ReplicaSet
Pod 一定跑的是新镜像
```

也就是说，`Ready=True` 只能说明这一层看起来正常，不能直接证明整条发布链路都已经更新。

## FluxCD 要分层看

FluxCD 的发布链路通常不是一层。

比如用 HelmRelease 发布应用时，大致可以这样看：

```text
GitRepository
  -> Kustomization
  -> HelmRepository
  -> HelmChart
  -> HelmRelease
  -> Deployment / Pod
```

每一层都可能是 `Ready=True`，但卡住的位置不一样。

比如：

- `HelmRepository` 是旧的，说明 Helm repo 没刷新到新 index；
- `HelmChart` 是旧的，说明 chart 版本还没解析到新版本；
- `HelmRelease` 是新的，但 Deployment 没变，说明渲染出来的 Pod template 可能没变化；
- Deployment 变了，但 Pod 还是旧的，就要继续看 rollout 和镜像。

## 不要只看 Ready

排查这类问题时，更应该看几个字段：

```text
revision
lastAppliedRevision
lastAttemptedRevision
lastUpdateTime
observedGeneration
Deployment image
ReplicaSet 创建时间
```

一个很实用的判断是：

```text
Ready 看健康状态。
Revision 看是不是最新版本。
Deployment / Pod 看是否真的落地。
```

## 一个简单检查顺序

可以先从这条链路往下看：

```text
Git 是否已经到新 commit？
HelmRepository 是否刷新到新 index？
HelmChart 是否解析到新 chart version？
HelmRelease 是否尝试了新 revision？
Deployment 是否生成了新 ReplicaSet？
Pod 镜像是否真的是新 tag？
```

如果中间某一层还是旧的，就不要急着 `rollout restart`。

因为重启 Pod 可能只是让旧版本重新跑一遍，并不能解决上游没有更新的问题。

## 一句话记住

FluxCD 里的 `Ready=True`，不等于服务已经更新到最新版本。

```text
Ready 看状态。
Revision 看版本。
Pod 看结果。
```
