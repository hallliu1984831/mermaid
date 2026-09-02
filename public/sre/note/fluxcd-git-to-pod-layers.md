# FluxCD 从 Git 到 Pod，中间经过哪几层？

很多人刚接触 FluxCD 时，容易把它理解成：

```text
Git 里配置变了
  -> Pod 自动更新
```

这个理解抓住了开头和结果，但略过了中间的步骤，显得太粗了。
真正排查问题时，如果只记住 `Git -> Pod`，中间哪里卡住了就很难判断。

## FluxCD 不是一步到 Pod

以常见的 HelmRelease 发布方式为例，FluxCD 中间通常会经过几层对象：

```text
GitRepository
  -> Kustomization
  -> HelmRepository
  -> HelmChart
  -> HelmRelease
  -> Deployment / Pod
```

可以先把它理解成一条发布链路。每一层都负责一件事，经过这几层对象处理过后，才落实到 Pod。

## 每一层大概做什么

`GitRepository` 负责看 Git。

它关心的是：Git 仓库能不能拉到，分支和 commit 是不是对的。

`Kustomization` 负责把 Git 里的配置应用到集群。

它关心的是：Git 里的 YAML、Kustomize 配置、HelmRelease 定义有没有被正确应用。

`HelmRepository` 负责看 Helm 仓库。

它关心的是：Helm repo 能不能访问，`index.yaml` 有没有更新。

`HelmChart` 负责解析具体的 chart 版本。

它关心的是：到底选中了哪个 chart version。

`HelmRelease` 负责执行 Helm 发布。

它关心的是：这次 Helm install / upgrade 有没有成功。

最后才是 `Deployment / Pod`。

它们关心的是：新 ReplicaSet 有没有生成，Pod 镜像是不是预期版本，容器有没有真的跑起来。

## 为什么这条链路重要

新的提交到了 Git 以后，等了很久都没有看到更新的 Pod，一般就是发布失败，这时候不要一上来就盯着 Pod。

因为问题可能根本还没走到 Pod 那一层。

可能的失败原因比较多，举例如下：

- Git 没拉到最新 commit，后面自然不会变；
- Helm repo 的 `index.yaml` 没更新，FluxCD 就发现不了新 chart；
- HelmChart 还解析到旧版本，HelmRelease 就不会发布新版本；
- HelmRelease 成功了，但 Deployment template 没变，就不会生成新 ReplicaSet；
- Deployment 变了，Pod 才可能进入镜像拉取、启动、探针检查这些阶段。

## 一句话记住

FluxCD 排查发布问题，不要只看最后的 Pod。

先沿着这条链路看一遍：

```text
GitRepository -> Kustomization -> HelmRepository -> HelmChart -> HelmRelease -> Deployment / Pod
```

哪一层还是旧的，问题通常就卡在哪一层附近。
