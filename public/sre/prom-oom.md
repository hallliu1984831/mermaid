----- Chinese
# Prometheus 咋又OOM了？

## 事故背景
小李所在的监控团队在 Kubernetes 集群中搭建一个 prometheus 的服务，运行在POD中。主要用于收集产线机器的监控数据，这些监控数据都是通过安装在每台产线机器上的 telegraf 服务暴露出来的：
1. 内存使用限制为24G
2. 配置了3千个左右产线机器的扫描对象，收集的数据包括机器的CPU、内存、IO、网络等基础监控数据，以及应用的端口监控数据，如端口的QPS、RT、状态码等。
3. 采集周期为1分钟/次
4. 数据的保留期限设置为一个月

TIPS：
1. telegraf：一个开源的服务器端代理，用于从各种来源收集监控数据并将其转换为Prometheus支持的格式。包括以下场景：
   - 从系统中收集数据，如CPU、内存、磁盘、网络等
   - 从应用中收集数据，如JMX、StatsD、Graphite等
   - 从日志中收集数据，如Logstash、Fluentd等
   - 从数据库中收集数据，如Oracle、MySQL、PostgreSQL、MongoDB等
2. prometheus：一个开源的监控系统，用于收集、存储和查询时间序列数据。包括以下场景：
   - 从各种来源收集数据，如telegraf、JMX、StatsD、Graphite等
   - 存储时间序列数据
   - 通过PromQL查询和可视化数据
   - 支撑报警规则和通知


## 事故现场

### 第一步：隔三差五地重启
在一周时间内，prometheus的POD时不时重启，引起了团队的注意。作为监控系统的核心组件，prometheus的稳定性直接关系到整个监控系统的可用性。小李自然不敢怠慢，赶紧查看日志，发现如下告警信息：
```bash
# 告警信息
ALERT: Prometheus Pod Restarting
Status: FIRING
Pod: prometheus-server-xxx
Namespace: monitoring
Exit Code: 137
Reason: OOMKilled
```

紧接着登陆K8S集群，查看Pod状态：
```bash
kubectl get pods -n monitoring
NAME                    READY   STATUS     RESTARTS   AGE
prometheus-server-xxx   1/1     Running      12         2h
```

Exit Code 137, 这是OOM Killer的经典标志! 看起来 Prometheus的POD频繁重启的原因是OOM，导致监控数据不稳定，影响了对业务系统的实时监控。虽说当前检查时 Prometheus的POD已经运行了2小时，但小李心想：下一次重启也在路上了吧！


TIPS:
1. SIGKILL：137 = 128 + 9，这是Linux系统发送的“内存不足，强制杀死”信号。当一个进程耗尽了它被分配的内存资源时，Linux内核会通过发送SIGKILL信号来结束该进程，以防止它继续耗用系统资源。这也是对POD所在工作节点的资源进行保护，防止其他正常运行的POD因为一个异常POD而受到影响。

### 第二步：内存配置检查

```bash
# 检查当前内存配置
kubectl describe pod prometheus-server-xxx -n monitoring

Resources:
  Limits:
    memory: 24Gi
  Requests:
    memory: 24Gi
```

24GB内存，看起来应该够用了啊？🤔

### 第三步：临时救火 - 内存翻倍大法

小李心想：老是重启也不是个事儿，有啥快速解决的方案不？自然是有的：内存不够？那就加大POD的内存限制！

```yaml
# 第一次救火：24G → 48G
resources:
  limits:
    memory: 48Gi
  requests:
    memory: 48Gi
```

结果：过了两天，又OOM了！ 😂

### 第四步：继续加内存 - 64G终极大招

小李心想："48G看来不够？那就试试64G！得亏当前集群的资源还是足够的，不然64G的POD都别想起来运行！"

```yaml
# 第二次救火：48G → 64G
resources:
  limits:
    memory: 64Gi
  requests:
    memory: 64Gi
```

结果：这次不到两天，依然OOM！而且发生的趋势比之前更频繁了！

小李心想：碰上硬茬了，这下不好和老板交代了！一直加大内存这条路看来行不通啊！这应该不是内存大小的问题，貌似是有什么东西在疯狂消耗内存！

## Trouble Shooting：真凶现身

### 排查过程

通过Prometheus自带的cardinality分析页面 `http://prometheus:9090/api/v1/status/tsdb`，发现了罪魁祸首：

Top 10 label names with value count:
```
Name                Count
transaction_xid     2451602  ⚠️ 超高基数！
transaction_scn     2123458  ⚠️ 超高基数！
path               10090
id                 8604
name               5887
interface          5453
host               4899
volume_name        4554
```

Top 10 series count by metric names:
```
Name                                                    Count
current__inflight__transactions_transaction_size        1924305
current__inflight__transactions_transaction__redo__sequence  1924126
current__inflight__transactions_transaction__redo__thread__id  1924037
```

问题分析：
- `transaction_xid` 有 245万 个不同的值！
- `transaction_scn` 有 212万 个不同的值！
- 每个事务都有唯一的ID，导致指标数量呈指数级增长
- Prometheus需要为每个唯一的标签组合存储时间序列数据

TIPS:
1. High Cardinality：指监控系统中标签（label）的组合种类非常多，导致时间序列数据急剧增加。例如：监控一个Web应用，如果使用用户ID作为标签，那么每个用户都会生成一个唯一的时间序列，导致基数非常高。如果有多个高基数标签组合起来，那么笛卡尔积就会把时间序列数据的数量增加到更高的一个层级。
2. transaction_xid 和 transaction_scn：从指标上来看，这哥俩是Oracle数据库中用于标识事务的编号，每个事务都有唯一的编号，由于产线的数据库一直处于繁忙的状态，导致基数非常高。

### 💡 内存消耗计算

```bash
# 粗略计算：
# 每个时间序列 ≈ 1-3KB 内存
# 245万个 transaction_xid × 3KB ≈ 7.3GB
# 212万个 transaction_scn × 3KB ≈ 6.4GB
# 192万个 inflight_transactions × 3KB ≈ 5.8GB
# 总计：约 19GB+ 仅用于存储这些高基数指标！
```

## 🛠️ 解决方案：Drop High Cardinality Metrics

### 配置修改

如前分析，数据库层面收集的事务ID等高基数指标对我们没有价值，可以直接drop掉！
那接下来的事儿就简单多了，在Prometheus配置文件中添加metric_relabel_configs来丢弃高基数指标：

```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'application-metrics'
    static_configs:
      - targets: ['app:8080']
    metric_relabel_configs:
      # 丢弃包含transaction_xid的指标
      - source_labels: [__name__]
        regex: '.*transaction_xid.*'
        action: drop

      # 丢弃包含transaction_scn的指标
      - source_labels: [__name__]
        regex: '.*transaction_scn.*'
        action: drop

      # 丢弃高基数的inflight_transactions指标
      - source_labels: [__name__]
        regex: 'current__inflight__transactions.*'
        action: drop
```

### 重新部署

```bash
# 更新配置
kubectl create configmap prometheus-config --from-file=prometheus.yml -n monitoring --dry-run=client -o yaml | kubectl apply -f -

# 重启Prometheus
kubectl rollout restart deployment/prometheus-server -n monitoring

# 监控重启过程
kubectl get pods -n monitoring -w
```

## 🎉 问题解决
修复前：
- 内存配置：64GB
- 状态：频繁OOM重启
- 时间序列数量：300万+
- 内存使用：持续增长直到OOM

修复后：
- 内存配置：保持64GB（后续可以降回32GB）
- 状态：稳定运行
- 时间序列数量：50万左右
- 内存使用：稳定在 30GB 左右

检查pod状态：
```bash
# 验证修复效果
kubectl top pod prometheus-server-xxx -n monitoring
NAME                    CPU(cores)   MEMORY(bytes)
prometheus-server-xxx   2000m        30Gi

# 检查Pod状态
kubectl get pod prometheus-server-xxx -n monitoring
NAME                    READY   STATUS    RESTARTS   AGE
prometheus-server-xxx   1/1     Running   0          24h
```

## 复盘
解决了问题，小李心里放松了不少，总结了如下经验，分享给小伙伴们：

### 经验总结
1. OOM不一定是内存不够，可能是内存泄漏或高基数问题
2. 盲目增加内存只是治标不治本
3. High Cardinality是Prometheus的头号杀手
4. 监控指标设计需要考虑基数控制

### 扩展反思
在这个事例中，小李直接删除了高基数的指标，在无法删除高基数指标的场合，你有其他的方案么？来一起讨论下😁

----- English

# Why Does Prometheus Keep Running Out of Memory?

## Incident Background
Mike's monitoring team set up a Prometheus service running in a Kubernetes pod to collect monitoring data from production machines. All monitoring data is exposed through Telegraf services installed on each production machine:
1. Memory limit set to 24GB
2. Configured to scrape approximately 3,000 production machines, collecting basic monitoring data including CPU, memory, I/O, network metrics, as well as application port monitoring data such as QPS, response time, and status codes
3. Scrape interval: 1 minute
4. Data retention period: 1 month

Key Components:
1. Telegraf: An open-source server agent that collects monitoring data from various sources and converts it to Prometheus-compatible format, including:
   - System metrics: CPU, memory, disk, network
   - Application metrics: JMX, StatsD, Graphite
   - Log data: Logstash, Fluentd
   - Database metrics: Oracle, MySQL, PostgreSQL, MongoDB
2. Prometheus: An open-source monitoring system for collecting, storing, and querying time-series data, supporting:
   - Data collection from various sources like Telegraf, JMX, StatsD, Graphite
   - Time-series data storage
   - Data querying and visualization through PromQL
   - Alert rules and notifications

## The Incident Unfolds

### Step 1: Intermittent Restarts
Within a week, the Prometheus pod started restarting intermittently, catching the team's attention. As the core component of the monitoring system, Prometheus stability directly impacts the entire monitoring system's availability. Mike couldn't afford to ignore this and immediately checked the logs, finding the following alert:

```bash
# Alert Information
ALERT: Prometheus Pod Restarting
Status: FIRING
Pod: prometheus-server-xxx
Namespace: monitoring
Exit Code: 137
Reason: OOMKilled
```

He then logged into the K8S cluster to check the pod status:
```bash
kubectl get pods -n monitoring
NAME                    READY   STATUS     RESTARTS   AGE
prometheus-server-xxx   1/1     Running      6         2h
```

Exit Code 137 - this is the classic signature of the OOM Killer!

Technical Note:
SIGKILL: 137 = 128 + 9, this is the Linux system's "out of memory, force kill" signal. When a process exhausts its allocated memory resources, the Linux kernel sends a SIGKILL signal to terminate the process, preventing it from continuing to consume system resources. This also protects the worker node's resources, preventing other normally running pods from being affected by one problematic pod.

### Step 2: Memory Configuration Check

```bash
# Check current memory configuration
kubectl describe pod prometheus-server-xxx -n monitoring

Resources:
  Limits:
    memory: 24Gi
  Requests:
    memory: 24Gi
```

24GB of memory - that should be enough, right? 🤔

### Step 3: Emergency Fix - Double the Memory

Mike thought: "Constant restarts aren't sustainable. What's a quick fix? Simple: not enough memory? Just increase the pod's memory limit!"

```yaml
# First rescue attempt: 24G → 48G
resources:
  limits:
    memory: 48Gi
  requests:
    memory: 48Gi
```

```bash
kubectl apply -f prometheus-config.yaml
kubectl rollout restart deployment/prometheus-server -n monitoring
```

Result: Two days later, OOM again! 😂

### Step 4: More Memory - The 64G Ultimate Move

"48G not enough? Let's go with 64G!"

```yaml
# Second rescue attempt: 48G → 64G
resources:
  limits:
    memory: 64Gi
  requests:
    memory: 64Gi
```

Result: This time, less than two days later, still OOM! And it was happening more frequently than before!

Mike realized: "Just keep adding memory isn't going to work! This isn't a memory size issue - something is consuming memory like crazy!"

## Troubleshooting: High Cardinality Reveals Itself

### Investigation Process

Using Prometheus's built-in cardinality analysis page `http://prometheus:9090/api/v1/status/tsdb`, the culprit was discovered:

Top 10 label names with value count:
```
Name                Count
transaction_xid     2451602  ⚠️ Extremely high cardinality!
transaction_scn     2123458  ⚠️ Extremely high cardinality!
path               10090
id                 8604
name               5887
interface          5453
host               4899
volume_name        4554
```

Top 10 series count by metric names:
```
Name                                                    Count
current__inflight__transactions_transaction_size        1924305
current__inflight__transactions_transaction__redo__sequence  1924126
current__inflight__transactions_transaction__redo__thread__id  1924037
```

Problem Analysis:
- `transaction_xid` has 2.45 million different values!
- `transaction_scn` has 2.12 million different values!
- Each transaction has a unique ID, causing exponential growth in metric count
- Prometheus needs to store time-series data for each unique label combination

Technical Notes:
1. High Cardinality: Refers to monitoring systems where label combinations are extremely numerous, causing time-series data to increase dramatically. For example: when monitoring a web application, if user ID is used as a label, each user generates a unique time series, resulting in very high cardinality. When multiple high-cardinality labels are combined, the Cartesian product increases the number of time series to an even higher level.
2. transaction_xid and transaction_scn: From the metrics, these appear to be Oracle database transaction identifiers. Each transaction has a unique number, and the production database is constantly busy, leading to extremely high cardinality.

### 💡 Memory Consumption Calculation

```bash
# Rough calculation:
# Each time series ≈ 1-3KB memory
# 2.45 million transaction_xid × 3KB ≈ 7.3GB
# 2.12 million transaction_scn × 3KB ≈ 6.4GB
# 1.92 million inflight_transactions × 3KB ≈ 5.8GB
# Total: approximately 19GB+ just for storing these high-cardinality metrics!
```

## 🛠️ Solution: Drop High Cardinality Metrics

### Configuration Changes

As analyzed above, the transaction ID and other high-cardinality metrics collected at the database level have no value for us and can be dropped directly! The solution becomes straightforward.
Add metric_relabel_configs to the Prometheus configuration file to drop high-cardinality metrics:

```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'application-metrics'
    static_configs:
      - targets: ['app:8080']
    metric_relabel_configs:
      # Drop metrics containing transaction_xid
      - source_labels: [__name__]
        regex: '.*transaction_xid.*'
        action: drop

      # Drop metrics containing transaction_scn
      - source_labels: [__name__]
        regex: '.*transaction_scn.*'
        action: drop

      # Drop high-cardinality inflight_transactions metrics
      - source_labels: [__name__]
        regex: 'current__inflight__transactions.*'
        action: drop
```

### Redeployment

```bash
# Update configuration
kubectl create configmap prometheus-config --from-file=prometheus.yml -n monitoring --dry-run=client -o yaml | kubectl apply -f -

# Restart Prometheus
kubectl rollout restart deployment/prometheus-server -n monitoring

# Monitor restart process
kubectl get pods -n monitoring -w
```

## 🎉 Problem Resolved

### Before and After Comparison

Before Fix:
- Memory configuration: 64GB
- Status: Frequent OOM restarts
- Time series count: 3+ million
- Memory usage: Continuously growing until OOM

After Fix:
- Memory configuration: Kept at 64GB (can be reduced to 32GB later)
- Status: Stable operation
- Time series count: Around 500,000
- Memory usage: Stable at around 30GB

```bash
# Verify fix effectiveness
kubectl top pod prometheus-server-xxx -n monitoring
NAME                    CPU(cores)   MEMORY(bytes)
prometheus-server-xxx   2000m        30Gi

# Check pod status
kubectl get pod prometheus-server-xxx -n monitoring
NAME                    READY   STATUS    RESTARTS   AGE
prometheus-server-xxx   1/1     Running   0          24h
```

## Post-Incident Review
With the problem resolved, Mike felt much more relaxed and summarized the following lessons to share with his teammates:

### Lessons Learned
1. OOM doesn't necessarily mean insufficient memory - it could be memory leaks or high cardinality issues
2. Blindly increasing memory only treats symptoms, not the root cause
3. High Cardinality is Prometheus's number one killer
4. Monitoring metric design needs to consider cardinality control

### Extended Reflection
In this case, Mike directly deleted the high-cardinality metrics. In situations where you can't delete high-cardinality metrics, do you have other solutions? Let's discuss! 😁
