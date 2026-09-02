# K8S 里的南北向和东西向流量，怎么理解？
同样是访问 K8S 集群里的一个服务，外部用户打不开 VS 集群里 Pod 之间互相访问失败，排查方向完全不一样。

在排查 K8S 网络问题时，经常会听到两个词：
```text
南北向流量
东西向流量
```

它们不是 K8S 独有的概念，而是网络架构里常见的说法。在网络架构里，南北向通常指“外部 <-> 内部”的流量，东西向通常指“内部 <-> 内部”的流量。

放到 K8S 集群里，可以先这样理解：

```text
南北向：集群外部 <-> 集群内部
东西向：集群内部 <-> 集群内部
```

## 南北向流量

南北向流量关注的是：外部请求怎么进入集群。

比如：

```text
用户请求
  -> LoadBalancer / Ingress / NodePort
  -> Service
  -> Endpoint
  -> Pod
```

如果外部用户访问服务失败，优先看这条链路：

- 域名解析是否正常；
- LoadBalancer / Ingress 是否正常；
- Service 是否选中了正确的 Pod；
- Endpoint 是否已经关联到后端 Pod；
- Pod 是否真的在监听对应端口。

## 东西向流量

东西向流量关注的是：集群内部服务之间怎么互相访问。

比如：

```text
Pod A
  -> Service B
  -> Pod B
```

如果一个服务访问另一个服务失败，优先看这条链路：

- Service 名称和 namespace 是否写对；
- CoreDNS 解析是否正常；
- Service 的 selector 是否选中了后端 Pod；
- NetworkPolicy 是否限制了访问。

## 为什么这个区分有用

排查网络问题时，第一步不是马上看服务的 YAML 定义。

更重要的是先判断：

```text
这条访问链路，是从集群外进来，还是在集群内部互访？
```

方向判断对了，后面才知道该重点看什么。

如果是南北向，重点通常在：

```text
DNS / Ingress / LoadBalancer / NodePort / Service / Endpoint
```

如果是东西向，重点通常在：

```text
Service / CoreDNS / Endpoint / NetworkPolicy / Pod
```

## 一句话记住

南北向看出入口。

东西向看集群内部服务互访。
