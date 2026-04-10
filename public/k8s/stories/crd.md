----- Chinese
# 小李的困惑：K8S里怎么多了些奇怪的东西？

## 故事背景

有了上次成功解决了Prometheus OOM的问题经验后，小李工作的劲头更足了。没多久，领导就给他分配了一个新的需求：在Kubernetes集群里做一个调研：
"我们准备对生产环境的Web服务做一些性能优化，需要配置一些高级的路由策略和缓存规则。但是我们发现现有的Ingress配置好像不太够用，你能帮忙研究一下更好的解决方案吗？"

小李心想：K8S是个有意思的平台，Ingress也是我要学习的一个短板，这个机会再好不过了。于是回复领导：让我来看看现在的配置情况，了解以后再回复你！

## 当前部署

### 第一步：常规检查
小李的计划：首先看看当前集群的Ingress配置情况，了解一下当前的部署状态。

```bash
# 检查namespace下的资源
kubectl get all -n production
NAME                          READY   STATUS    RESTARTS   AGE
pod/web-app-xxx               1/1     Running   0          2d
pod/api-server-xxx            1/1     Running   0          1d

NAME                    TYPE        CLUSTER-IP      EXTERNAL-IP   PORT(S)    AGE
service/web-app-svc     ClusterIP   10.96.123.45    <none>        80/TCP     2d
service/api-server-svc  ClusterIP   10.96.123.46    <none>        8080/TCP   1d

NAME                         READY   UP-TO-DATE   AVAILABLE   AGE
deployment.apps/web-app      1/1     1            1           2d
deployment.apps/api-server   1/1     1            1           1d

NAME                               DESIRED   CURRENT   READY   AGE
replicaset.apps/web-app-xxx        1         1         1       2d
replicaset.apps/api-server-xxx     1         1         1       1d
```

看起来都是正常的K8S资源，但是没有看到Ingress相关的配置。小李心想："奇怪，没有Ingress资源，那流量是怎么路由的？"


### 第二步：顺藤摸瓜
突然他想起之前看到的 K8S 关于ingress的描述： 标准K8S Ingress资源本身无法独立工作，必须有Ingress Controller才能生效！
#### Ingress资源的本质：
Ingress只是一个配置声明（类似于"菜单"）
它告诉集群"我想要这样的路由规则"
但它本身不执行任何路由功能
#### Ingress Controller的作用：
Controller是实际的执行者（类似于"厨师"）
读取Ingress配置并实现具体的路由逻辑
没有Controller，Ingress配置就是一张废纸

想到这，小李决定再检查一下集群里是否有Ingress Controller相关资源：
```bash
kubectl get ingressroute -n production
NAME   AGE
web    2d
-----
kubectl get middleware -n production
NAME   AGE
auth   2d
```
小李一脸困惑："ingressroute和middleware？这些不是标准的K8S资源啊！看来这就是我要找的ingress controller了！"

接着，小李试了试常规的describe命令：

```bash
# 尝试查看这个奇怪的资源
kubectl describe ingressroute web -n production
```
命令输出了Engtry Point 和 Routes的信息，包括如下内容：
```yaml
apiVersion: traefik.containo.us/v1alpha1
kind: IngressRoute
metadata:
  name: web
  namespace: production
spec:
  entryPoints:
    - websecure
  routes:
    - match: Host(`production.example.com`)
      kind: Rule
      services:
        - name: web-app-svc
          port: 80
      middlewares:
        - name: auth
```

小李心想："原来如此！这个Ingress Controller使用了Traefik 提供的自定义资源类型来定义路由规则！"，再来看看相关的资源定义：
```bash
# 先看看集群里还有没有其他类似的"怪东西"
kubectl api-resources | grep -v "^NAME"
```
好家伙，输出了一大堆，小李看的眼花缭乱。再过滤一下Traefik 关键字

```bash
# 只看非标准的API资源
kubectl api-resources | grep traefik
ingressroutes                     traefik.containo.us/v1alpha1    true    IngressRoute
middlewares                       traefik.containo.us/v1alpha1    true    Middleware
serverstransports                 traefik.containo.us/v1alpha1    true    ServersTransport
tlsoptions                        traefik.containo.us/v1alpha1    true    TLSOption
tlsstores                         traefik.containo.us/v1alpha1    true    TLSStore
traefikservices                   traefik.containo.us/v1alpha1    true    TraefikService
```

"好家伙！Traefik 这个ingress controller平时不显山不漏水的，功能还真全啊！" 小李惊讶道。他突然想起了上次配置Prometheus监控时也遇到过类似的东西：

```bash
kubectl api-resources | grep monitoring
servicemonitors                   monitoring.coreos.com/v1        true    ServiceMonitor
prometheusrules                   monitoring.coreos.com/v1        true    PrometheusRule
```

小李拍了拍脑袋："我去！我每天在用的ServiceMonitor原来也是这种东西！"，真是搂草打兔子，学习了

### 第三步：CRD
再继续往下挖，CRD (Custom Resource Definition)浮出了水面，作为K8S提供的扩展机制，允许用户定义自己的资源类型。简单来说，K8S提供了很多resource供你选择使用，但是K8S原生的resource类型是有限的，无法满足所有场景的需求，CRD就是为了解决这个问题而存在的。

```bash
# 查看CRD（Custom Resource Definitions）
kubectl get crd | grep traefik
ingressroutes.traefik.containo.us                    2023-10-01T10:30:25Z
middlewares.traefik.containo.us                      2023-10-01T10:30:25Z
```

小李决定看看这个IngressRoute到底定义了啥：

```bash
# 看看这个CRD到底长什么样
kubectl describe crd ingressroutes.traefik.containo.us
```

看着满屏幕的输出，小李感叹："这玩意儿定义得还挺复杂，看起来是专门用来配置路由规则的。"

TIPS：
- Traefik：一个现代化的反向代理和负载均衡器，支持多种后端服务发现
- API Group：traefik.containo.us 是Traefik定义的API组，避免与其他CRD冲突
- Traefik CRD源码：https://github.com/traefik/traefik/tree/master/pkg/provider/kubernetes/crd 

### 第四步：Traefik怎么安装的
现在小李好奇了："这个Traefik和这些CRD是哪来的？"

像往常一样，小李熟练地敲起了命令，自然是从helm 命令开始：

```bash
helm list --all-namespaces
NAME            NAMESPACE       REVISION    UPDATED                                 STATUS      CHART           APP VERSION
traefik         traefik-system  1          2023-10-01 10:30:20.123 +0000 UTC      deployed    traefik-10.24.0     v2.10.4
```

"原来如此！" 小李眼前一亮，"这个Traefik是通过helm一键安装的，伴随着这些CRD是跟着一起装上的！"

## 需求实现

回到开头，领导给小李的任务是："我们准备对生产环境的Web服务做一些性能优化，需要配置一些高级的路由策略和缓存规则"。确认了K8S集群使用了Traefik Ingress Controller后，小李心里已经有了答案：按照Traefik的CRD来配置！

### 准备方案

一番调查学习以后，小李决定创建一个专门的性能优化中间件：

```yaml
# performance-middleware.yaml
apiVersion: traefik.containo.us/v1alpha1
kind: Middleware
metadata:
  name: performance-boost
  namespace: production
spec:
  compress: {}  # 启用压缩功能
  headers:
    customResponseHeaders:
      Cache-Control: "public, max-age=300"
      X-Content-Type-Options: "nosniff"
      X-Frame-Options: "DENY"
  rateLimit:
    burst: 100
    average: 50
```

然后更新现有的IngressRoute配置，添加性能优化中间件：

```yaml
# updated-ingressroute.yaml
apiVersion: traefik.containo.us/v1alpha1
kind: IngressRoute
metadata:
  name: web
  namespace: production
spec:
  entryPoints:
    - websecure
  routes:
    - match: Host(`production.example.com`)
      kind: Rule
      services:
        - name: web-app-svc
          port: 80
      middlewares:
        - name: auth
        - name: performance-boost  # 新增的性能优化中间件
```
TIPS:
compress: 启用压缩功能，可以减小响应数据的体积，提高传输速度
Cache-Control: "public, max-age=300" -- 缓存控制头，设置缓存时间为300秒
X-Content-Type-Options: "nosniff" -- 防止浏览器嗅探文件类型，提高安全性
X-Frame-Options: "DENY" -- 拒绝页面被iframe嵌套，防止点击劫持

### 方案提交
方案提交后，小李兴奋地等待着领导的审核结果。他知道，K8S的CRD学习之旅，才刚刚开始呢...

----- English
# What Are These Strange Things in the Cluster?

## Background

After successfully solving the Prometheus OOM issue last time, Mike was more motivated than ever. Soon enough, his manager assigned him a new task to investigate the Kubernetes cluster:
"We're planning to do some performance optimizations for our production Web services. We need to configure advanced routing strategies and caching rules. But we've found that our current Ingress configuration seems insufficient. Could you help research better solutions?"

Mike thought to himself: "K8S is such an interesting platform, and Ingress is definitely a knowledge gap I need to fill. This is a perfect opportunity." So he replied to his manager: "Let me check the current configuration and get back to you!"

## Current Deployment

### Step 1: Routine Check
Mike's plan: First, let's examine the current cluster's Ingress configuration to understand the current deployment status.

```bash
# Check resources in the namespace
kubectl get all -n production
NAME                          READY   STATUS    RESTARTS   AGE
pod/web-app-xxx               1/1     Running   0          2d
pod/api-server-xxx            1/1     Running   0          1d

NAME                    TYPE        CLUSTER-IP      EXTERNAL-IP   PORT(S)    AGE
service/web-app-svc     ClusterIP   10.96.123.45    <none>        80/TCP     2d
service/api-server-svc  ClusterIP   10.96.123.46    <none>        8080/TCP   1d

NAME                         READY   UP-TO-DATE   AVAILABLE   AGE
deployment.apps/web-app      1/1     1            1           2d
deployment.apps/api-server   1/1     1            1           1d

NAME                               DESIRED   CURRENT   READY   AGE
replicaset.apps/web-app-xxx        1         1         1       2d
replicaset.apps/api-server-xxx     1         1         1       1d
```

Everything looks like normal K8S resources, but Mike didn't see any Ingress-related configuration. Mike wondered: "Strange, no Ingress resources. How is traffic being routed then?"

### Step 2: Following the Trail

Suddenly, he remembered something he'd read about K8S Ingress before: Standard K8S Ingress resources cannot work independently—they require an Ingress Controller to function!

#### The Nature of Ingress Resources:
- Ingress is just a configuration declaration (like a "menu")
- It tells the cluster "I want these routing rules"
- But it doesn't execute any routing functionality itself

#### The Role of Ingress Controllers:
- Controller is the actual executor (like a "chef")
- Reads Ingress configuration and implements specific routing logic
- Without a Controller, Ingress configuration is just worthless paper

With this in mind, Mike decided to check if there were any Ingress Controller-related resources in the cluster:

```bash
kubectl get ingressroute -n production
NAME   AGE
web    2d
-----
kubectl get middleware -n production
NAME   AGE
auth   2d
```

Mike looked confused: "ingressroute and middleware? These aren't standard K8S resources! This must be the ingress controller I'm looking for!"

Then Mike tried the usual describe command:

```bash
# Try to examine this strange resource
kubectl describe ingressroute web -n production
```

The command output showed Entry Point and Routes information, including:

```yaml
apiVersion: traefik.containo.us/v1alpha1
kind: IngressRoute
metadata:
  name: web
  namespace: production
spec:
  entryPoints:
    - websecure
  routes:
    - match: Host(`production.example.com`)
      kind: Rule
      services:
        - name: web-app-svc
          port: 80
      middlewares:
        - name: auth
```

Mike thought: "I see! This Ingress Controller uses custom resource types provided by Traefik to define routing rules!" Let's look at the related resource definitions:

```bash
# Let's see if there are other similar "strange things" in the cluster
kubectl api-resources | grep -v "^NAME"
```

Wow, that output was overwhelming! Mike was getting dizzy looking at it all. Let's filter for Traefik-related stuff:

```bash
# Only look at non-standard API resources
kubectl api-resources | grep traefik
ingressroutes                     traefik.containo.us/v1alpha1    true    IngressRoute
middlewares                       traefik.containo.us/v1alpha1    true    Middleware
serverstransports                 traefik.containo.us/v1alpha1    true    ServersTransport
tlsoptions                        traefik.containo.us/v1alpha1    true    TLSOption
tlsstores                         traefik.containo.us/v1alpha1    true    TLSStore
traefikservices                   traefik.containo.us/v1alpha1    true    TraefikService
```

"Holy cow! This Traefik ingress controller has been flying under the radar, but it's actually packed with features!" Mike exclaimed. He suddenly remembered encountering something similar when configuring Prometheus monitoring last time:

```bash
kubectl api-resources | grep monitoring
servicemonitors                   monitoring.coreos.com/v1        true    ServiceMonitor
prometheusrules                   monitoring.coreos.com/v1        true    PrometheusRule
```

Mike slapped his forehead: "The ServiceMonitor I use every day is also one of these things!" Talk about learning something new by accident.

### Step 3: Understanding CRD

Digging deeper, CRD (Custom Resource Definition) emerged as K8S's extension mechanism that allows users to define their own resource types. Simply put, K8S provides many resources for you to choose from, but K8S native resource types are limited and can't meet all scenarios' needs. CRD exists to solve this problem.

```bash
# View CRD (Custom Resource Definitions)
kubectl get crd | grep traefik
ingressroutes.traefik.containo.us                    2023-10-01T10:30:25Z
middlewares.traefik.containo.us                      2023-10-01T10:30:25Z
```

Mike decided to see what this IngressRoute actually defined:

```bash
# Let's see what this CRD looks like
kubectl describe crd ingressroutes.traefik.containo.us
```

Looking at the screen full of output, Mike sighed: "This thing is defined pretty complexly. Looks like it's specifically for configuring routing rules."

TIPS:
- Traefik: A modern reverse proxy and load balancer supporting multiple backend service discovery methods
- API Group: traefik.containo.us is Traefik's defined API group to avoid conflicts with other CRDs
- Traefik CRD source code: https://github.com/traefik/traefik/tree/master/pkg/provider/kubernetes/crd

### Step 4: How Traefik Got Installed

Now Mike was curious: "Where did this Traefik and these CRDs come from?"

As usual, Mike skillfully typed commands, naturally starting with helm:

```bash
helm list --all-namespaces
NAME            NAMESPACE       REVISION    UPDATED                                 STATUS      CHART           APP VERSION
traefik         traefik-system  1          2023-10-01 10:30:20.123 +0000 UTC      deployed    traefik-10.24.0     v2.10.4
```

"Aha!" Mike's eyes lit up. "This Traefik was installed with one-click helm deployment, and these CRDs came along with it!"

## Implementation

Back to the beginning, Mike's manager gave him the task: "We're planning to do some performance optimizations for our production Web services, need to configure advanced routing strategies and caching rules." After confirming the K8S cluster uses Traefik Ingress Controller, Mike already had his answer: Configure according to Traefik's CRDs!

### Preparing the Solution

After all his investigation and learning, Mike decided to create a dedicated performance optimization middleware:

```yaml
# performance-middleware.yaml
apiVersion: traefik.containo.us/v1alpha1
kind: Middleware
metadata:
  name: performance-boost
  namespace: production
spec:
  compress: {}  # Enable compression
  headers:
    customResponseHeaders:
      Cache-Control: "public, max-age=300"
      X-Content-Type-Options: "nosniff"
      X-Frame-Options: "DENY"
  rateLimit:
    burst: 100
    average: 50
```

Then update the existing IngressRoute configuration to add the performance optimization middleware:

```yaml
# updated-ingressroute.yaml
apiVersion: traefik.containo.us/v1alpha1
kind: IngressRoute
metadata:
  name: web
  namespace: production
spec:
  entryPoints:
    - websecure
  routes:
    - match: Host(`production.example.com`)
      kind: Rule
      services:
        - name: web-app-svc
          port: 80
      middlewares:
        - name: auth
        - name: performance-boost  # Newly added performance optimization middleware
```

TIPS:
- `compress`: Enables compression functionality to reduce response data size and improve transmission speed
- `Cache-Control: "public, max-age=300"`: Cache control header setting cache time to 300 seconds
- `X-Content-Type-Options: "nosniff"`: Prevents browser from sniffing file types, improving security
- `X-Frame-Options: "DENY"`: Refuses page embedding in iframes, preventing clickjacking

### Solution Submission

After submitting his solution, Mike excitedly awaited his manager's review results. He knew that his K8S CRD learning journey had only just begun...

