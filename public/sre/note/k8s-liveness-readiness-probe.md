# K8S Liveness 和 Readiness 都失败，为什么结果完全不同？

上一篇文章发布后，有好几位小伙伴问了一个有深度的问题：

```text
下游服务挂了，为什么上游 Pod 会进入 CrashLoopBackOff？
```

我解释的原因是：上游服务的 `livenessProbe`，把下游服务是否可用也算进了检查。虽然有小伙伴认为不应该发生这样的错误，但它确实会发生，而且 Spring Boot 官方文档也专门提醒过这种风险：

![Spring Boot 官方文档：liveness 不应依赖外部系统](./k8s-liveness-external-state.png)

> 来源：[Spring Boot Reference Documentation](https://docs.spring.io/spring-boot/reference/actuator/endpoints.html#actuator.endpoints.kubernetes-probes.external-state)

这张图正好对应了一种可能的解释：如果上游服务把外部依赖放进 `livenessProbe`，下游故障就可能触发上游实例重启，并沿着依赖链继续放大，引发级联失败。

顺着这条链路，很自然地就涉及 K8S 里两个很容易混淆的探针：

```text
livenessProbe
readinessProbe
```

它们都可以调用 HTTP 接口，也都可能检查失败，但 K8S 的处理方式完全不同。

## Liveness：这个容器需要重启吗？

livenessProbe 用来判断：当前容器是否已经进入无法自行恢复的状态，需要通过重启解决。

比如应用发生死锁，接口已经无法响应。livenessProbe 连续失败并达到失败阈值 `failureThreshold` 后，kubelet 会终止并重启容器。

```text
livenessProbe 失败
  -> kubelet 终止容器
  -> kubelet 重启容器
  -> RESTARTS 增加
```

如果容器重启后，livenessProbe 还是不断失败，最终就可能进入 `CrashLoopBackOff`。

Pod Events 中一般能看到：

```text
Warning  Unhealthy  Liveness probe failed
Normal   Killing    Container failed liveness probe, will be restarted
```

## Readiness：这个容器现在应该接收流量吗？

readinessProbe 判断的不是“要不要重启”，而是：当前容器是否已经准备好接收流量。

readinessProbe 失败后，kubelet 不会重启容器。Pod 会被标记为 `NotReady`，并从 Service 的可用后端中移除。

```text
readinessProbe 失败
  -> Pod Ready=False
  -> Service 不再向它转发新流量
  -> 容器继续运行
  -> RESTARTS 不增加
```

这时候 `kubectl get pod` 看到的状态更可能是：

```text
NAME        READY   STATUS    RESTARTS
my-app      0/1     Running   0
```

所以，`0/1 Running` 并不矛盾：容器还在运行，只是暂时不适合接收流量。

## 最容易踩的坑：Liveness 复用了综合健康接口

有些应用只有一个综合健康检查接口：

```text
/health
```

这个接口不仅检查当前进程，还可能检查数据库、Redis、消息队列和其他下游服务。

如果 livenessProbe 和 readinessProbe 都使用它：

```yaml
livenessProbe:
  httpGet:
    path: /health
    port: 8080

readinessProbe:
  httpGet:
    path: /health
    port: 8080
```

那么某个下游服务不可用时，`/health` 返回失败，livenessProbe 也会跟着失败。kubelet 随后重启当前容器，但重启当前容器并不能修复下游服务。

结果可能变成：

```text
下游服务异常
  -> 上游服务 livenessProbe 失败
  -> kubelet 重启上游容器
  -> 更多上游服务受到影响
  -> 故障沿着依赖链继续放大
```

## 两个探针应该检查什么？

更合理的做法，是为它们提供不同的判断：

```yaml
livenessProbe:
  httpGet:
    path: /health/live
    port: 8080

readinessProbe:
  httpGet:
    path: /health/ready
    port: 8080
```

路径不同只是表面，真正重要的是接口背后的判断逻辑：

- `/health/live`：只检查应用自身是否陷入无法自行恢复的状态，不检查数据库、下游 API 等外部依赖；
- `/health/ready`：判断当前应用是否适合接收流量，可以根据业务情况检查必要依赖。

即使是 readinessProbe，也不一定要检查所有外部依赖。如果一个共享数据库短暂异常导致所有副本同时变成 `NotReady`，整个服务仍然可能失去可用后端。

## 一句话记住

Liveness 问的是：

```text
重启当前容器，能不能解决这个问题？
```

Readiness 问的是：

```text
当前容器，现在该不该接收流量？
```

下游服务挂了，重启上游容器通常解决不了问题。所以，下游依赖不应该轻易放进 livenessProbe。
