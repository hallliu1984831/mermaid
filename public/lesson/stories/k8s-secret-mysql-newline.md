----- Chinese
# MySQL 连接失败：K8S Secret 给小李上了一课

## 故事背景

经历过前几次 K8S 故障以后，小李总结出一个朴素规律：生产环境里，很多问题都不是系统自己突然坏了，而是伴随着变更一起出现的。

但业务不可能不变更：新功能要上线，老功能要修 bug，依赖库要升级，安全漏洞要修复，环境也要持续调整。退一步说，如果完全没有变更，SRE 这份工作可能也就少了一半存在感。

好消息是，上次故障以后，生产环境的告警消停了一阵子。小李刚觉得终于能喘口气，当天晚上就收到了告警通知：新版本发布后，Pod 一直起不来。

```bash
ALERT: K8S Pod Restart Too Many Times
Namespace: production
Pod: inventory-api-6f78c9c8d7-pm4xq
Message: pod restart count increased rapidly
```
小李看到消息后，心里一紧，先在群里回复："我先看一下现场，稍后同步。" 他原本以为这只是一次普通的 Pod 启动失败，没想到这次真正的问题，藏在一个肉眼几乎看不见的字符里。

## 1. 检查失败信息
第一步自然是检查报错信息，小李登录到集群以后，先看 Pod 状态：

```bash
kubectl get pods -n production | grep inventory
NAME                         READY   STATUS             RESTARTS   AGE
inventory-api-6f78c9c8d7-pm4xq   0/1     CrashLoopBackOff   4          6m
inventory-api-6f78c9c8d7-r7n2c   0/1     CrashLoopBackOff   4          6m
```
看样子，这个 inventory 服务的 Pod 已经凉透了，启动失败了几次，进入 `CrashLoopBackOff` 的状态：如果没人管的话，就会这样不断重启，进入退避循环。

看到这个状态，小李心里先排除了几个方向：这不是镜像拉取失败，也不是调度失败，Pod 已经启动过，只是应用进程启动后很快退出了。接下来要看的，就是应用日志，看看为啥起不来！

## 2. 日志指向 MySQL Access denied

小李先查看其中一个失败 Pod 的日志：

```bash
kubectl logs inventory-api-6f78c9c8d7-pm4xq -n production
```

日志里最显眼的是这几行：

```bash
2026-05-24 10:18:23.421 ERROR [main] com.zaxxer.hikari.pool.HikariPool:
HikariPool-1 - Exception during pool initialization.

java.sql.SQLException: Unable to obtain connection from database
(jdbc:mysql://mysqldb:3306/inventory?Unicode=true&characterEncoding=UTF-8)
for user 'root': Access denied for user 'root'@'10.244.3.71' (using password: YES)
```

又看了一下上一个容器实例的日志，使用 --previous （或者 -p） 参数：

```bash
kubectl logs inventory-api-6f78c9c8d7-pm4xq -n production --previous
```
看到的结果一样：
```bash
Access denied for user 'root'@'10.244.3.71' (using password: YES)
Application startup failed, exiting...
```

这下方向看起来很明确：这不是服务无法连接 MySQL，而是连上了以后 MySQL 拒绝了认证。

根据过往的经验，小李很快就有了初步判断，第一反应是："要么账号密码错了，要么 MySQL 侧权限没有放这个来源地址，要么应用拿到的配置不是预期配置。"

在下一步检查之前，小李先查看了启动失败的这个 inventory 服务的上下文：inventory 服务是一个检查商品在库状态的微服务，依赖 MySQL 的数据进行盘点等在库信息检查，而且账号密码是通过 K8S Secret 注入的。
更关键的是：这是服务的第一次部署，不出意外的话就出意外了。

## 3. 先确认数据库、Service 和网络没有明显问题

小李先检查了服务的 deployment 配置，明确了服务使用了 mysqldb 这个 Service 来连接 DB，账号密码来自 `db-credentials` 这个 Secret，key 分别是 `username` 和 `password`。
```bash
kubectl get deployment inventory-api -n production -o yaml | grep -A20 "env:"
.....
env:
  - name: DB_HOST
    value: mysqldb
  - name: DB_PORT
    value: "3306"
  - name: DB_USERNAME
    valueFrom:
      secretKeyRef:
        name: db-credentials
        key: username
  - name: DB_PASSWORD
    valueFrom:
      secretKeyRef:
        name: db-credentials
        key: password
.....
```

接下来看 MySQL 的 Service：

```bash
kubectl get svc -n production mysqldb
NAME      TYPE        CLUSTER-IP    EXTERNAL-IP   PORT(S)    AGE
mysqldb   ClusterIP   10.96.72.18   <none>        3306/TCP   120d
```

再看 Service 背后的 Endpoint：

```bash
kubectl get endpoints -n production mysqldb
NAME      ENDPOINTS           AGE
mysqldb   10.244.1.38:3306    120d
```

Service 和 Endpoint 都在。

为了确认不是 DNS 解析问题，小李进入一个还在运行的订单服务 Pod 里看了一眼：

```bash
kubectl exec -it order-api-6c9f7f8d5f-2k9lm -n production -- sh
## 在容器中
nslookup mysqldb
```

输出也正常：

```bash
Server:    10.96.0.10
Address 1: 10.96.0.10 kube-dns.kube-system.svc.cluster.local

Name:      mysqldb.production.svc.cluster.local
Address 1: 10.96.72.18 mysqldb.production.svc.cluster.local
```

从这些结果看，Service、Endpoint、DNS 都没有明显异常。

但这还不够。因为日志是 MySQL 认证失败，而不是连接超时。小李需要确认：同一个 namespace 里，用同样的 Service 地址、同样的账号密码，能不能真的连上 MySQL。

## 4. 在同一个 namespace 下启动 mysql-client Pod 验证

小李决定在 `production` namespace 下临时启动一个 MySQL 客户端 Pod。这个验证很关键，因为它能把很多问题一次性排除掉：
- namespace 内 DNS 是否正常
- 到 MySQL Service 的网络是否正常
- MySQL 端口是否可达
- `root/password` 这组账号密码本身是否有效

他执行如下命令，启动测试 Pod：

```bash
kubectl run mysql-client -n production --rm -it \
  --image=mysql:8.0 \
  --restart=Never \
  -- bash
```

进入临时 Pod 后，直接连接 MySQL：

```bash
mysql -h mysqldb -P 3306 -u root -p

## 终端提示输入密码：
Enter password:
```

小李手动输入 `password` 后，成功进入 MySQL：

```bash
Welcome to the MySQL monitor.  Commands end with ; or \g.
Your MySQL connection id is 184223
Server version: 8.0.35 MySQL Community Server - GPL

mysql>
```

为了再确认一下当前用户和数据库可用性，他简单执行了两条命令：

```sql
select current_user();
show databases;
```

输出正常：

```bash
+----------------+
| current_user() |
+----------------+
| root@%         |
+----------------+

+--------------------+
| Database           |
+--------------------+
| information_schema |
| mysql              |
| inventory          |
+--------------------+
```

这个结果让问题变得更有意思了：同一个 namespace、同一个 Service、同一个用户名、同一个密码，临时 Pod 能连上，业务 Pod 却连不上。

小李盯着终端想了一会儿："数据库没问题，Service 没问题，网络没问题，手动测试的账号密码本身也没问题。
那就只剩一个问题：业务 Pod 实际拿到的账号密码，难道和我手动输入的这个账号密码不一样？不应该啊？这不都是标准的 base64 处理的 username/password 吗？" 突然小李意识到自己给自己提了一个灵魂三问，苦笑一下，决定再确认一下 Secret 里的值。

## 5. Secret 解码后看起来也没问题

在库服务的数据库账号密码是通过 Secret 注入的，小李继续查看 Secret：

```bash
kubectl get secret db-credentials -n production -o yaml
## 输出结果：
apiVersion: v1
kind: Secret
metadata:
  name: db-credentials
  namespace: production
type: Opaque
data:
  username: cm9vdAo=
  password: cGFzc3dvcmQK
```

第一眼看，Secret 是存在的，key 也对。接着小李把值解码出来：

```bash
echo 'cm9vdAo=' | base64 -d
root

echo 'cGFzc3dvcmQK' | base64 -d
password
```

看起来也完全正确。到这里，排查一度有点卡住: K8S 里的 Secret 存在，相应的 key 引用也正确，base64 解码出来的用户名和密码看着也是 `root` 和 `password`；临时测试的 mysql-client Pod 中手动输入 `root/password` 又能连上。

那业务 Pod 为什么还是 `Access denied`？ 小李虽然不抱什么希望，但还是先试了一次重启，排除 Pod 偶发状态异常的可能：
```bash
kubectl rollout restart deployment inventory-api -n production
```
错误依旧！这回，重启大法也不好使了！

正一筹莫展的时候，小李忽然意识到一个细节："看起来一样，不一定真的一样。尤其是 Secret 这种值，不能只看肉眼输出。"

## 6. 真正异常：Secret 值里多了一个换行符

小李换了一种方式检查 Secret 的值，这次他不用普通输出，而是看解码后的字节：

```bash
echo 'cGFzc3dvcmQK' | base64 -d | od -An -t x1

## 输出如下：
 70 61 73 73 77 6f 72 64 0a
```

前面的字节很正常：`70 61 73 73 77 6f 72 64` 对应字符串就是：`password`

但最后多了一个：`0a`，也就是换行符 `\n`。

再看 username：

```bash
echo 'cm9vdAo=' | base64 -d | od -An -t x1

## 输出如下，`root` 后面也多了一个 `0a`。
 72 6f 6f 74 0a
```

小李这下终于明白了：Secret 解码出来肉眼看是 `root` 和 `password`，但应用实际拿到的是：

```bash
## 实际得到的值
DB_USERNAME="root\n"
DB_PASSWORD="password\n"

## 期望得到的值
DB_USERNAME="root"
DB_PASSWORD="password"
```

MySQL 认证时，`password` 和 `password\n` 当然不是同一个密码。这也解释了为什么临时 mysql-client Pod 手动输入密码能成功，而业务 Pod 启动时却认证失败。

## 7. 根因：用 `--from-file` 创建 Secret 时把换行符也带进去了

找到异常字节以后，小李继续往前查 Secret 是怎么创建的。没多久，他在 Git 仓库的 README.md 看到一段初始化 Secret 的说明：

```bash
kubectl create secret generic db-credentials \
  --from-file=username=username.txt \
  --from-file=password=password.txt \
  -n production
```

紧接着，他检查了发布环境，发现 README.md 提到的两个文件：
- username.txt
- password.txt

小李打开一看，内容很简单：
```bash
cat username.txt
root

cat password.txt
password
```

还是看起来没问题。但这次小李没有只用 `cat`。他继续看不可见字符：`$` 表示文件末尾存在换行。
```bash
cat -A username.txt
root$

cat -A password.txt
password$
```

再用字节确认：
```bash
od -An -t x1 password.txt
 70 61 73 73 77 6f 72 64 0a
```

根因终于清楚了：
1. 根据 Git 仓库的说明，当时有人在发布环境用 vim 创建了 `username.txt` 和 `password.txt`
2. 文件保存时末尾带了换行符
3. `kubectl create secret --from-file` 会把文件内容原样放进 Secret
4. 文件里的换行符也被原样写进了 Secret
5. 应用通过环境变量读取 Secret 后，拿到的是带换行的用户名和密码
6. MySQL 认证失败，应用启动退出
7. Pod 进入 `CrashLoopBackOff`

这不是 MySQL 故障，也不是 K8S Secret 不生效，更不是 Service 网络问题。
真正的问题，是创建 Secret 的源文件里多了一个不可见的换行符。

## 8. 先修复现场：重新创建 Secret 并重启应用

根因确认后，小李先准备修复生产环境。为了避免继续把换行符写进去，他没有再用 `echo` 生成文件，而是用 `printf`：

```bash
printf 'root' > username.txt
printf 'password' > password.txt
```

然后先检查文件内容，这次末尾没有 `$`：

```bash
cat -A username.txt
root

cat -A password.txt
password
```

再检查字节，没有 `0a`：

```bash
od -An -t x1 password.txt
 70 61 73 73 77 6f 72 64
```

接着重新生成并应用 Secret：

```bash
kubectl create secret generic db-credentials \
  --from-file=username=username.txt \
  --from-file=password=password.txt \
  -n production \
  --dry-run=client -o yaml | kubectl apply -f -
```

Secret 更新以后，由于应用是通过环境变量读取 Secret，已经启动的 Pod 不会自动拿到新值。所以小李重启 Deployment：

```bash
kubectl rollout restart deployment inventory-api -n production
```

观察 rollout：

```bash
kubectl rollout status deployment/inventory-api -n production

## 输出正常：
deployment "inventory-api" successfully rolled out
```

再看 Pod：

```bash
kubectl get pods -n production | grep inventory
NAME                         READY   STATUS    RESTARTS   AGE
inventory-api-7c9f8b6d6c-dk28m   1/1     Running   0          1m
inventory-api-7c9f8b6d6c-fp7q9   1/1     Running   0          1m
inventory-api-7c9f8b6d6c-mn42x   1/1     Running   0          1m
```

应用日志里也不再出现 MySQL 认证失败：

```bash
kubectl logs inventory-api-7c9f8b6d6c-dk28m -n production

## log 检查正常
HikariPool-1 - Starting...
HikariPool-1 - Start completed.
Started InventoryApiApplication in 12.438 seconds
```

最后健康检查也恢复正常：

```bash
curl http://inventory-api.production.svc.cluster.local:8080/health
ok
```

小李在群里同步："新版本 Pod 已经正常启动，MySQL 连接恢复。根因是 Secret 中的用户名和密码带了换行符，应用实际使用的值和手动验证时输入的值不完全一致。"

## 9. 为什么这个问题容易误导人

故障恢复后，小李回头看这次排查，觉得这个问题特别容易误导人。

首先，日志非常像数据库问题：

```bash
Access denied for user 'root'@'10.244.3.71' (using password: YES)
```

看到这行日志，大多数人都会先怀疑：
- 密码错了
- MySQL 权限没开
- 账号来源地址不允许
- 数据库侧配置被改了

其次，手动连接 MySQL 是成功的，这说明数据库、网络和账号本身都没问题。再次，Secret 解码后肉眼看起来也是正确的：

```bash
echo 'cGFzc3dvcmQK' | base64 -d
password
```

但真正的问题就藏在普通输出看不出来的地方。如果不看字节，不看 `cat -A`，不检查字符串长度，就很容易在"配置看着没问题"这一层来回打转。

## 10. 改进建议：不要让不可见字符进入 Secret

### 提出质疑
小李在复盘时提了一个问题：创建这类简单 key/value 的 K8S Secret 时，为什么不优先使用 `--from-literal`？这样可以避免文件末尾换行符带来的问题，命令如下：

```bash
kubectl create secret generic db-credentials \
  --from-literal=username=root \
  --from-literal=password='password' \
  -n production \
  --dry-run=client -o yaml | kubectl apply -f -
```
原因也很直观：不能将用户名、密码等敏感信息上传到 Git 仓库。如果把包含 `--from-literal` 的命令直接写进发布仓库，明文密码就跟着泄露了。

而当发布流程要求从安全通道、CI Secret 或 Secret Manager 获取凭据时，可以在发布环境（执行 `kubectl` 的机器上）临时生成 `username.txt` 和 `password.txt`，再通过 `--from-file` 创建 Secret。这样可以避免把明文密码写进 Git，但前提是这些临时文件不能被提交、不能进入日志，并且用完后要清理。

这次的问题不是 `--from-file` 这个方案本身不行，而是创建临时文件时，没有注意到文件末尾的换行符，导致换行符也被原样写进了 Secret。

### 操作规范
澄清质疑后，小李提了两个建议：
- 创建这类文件时，优先使用 `printf`，不要直接使用 `echo`，因为 `echo` 默认会在末尾加换行符，而 `printf` 不会。
- 如果确实使用 `echo`，至少要加 `-n` 参数；不过从可移植性和可读性看，`printf` 更适合作为团队规范。


创建文件后，使用 `od -An -t x1` 命令查看字节，确认没有 `0a`。
创建 Secret 后，也要直接从集群里读取当前 Secret 的值，再解码检查：如果输出里没有 `0a`，才说明写进 Secret 的值确实没有末尾换行。

```bash
kubectl get secret db-credentials -n production \
  -o jsonpath='{.data.password}' | base64 -d | od -An -t x1
```


### 最佳实践
再往长期看，如果团队已经有比较成熟的发布流程，小李建议不要长期依赖人工在本地生成明文文件再创建 Secret。

更稳妥的方式，是把数据库账号密码放在专门的 Secret Manager 里，例如云厂商 KMS/Secrets Manager、Vault，或者通过 External Secrets Operator 这类组件同步到 K8S Secret。这样可以把几个问题从流程上规避掉：

1. 明文密码不需要进入 Git 仓库
2. 发布脚本里不需要直接写明文密码
3. 人工创建临时文件的机会减少
4. Secret 的来源、更新和审计更清楚

当然，这并不意味着 `--from-file` 不能用。它适合临时修复、低复杂度环境或者过渡阶段。但在生产环境里，Secret 最好不要只靠“人手工操作时足够小心”来保证正确。

## 小李的复盘

这次问题之后，小李对 K8S Secret 的理解又多了一层: 以前排查 Secret 问题时，他更多关注这些点：

1. Secret 是否存在
2. Secret 是否在正确 namespace
3. key 名是否写对
4. Deployment 是否正确引用
5. base64 解码后内容是否正确

但这次以后，他又补了一条：解码后的值是否包含不可见字符

因为对程序来说，`password` 和 `password\n` 是两个完全不同的字符串。

K8S 没有做错，Secret 也没有失效。它只是忠实保存了你交给它的内容，包括那个你没有注意到的换行符。这也是这次故障最值得记住的地方：配置的值不只是"看起来是什么"，还包括长度、格式和不可见字符。

## 补充说明

- `CrashLoopBackOff`：表示容器启动后反复退出，kubelet 进入退避重启状态。
- Secret：K8S 中用于保存敏感信息的资源类型，常用于保存密码、证书、token 等。
- `--from-file`：从文件创建 Secret，文件内容会被原样写入 Secret，包括末尾换行符。
- `--from-literal`：从命令行字面量创建 Secret，适合简单的 key/value。
- Base64：K8S Secret 的 `data` 字段使用 Base64 编码，Base64 不是加密。
- `cat -A`：可以显示文件中的不可见字符，例如行尾 `$`。
- `od -An -t x1`：按十六进制查看字节，适合确认是否存在 `0a` 这类换行字符。

----- English
# MySQL Connection Failed: A K8S Secret Taught Mike a Lesson

## Background

After going through several K8S incidents, Mike came to a simple conclusion: in production, many problems do not appear because the system suddenly breaks on its own. They often show up together with a change.

But the business cannot stop changing. New features have to be released, old features need bug fixes, dependencies need upgrades, security vulnerabilities need patches, and environments keep evolving. Put another way, if nothing ever changed, half of the SRE job might disappear with it.

The good news was that after the last incident, production alerts had been quiet for a while. Mike had just started to feel that he could finally catch his breath when an alert came in that evening: after a new release, the Pod would not start.

```bash
ALERT: K8S Pod Restart Too Many Times
Namespace: production
Pod: inventory-api-6f78c9c8d7-pm4xq
Message: pod restart count increased rapidly
```

Mike saw the alert, felt his stomach tighten, and replied in the group chat: "I'll check the scene first and update everyone shortly." At first, he thought this was just another ordinary Pod startup failure. He did not expect the real problem to be hidden in a character that was almost invisible to the eye.

## 1. Check the Failure

The first step was naturally to check the error. After logging into the cluster, Mike looked at the Pod status:

```bash
kubectl get pods -n production | grep inventory
NAME                         READY   STATUS             RESTARTS   AGE
inventory-api-6f78c9c8d7-pm4xq   0/1     CrashLoopBackOff   4          6m
inventory-api-6f78c9c8d7-r7n2c   0/1     CrashLoopBackOff   4          6m
```

The inventory service Pods were clearly in bad shape. They had failed to start several times and had entered `CrashLoopBackOff`. If nobody intervened, they would keep restarting in a backoff loop.

Looking at this status, Mike ruled out a few possibilities in his head. This was not an image pull failure, and it was not a scheduling failure. The Pods had started before, but the application process exited quickly after startup. The next thing to check was the application log.

## 2. The Logs Pointed to MySQL Access Denied

Mike first checked the log of one failed Pod:

```bash
kubectl logs inventory-api-6f78c9c8d7-pm4xq -n production
```

These lines stood out:

```bash
2026-05-24 10:18:23.421 ERROR [main] com.zaxxer.hikari.pool.HikariPool:
HikariPool-1 - Exception during pool initialization.

java.sql.SQLException: Unable to obtain connection from database
(jdbc:mysql://mysqldb:3306/inventory?Unicode=true&characterEncoding=UTF-8)
for user 'root': Access denied for user 'root'@'10.244.3.71' (using password: YES)
```

He also checked the log from the previous container instance with the `--previous` option, also available as `-p`:

```bash
kubectl logs inventory-api-6f78c9c8d7-pm4xq -n production --previous
```

The result was the same:

```bash
Access denied for user 'root'@'10.244.3.71' (using password: YES)
Application startup failed, exiting...
```

At this point, the direction looked clear. The service was not failing to reach MySQL. It had connected, and MySQL rejected the authentication.

Based on past experience, Mike quickly formed an initial judgment: "Either the username or password is wrong, MySQL has not allowed this source address, or the application is not getting the configuration we expect."

Before moving on, Mike checked the context of the failing inventory service. It was a microservice that checked product stock status and depended on MySQL for inventory data. Its database credentials were injected through a K8S Secret.

More importantly, this was the service's first deployment. And when something is not supposed to go wrong, that is often exactly when it does.

## 3. First Confirm the Database, Service, and Network

Mike first checked the service's Deployment configuration. The service used the `mysqldb` Service to connect to the database, and its credentials came from the `db-credentials` Secret. The keys were `username` and `password`.

```bash
kubectl get deployment inventory-api -n production -o yaml | grep -A20 "env:"
.....
env:
  - name: DB_HOST
    value: mysqldb
  - name: DB_PORT
    value: "3306"
  - name: DB_USERNAME
    valueFrom:
      secretKeyRef:
        name: db-credentials
        key: username
  - name: DB_PASSWORD
    valueFrom:
      secretKeyRef:
        name: db-credentials
        key: password
.....
```

Then he checked the MySQL Service:

```bash
kubectl get svc -n production mysqldb
NAME      TYPE        CLUSTER-IP    EXTERNAL-IP   PORT(S)    AGE
mysqldb   ClusterIP   10.96.72.18   <none>        3306/TCP   120d
```

Then the Endpoint behind the Service:

```bash
kubectl get endpoints -n production mysqldb
NAME      ENDPOINTS           AGE
mysqldb   10.244.1.38:3306    120d
```

Both the Service and Endpoint were there.

To make sure this was not a DNS resolution issue, Mike entered an order service Pod that was still running:

```bash
kubectl exec -it order-api-6c9f7f8d5f-2k9lm -n production -- sh
## Inside the container
nslookup mysqldb
```

The output was normal:

```bash
Server:    10.96.0.10
Address 1: 10.96.0.10 kube-dns.kube-system.svc.cluster.local

Name:      mysqldb.production.svc.cluster.local
Address 1: 10.96.72.18 mysqldb.production.svc.cluster.local
```

From these results, the Service, Endpoint, and DNS all looked normal.

But that was not enough. The log showed MySQL authentication failure, not a connection timeout. Mike needed to confirm whether a Pod in the same namespace could really connect to MySQL using the same Service address and the same username and password.

## 4. Start a mysql-client Pod in the Same Namespace

Mike decided to temporarily start a MySQL client Pod in the `production` namespace. This verification was important because it could rule out several possibilities at once:

- Whether DNS inside the namespace was normal
- Whether the network path to the MySQL Service was normal
- Whether the MySQL port was reachable
- Whether the `root/password` credential pair itself was valid

He ran the following command to start a test Pod:

```bash
kubectl run mysql-client -n production --rm -it \
  --image=mysql:8.0 \
  --restart=Never \
  -- bash
```

Inside the temporary Pod, he connected to MySQL directly:

```bash
mysql -h mysqldb -P 3306 -u root -p

## The terminal prompted for a password:
Enter password:
```

After Mike manually entered `password`, he successfully entered MySQL:

```bash
Welcome to the MySQL monitor.  Commands end with ; or \g.
Your MySQL connection id is 184223
Server version: 8.0.35 MySQL Community Server - GPL

mysql>
```

To further confirm the current user and database availability, he ran two simple commands:

```sql
select current_user();
show databases;
```

The output looked normal:

```bash
+----------------+
| current_user() |
+----------------+
| root@%         |
+----------------+

+--------------------+
| Database           |
+--------------------+
| information_schema |
| mysql              |
| inventory          |
+--------------------+
```

This made the problem more interesting. In the same namespace, using the same Service, the same username, and the same password, the temporary Pod could connect, but the application Pod could not.

Mike stared at the terminal for a moment. "The database is fine. The Service is fine. The network is fine. The credentials I tested manually are fine too. So there is only one possibility left: is the application Pod actually getting a different username or password than the one I typed manually? That should not be the case, right? Isn't this just standard base64 handling for username and password?" Mike suddenly realized he had asked himself three uncomfortable questions in a row. He gave a wry smile and decided to check the Secret value again.

## 5. The Secret Looked Correct After Decoding

The database credentials for the inventory service were injected through a Secret, so Mike continued checking the Secret:

```bash
kubectl get secret db-credentials -n production -o yaml
## Output:
apiVersion: v1
kind: Secret
metadata:
  name: db-credentials
  namespace: production
type: Opaque
data:
  username: cm9vdAo=
  password: cGFzc3dvcmQK
```

At first glance, the Secret existed and the keys were correct. Mike then decoded the values:

```bash
echo 'cm9vdAo=' | base64 -d
root

echo 'cGFzc3dvcmQK' | base64 -d
password
```

Everything looked correct. At this point, the investigation got stuck for a while. The Secret existed in K8S, the referenced keys were correct, and the base64-decoded username and password looked like `root` and `password`. The temporary mysql-client Pod could also connect when Mike manually entered `root/password`.

So why was the application Pod still getting `Access denied`? Mike did not have much faith in it, but he still tried restarting the Deployment once to rule out an occasional Pod state issue:

```bash
kubectl rollout restart deployment inventory-api -n production
```

The error remained. This time, even the classic restart trick did not help.

Just when he felt stuck, Mike suddenly noticed a detail: "Looking the same does not mean being the same. Especially for Secret values, you cannot rely only on what your eyes see."

## 6. The Real Problem: The Secret Value Had a Newline

Mike changed how he inspected the Secret value. This time, instead of using normal output, he looked at the decoded bytes:

```bash
echo 'cGFzc3dvcmQK' | base64 -d | od -An -t x1

## Output:
 70 61 73 73 77 6f 72 64 0a
```

The earlier bytes were normal: `70 61 73 73 77 6f 72 64` corresponded to the string `password`.

But there was one extra byte at the end: `0a`, which is the newline character `\n`.

He checked the username as well:

```bash
echo 'cm9vdAo=' | base64 -d | od -An -t x1

## Output: `root` also had an extra `0a` at the end.
 72 6f 6f 74 0a
```

Now Mike understood. The Secret looked like `root` and `password` after decoding, but the application was actually receiving:

```bash
## Actual values
DB_USERNAME="root\n"
DB_PASSWORD="password\n"

## Expected values
DB_USERNAME="root"
DB_PASSWORD="password"
```

During MySQL authentication, `password` and `password\n` are obviously not the same password. This also explained why the temporary mysql-client Pod could connect when Mike manually typed the password, while the application Pod failed during startup.

## 7. Root Cause: `--from-file` Preserved the Newline

After finding the abnormal byte, Mike traced how the Secret had been created. Before long, he found an initialization instruction in the Git repository's `README.md`:

```bash
kubectl create secret generic db-credentials \
  --from-file=username=username.txt \
  --from-file=password=password.txt \
  -n production
```

Then he checked the release environment and found the two files mentioned in the `README.md`:

- username.txt
- password.txt

Mike opened them. The content was simple:

```bash
cat username.txt
root

cat password.txt
password
```

Still, everything looked fine. But this time, Mike did not stop at `cat`. He checked the invisible characters. The `$` indicated that the file ended with a newline:

```bash
cat -A username.txt
root$

cat -A password.txt
password$
```

He confirmed it again at the byte level:

```bash
od -An -t x1 password.txt
 70 61 73 73 77 6f 72 64 0a
```

The root cause was finally clear:

1. According to the Git repository instructions, someone had used vim in the release environment to create `username.txt` and `password.txt`
2. The files were saved with a trailing newline
3. `kubectl create secret --from-file` stores the file content in the Secret exactly as it is
4. The newline in the file was also written into the Secret
5. After the application read the Secret through environment variables, it received a username and password with trailing newlines
6. MySQL authentication failed, and the application exited during startup
7. The Pod entered `CrashLoopBackOff`

This was not a MySQL failure. It was not a K8S Secret failure either, and it was not a Service networking issue.

The real problem was an invisible newline in the source file used to create the Secret.

## 8. Stop the Bleeding: Recreate the Secret and Restart the Application

After confirming the root cause, Mike started fixing production. To avoid writing the newline again, he did not use `echo` to generate the files. He used `printf` instead:

```bash
printf 'root' > username.txt
printf 'password' > password.txt
```

Then he checked the file content. This time, there was no trailing `$`:

```bash
cat -A username.txt
root

cat -A password.txt
password
```

He checked the bytes again. There was no `0a`:

```bash
od -An -t x1 password.txt
 70 61 73 73 77 6f 72 64
```

Next, he regenerated and applied the Secret:

```bash
kubectl create secret generic db-credentials \
  --from-file=username=username.txt \
  --from-file=password=password.txt \
  -n production \
  --dry-run=client -o yaml | kubectl apply -f -
```

After the Secret was updated, existing Pods would not automatically receive the new values because the application read the Secret through environment variables. So Mike restarted the Deployment:

```bash
kubectl rollout restart deployment inventory-api -n production
```

He watched the rollout:

```bash
kubectl rollout status deployment/inventory-api -n production

## Output was normal:
deployment "inventory-api" successfully rolled out
```

Then he checked the Pods:

```bash
kubectl get pods -n production | grep inventory
NAME                         READY   STATUS    RESTARTS   AGE
inventory-api-7c9f8b6d6c-dk28m   1/1     Running   0          1m
inventory-api-7c9f8b6d6c-fp7q9   1/1     Running   0          1m
inventory-api-7c9f8b6d6c-mn42x   1/1     Running   0          1m
```

The application logs no longer showed MySQL authentication failures:

```bash
kubectl logs inventory-api-7c9f8b6d6c-dk28m -n production

## Log check passed
HikariPool-1 - Starting...
HikariPool-1 - Start completed.
Started InventoryApiApplication in 12.438 seconds
```

Finally, the health check recovered:

```bash
curl http://inventory-api.production.svc.cluster.local:8080/health
ok
```

Mike updated the group chat: "The new version Pod has started normally, and the MySQL connection has recovered. The root cause was that the username and password in the Secret contained newline characters, so the values used by the application were not exactly the same as the values entered during manual verification."

## 9. Why This Problem Is Misleading

After the incident was resolved, Mike looked back and felt that this problem was especially misleading.

First, the log looked very much like a database issue:

```bash
Access denied for user 'root'@'10.244.3.71' (using password: YES)
```

When people see this log, they usually suspect:

- The password is wrong
- MySQL permissions are not open
- The source address is not allowed
- The database-side configuration was changed

Second, the manual MySQL connection succeeded, which showed that the database, network, and credential pair were all fine. Third, the decoded Secret also looked correct to the naked eye:

```bash
echo 'cGFzc3dvcmQK' | base64 -d
password
```

But the real problem was hidden somewhere normal output could not show. Without checking the bytes, using `cat -A`, or checking the string length, it is easy to keep circling around the idea that "the configuration looks fine."

## 10. Improvement: Keep Invisible Characters Out of Secrets

### A Question

During the post-incident review, Mike raised a question: when creating this kind of simple key/value K8S Secret, why not use `--from-literal` first? That would avoid the trailing newline problem caused by files:

```bash
kubectl create secret generic db-credentials \
  --from-literal=username=root \
  --from-literal=password='password' \
  -n production \
  --dry-run=client -o yaml | kubectl apply -f -
```

The reason was also straightforward: usernames, passwords, and other sensitive data must not be committed to the Git repository. If a command containing `--from-literal` is written directly into the release repository, the plaintext password is leaked with it.

When the release process requires credentials to be retrieved from a secure channel, CI Secret, or Secret Manager, it is acceptable to temporarily generate `username.txt` and `password.txt` in the release environment, meaning the machine that runs `kubectl`, and then create the Secret with `--from-file`. This avoids writing plaintext passwords into Git, but only if those temporary files are not committed, do not appear in logs, and are cleaned up after use.

The problem in this incident was not that `--from-file` itself was wrong. The problem was that the temporary files were created without noticing the trailing newline, and that newline was faithfully written into the Secret.

### Operational Rules

After clarifying the question, Mike gave two suggestions:

- When creating this type of file, prefer `printf` and do not use plain `echo`, because `echo` adds a trailing newline by default while `printf` does not.
- If `echo` must be used, at least use the `-n` option. But from the perspective of portability and readability, `printf` is a better team standard.

After creating the file, use `od -An -t x1` to inspect the bytes and confirm that there is no `0a`.

After creating the Secret, read the current Secret value directly from the cluster and decode it again. If the output has no `0a`, then the value written into the Secret truly has no trailing newline.

```bash
kubectl get secret db-credentials -n production \
  -o jsonpath='{.data.password}' | base64 -d | od -An -t x1
```

### Best Practice

In the long run, if the team already has a mature release process, Mike would not recommend relying on humans to manually generate plaintext files locally and then create Secrets.

A more robust approach is to store database usernames and passwords in a dedicated Secret Manager, such as a cloud provider's KMS or Secrets Manager, Vault, or to synchronize them into K8S Secrets through a component like External Secrets Operator. This helps avoid several problems at the process level:

1. Plaintext passwords do not need to enter the Git repository
2. Release scripts do not need to contain plaintext passwords
3. There are fewer chances for humans to create temporary files manually
4. The source, update process, and audit trail of Secrets become clearer

Of course, this does not mean `--from-file` cannot be used. It is suitable for temporary fixes, low-complexity environments, or transition periods. But in production, Secret correctness should not depend only on people being careful during manual operations.

## Mike's Post-Incident Review

After this incident, Mike gained another layer of understanding about K8S Secrets. In the past, when troubleshooting Secret problems, he mostly focused on these checks:

1. Does the Secret exist?
2. Is the Secret in the correct namespace?
3. Are the key names correct?
4. Does the Deployment reference it correctly?
5. Does the decoded base64 content look correct?

After this incident, he added one more checkpoint: whether the decoded value contains invisible characters.

To a program, `password` and `password\n` are two completely different strings.

K8S did nothing wrong, and the Secret did not fail. It simply stored exactly what it was given, including the newline that nobody noticed. That was the most important lesson from this incident: a configuration value is not just what it "looks like." It also includes length, format, and invisible characters.

## Additional Notes

- `CrashLoopBackOff`: Indicates that a container repeatedly exits after starting, and kubelet backs off before restarting it again.
- Secret: A K8S resource type used to store sensitive information, often passwords, certificates, tokens, and similar data.
- `--from-file`: Creates a Secret from a file. The file content is written into the Secret exactly as it is, including any trailing newline.
- `--from-literal`: Creates a Secret from command-line literal key/value pairs. It is suitable for simple key/value data.
- Base64: The `data` field in a K8S Secret uses Base64 encoding. Base64 is not encryption.
- `cat -A`: Shows invisible characters in a file, such as `$` at the end of a line.
- `od -An -t x1`: Displays bytes in hexadecimal, useful for confirming whether newline bytes such as `0a` exist.
