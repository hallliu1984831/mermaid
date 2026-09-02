# K8S Pod initContainer：升级前先跑一个 Job

Pod 启动前，能不能先自动跑一个脚本？
可以，之前我们提到过 helm webhook，今天来聊聊另一种方式：用 initContainer。

## 关于 initContainer

initContainer 是 Pod 里的一种特殊容器，会在主容器（main container）启动之前运行。

一个 Pod 可以定义多个 initContainer，它们会按顺序依次执行，前一个成功了，才会启动下一个；全部 initContainer 执行成功后，主容器才会启动。

简单说：
- Helm Hook：站在 Helm 发布流程这一层，先跑一个独立的 Job，成功后再继续发布。
- initContainer：站在 Pod 生命周期这一层，先跑 Pod 里的容器，成功后再启动主容器。

注意这里的"跑一次"和"每次都跑"不是绝对的：

- Helm Hook 是否执行、执行几次，取决于具体的 hook 类型和 delete-policy 配置。
- initContainer 只在 **Pod 被重新创建** 时才会重新执行；如果只是主容器崩溃，kubelet 通常只会在原 Pod 内重启主容器，不会重新执行 initContainer；只有 Pod 被删除并重新创建时，initContainer 才会重新执行。

## 使用场景

- Pod 启动前，先检查依赖的服务是否就绪（比如等数据库端口能连通）。
- 启动前先下载配置文件、证书，放到共享的 emptyDir 卷里，供主容器使用。
- 启动前跑一次轻量级的初始化脚本，比如生成配置文件、清理临时目录。

## 一个简单例子

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: my-app
spec:
  initContainers:
    - name: wait-for-db
      image: busybox:1.36
      command: ["sh", "-c", "until nc -z db-service 5432; do echo waiting for db; sleep 2; done"]
  containers:
    - name: my-app
      image: my-app:1.2.3
      ports:
        - containerPort: 8080
```

关键是这一段：

```yaml
initContainers:
  - name: wait-for-db
```

它的意思是：
- Pod 创建后，先运行 wait-for-db 这个容器；
- 它跑完（退出码为 0）之前，my-app 主容器不会启动。

## 一句话记住

initContainer 不是新的 K8S 资源类型。

它本质上还是普通的容器定义，只是写在 `initContainers` 字段里，K8S 会保证它们比 `containers` 里的主容器先跑，且必须跑成功。
