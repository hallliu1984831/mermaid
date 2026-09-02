# Helm Hook 是什么？升级前先跑一个 Job

Helm 升级应用前，能不能先自动跑一个脚本？
可以，用 Helm Hook。

## 关于 Helm 
Helm 是一个 K8S 的包管理器，可以方便地管理 K8S 应用的部署和升级。

简单理解，它有点像 K8S 世界里的包管理工具，会把一组 K8S YAML 文件（Deployment、Service、ConfigMap 等）组织成一个 Chart，方便统一安装、升级和回滚。

### 什么是 Helm Hook
Helm Hook 是 Helm 里的一个机制，允许在 Helm 发布流程的特定阶段执行一些操作。

## 在应用升级前，先自动执行一个任务

有些升级动作不能只靠 Deployment 自己完成。

比如应用新版本上线前，需要先跑一次数据库迁移脚本。迁移成功了，再继续升级应用；迁移失败了，就不要继续往下发布。

否则代码已经开始读新字段，但数据库表还没迁移，就可能直接报错。

这时候就可以用 Helm hook。

## 使用场景：
- Helm upgrade 前，先执行一个数据库迁移 Job。
- Job 成功后，再继续更新 Deployment、Service 等资源。

## 一个简单例子

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: db-migrate
  annotations:
    "helm.sh/hook": pre-upgrade
    "helm.sh/hook-delete-policy": before-hook-creation,hook-succeeded
spec:
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: migrate
          image: my-app:1.2.3
          command: ["sh", "-c", "python manage.py migrate"]
```

关键是这一行：

```yaml
"helm.sh/hook": pre-upgrade
```

它的意思是：

```text
在 Helm upgrade 真正更新主资源之前，先执行这个 Job。
```

## 一句话记住

Helm hook 不是新的 K8S 资源。

上面的例子本质上还是一个普通的 Kubernetes Job，只是通过 annotation 告诉 Helm：请在 `pre-upgrade` 阶段执行它。

比如：

```text
pre-upgrade  = 升级前执行
post-upgrade = 升级后执行
pre-install  = 安装前执行
post-install = 安装后执行
```

简单说：

```text
Deployment 负责把应用跑起来。
Helm Hook 负责在发布前后插一段动作。
```
