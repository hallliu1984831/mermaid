# K8S Graceful Shutdown 是什么？Pod 退出前先等一等

Pod 被删除时，一般是会马上被杀掉的，能不能暂缓这个过程？

可以，用 Graceful Shutdown 设置。

## 关于 Graceful Shutdown

Graceful Shutdown 可以简单理解成：应用退出前，先给它一点时间处理手里的事情。

比如：
- 已经收到的请求，尽快处理完；
- 正在写的数据，尽量落盘；
- 已经建立的连接，尽量正常关闭；
- 需要清理的临时资源，尽量清理掉。

这不是让 Pod 永远不退出，而是让 Pod 不要被突然打断。

## K8S 里怎么配置

最常见的是两个配置：

```yaml
terminationGracePeriodSeconds: 30
lifecycle:
  preStop:
    exec:
      command: ["sh", "-c", "sleep 10"]
```

简单说：

- `terminationGracePeriodSeconds`：最多给 Pod 多少秒时间退出；
- `preStop`：容器停止前，先执行一段动作。

## 一个简单例子

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-app
spec:
  template:
    spec:
      terminationGracePeriodSeconds: 30
      containers:
        - name: my-app
          image: my-app:1.2.3
          lifecycle:
            preStop:
              exec:
                command: ["sh", "-c", "sleep 10"]
```

这段配置的意思是：

- Pod 要退出时，K8S 最多给它 30 秒；
- 退出前先执行 `preStop`；
- 这里的 `sleep 10` 可以理解成：先等 10 秒，再真正进入容器停止流程。

## preStop 不一定只能 sleep

`preStop` 里也可以执行脚本，比如：

```yaml
command: ["python", "/app/cleanup.py"]
```

这类脚本可以用来清理临时文件、通知外部系统、做一些退出前的收尾动作。

但要注意：`preStop` 的执行时间也算在 `terminationGracePeriodSeconds` 里面。

如果：
- terminationGracePeriodSeconds = 30 秒
- preStop 执行了 20 秒
- 那应用自己真正退出的时间就只剩下大约 10 秒。

如果 preStop 执行超过了 terminationGracePeriodSeconds 设置的时间会怎么办？
- 如果 preStop 超过 30s 还没跑完，kubelet 会给一个很短的一次性延长（约 2 秒），不是无限等它跑完。
- 延长时间也到了之后，kubelet 会强制 kill 容器进程（SIGKILL），preStop 因此被强制打断，而不是自然结束。
- 容器进程真正退出后，Pod 对象才会从集群里彻底移除。


## 一句话记住

Graceful Shutdown 不是不让 Pod 退出。

它是给 Pod 一段退出缓冲时间，让应用有机会把手里的事情处理完。
- terminationGracePeriodSeconds 负责给时间。
- preStop 负责退出前先做一段动作。
- 应用自己负责正确处理退出信号。