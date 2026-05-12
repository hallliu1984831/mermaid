----- Chinese
# 手搓监控数据：小李的升级打怪之旅

## 故事背景

最近，开发团队开发了一个全新的功能并部署到数据中心的K8S集群中。作为SRE团队的一员，小李被分配了一个看似简单的任务：负责监控这个新功能的运行情况。

小李心想："上线新功能，监控的配置和添加应该很快就能搞定！"然而，事情的发展却远比他想象的复杂...

## 第一步：了解新功能

通过查找提交的功能文档和代码仓库，小李很快弄清楚了新功能的基本信息：

### 技术架构
- Java工程：基于最新版本的Spring Boot实现
- 服务接口：通过REST API提供服务
- 业务逻辑：根据请求类型做不同的CRUD处理

### 核心流程
在更新处理场景中，系统需要：
1. 接收客户端的更新请求
2. 调用外部第三方服务进行数据同步
3. 根据外部更新结果，更新本地数据库数据

小李看了看架构图，点点头："挺清晰的，就是个典型的微服务架构。"

## 第二步：上线准备

在确保新功能的日志、指标等信息都能正常收集后，小李检查了新服务现有的监控指标。通过查看Prometheus的metrics端点，他发现应用已经暴露了一些基础指标：

```bash
# 查看应用暴露的指标
curl http://app-service:8080/actuator/prometheus

# 关键指标示例
service_requests_total{method="GET",status="200"} 1247
service_requests_total{method="POST",status="200"} 856
service_requests_total{method="POST",status="500"} 3

external_svc_invocation_result{result="success"} 934
external_svc_invocation_result{result="failure"} 23
```

小李看了一下这些指标，配置了相应的 Grafana 监控面板和告警规则，觉得基本够用了，于是结束了相应的task，新服务如期上线。

## 第三步：现实的打脸

新服务上线后运行了几天，小李在查看监控面板时发现了一个问题：更新处理调用第三方服务时，时不时会出现失败的情况。

监控面板显示，external_svc_invocation_result 这个指标的统计如下：
- Success: 2847次
- Failure: 23次

小李皱起了眉头："failure有23次，但具体是什么原因导致的失败呢？"

现有的`external_svc_invocation_result`指标只体现了`success`和`failure`两种状态，完全没有反映出更细致的错误信息：
- 是网络超时？
- 是第三方服务返回了错误码？
- 还是参数验证失败？

"这样的监控信息根本无法帮助我们快速定位问题啊！" 小李有些郁闷。于是他又检查了一遍应用暴露的其他指标，然而没有发现更详细的信息。

## 第四步：寻求帮助

小李很快给研发团队提交了改进需求单，需求描述如下：
> 请为`external_svc_invocation_result`指标增加错误码信息，包括但不限于：
> - HTTP状态码
> - 业务错误码
> - 超时类型
>
> 这样可以方便监控团队快速定位问题并采取相应措施。

然而，研发团队的回复让小李有些意外：

> "需求已收到，但由于当前sprint已经排满，这个修改需要在下一个季度才能提交。预计3个月后上线。"

小李看着这个回复，心情五味杂陈："3个月？那这段时间出问题怎么办？"

## 第五步：自力更生的决定

"既然短期内等不到开发团队的支持，那我就自己想办法！" 小李决定手搓监控数据来丰富监控信息。

### 现状分析

小李仔细分析了现有的信息源，发现程序运行时的日志中确实记录了具体的错误信息：

```log
2024-01-15 14:23:15.123 ERROR [external-svc] Failed to call external service: HTTP 500 - Internal Server Error
2024-01-15 14:25:32.456 ERROR [external-svc] Failed to call external service: HTTP 503 - Service Unavailable
2024-01-15 14:27:18.789 ERROR [external-svc] Failed to call external service: Timeout after 30000ms
2024-01-15 14:30:45.012 ERROR [external-svc] Failed to call external service: HTTP 400 - Invalid request parameters
```

"日志里的信息很详细，但是..." 小李意识到了问题的关键：

在当前团队的监控体系里，日志信息无法直接接入现有的 Prometheus 告警链路！

原因很简单：
- Prometheus的AlertManager依赖的是metric数据，不是日志
- 虽然可以通过日志分析工具查看错误，但当前团队并没有建设基于日志的统一告警链路
- 现有的监控体系都是基于时序数据库的指标体系

### 小李的解决方案

"既然日志有详细信息，metric缺少细节，那我就想办法把日志信息转换成metric！"

小李的思路很清晰：
1. 解析应用日志中的错误信息
2. 提取关键的错误分类信息
3. 将这些信息转换成可供Prometheus收集的指标
4. 通过这些"手搓"的指标设置精确的告警规则

"这也是当前最好的办法了！" 理清楚以后，小李兴奋地开始动手实现。

## 第六步：技术实现

### 方案设计

小李决定通过以下步骤实现：

1. 日志解析: 使用正则表达式解析错误日志
2. 指标生成: 将解析结果转换为Prometheus格式的指标
3. 数据推送: 通过PushGateway将指标推送到Prometheus
4. 监控配置: 基于新指标配置告警规则

### 第一版实现

小李很清楚，这一版只是“先跑起来”的应急方案，不是优雅方案。它的目标只有一个：

- 先把错误分类信息补进现有监控体系，让告警先具备可用性

为避免和 Prometheus 的 counter 语义混淆，他决定把这个脚本生成的值明确当成“最近5分钟窗口内的错误数”，而不是单调递增的总数。
为此，小李准备了一个bash 脚本，实现如下：
```bash
#!/bin/bash
LOG_FILE="/var/log/app/application.log"
PUSHGATEWAY_URL="http://pushgateway.monitoring.svc:9091"
JOB_NAME="external-svc-error-analysis"

# 解析最近5分钟的日志
parse_logs() {
    local timestamp_5min_ago=$(date -d '5 minutes ago' '+%Y-%m-%d %H:%M:%S')

    # 提取错误信息并统计
    grep "Failed to call external service" $LOG_FILE | \
    awk -v cutoff="$timestamp_5min_ago" '$1" "$2 > cutoff' | \
    while read -r line; do
        # 解析不同类型的错误
        if echo "$line" | grep -q "HTTP 500"; then
            echo "external_svc_error_window{error_type=\"http_500\",window=\"5m\"} 1"
        elif echo "$line" | grep -q "HTTP 503"; then
            echo "external_svc_error_window{error_type=\"http_503\",window=\"5m\"} 1"
        elif echo "$line" | grep -q "HTTP 400"; then
            echo "external_svc_error_window{error_type=\"http_400\",window=\"5m\"} 1"
        elif echo "$line" | grep -q "Timeout"; then
            echo "external_svc_error_window{error_type=\"timeout\",window=\"5m\"} 1"
        else
            echo "external_svc_error_window{error_type=\"unknown\",window=\"5m\"} 1"
        fi
    done | sort | uniq -c | \
    awk '{print $2" "$1}'
}
# 推送到PushGateway
push_metrics() {
    local metrics=$(parse_logs)

    if [ -n "$metrics" ]; then
        echo "$metrics" | curl -X POST \
            --data-binary @- \
            "$PUSHGATEWAY_URL/metrics/job/$JOB_NAME"

        echo "$(date): Pushed metrics to PushGateway"
        echo "$metrics"
    else
        echo "$(date): No errors found in recent logs"
    fi
}

# 执行推送
push_metrics
```

### 定时任务配置

```bash
# 添加cron任务，每5分钟执行一次
*/5 * * * * /opt/monitoring/log-to-metrics.sh >> /var/log/monitoring/log-metrics.log 2>&1
```

这套第一版脚本虽然简单能跑，但小李也给自己记下了几个局限：
- 每次都要扫描日志文件，日志越大越吃力
- 依赖日志格式稳定，一旦研发改日志模板就可能失效
- 统计窗口是离散的 5 分钟，不是实时流式处理
- PushGateway 在这里是为了快速接入现有 Prometheus 体系，不是长期最优架构

## 第七步：效果验证

脚本运行几个小时后，小李兴奋地打开Grafana查看效果：

```promql
# 新的详细错误监控
external_svc_error_window{error_type="http_500",window="5m"}  # 最近5分钟HTTP 500错误数
external_svc_error_window{error_type="http_503",window="5m"}  # 最近5分钟HTTP 503错误数
external_svc_error_window{error_type="timeout",window="5m"}   # 最近5分钟超时错误数
external_svc_error_window{error_type="http_400",window="5m"}  # 最近5分钟参数错误数
```

监控面板立刻变得清晰起来：
- HTTP 500错误：15次（第三方服务内部问题）
- HTTP 503错误：5次（第三方服务过载）
- 超时错误：3次（网络问题）

"不错！现在我们可以精确知道每种错误的发生频率了！" 小李接着配置了相应的告警规则：

```yaml
# Prometheus AlertManager配置
- alert: ExternalServiceHTTP500High
  expr: external_svc_error_window{error_type="http_500",window="5m"} > 10
  for: 0m
  annotations:
    summary: "第三方服务在最近5分钟内频繁返回500错误"
    description: "最近5分钟HTTP 500错误数为 {{ $value }}"

- alert: ExternalServiceTimeoutHigh
  expr: external_svc_error_window{error_type="timeout",window="5m"} > 5
  for: 0m
  annotations:
    summary: "第三方服务在最近5分钟内频繁超时"
    description: "最近5分钟超时错误数为 {{ $value }}"
```
TIPS:
- expr 是Prometheus查询语言（PromQL）的表达式，用于定义告警条件
- for 是告警持续时间，表示在多长时间内满足条件才触发告警，此处 0m 表示无需等待，查询结果大于阈值就立即触发
- annotations 是告警通知的内容，包括简要说明和详细描述

## 第八步：小李的复盘

### 经验总结
当前手搓监控的方案优缺点如下
优点：
- ✅ 快速解决了紧急的监控需求
- ✅ 成本低，实现简单
- ✅ 可以灵活调整解析规则
- ✅ 不需要等待开发团队的排期

缺点：
- ❌ 依赖于日志格式的稳定性
- ❌ 有一定的延迟（5分钟间隔）
- ❌ 需要额外的维护成本
- ❌ 无法完全替代原生的应用指标

### 小李的感悟

"这次经历让我明白了几件事：" 小李总结道：

1. SRE的价值不只是运维：有时候需要创造性地解决监控盲区问题
2. 日志和指标各有用途：日志记录详情，指标支持告警，两者结合威力更大
3. 临时方案也能产生过渡价值：虽然是应急方案，但它帮团队平稳撑过了原生指标缺位的阶段
4. 主动出击比被动等待更有效：与其等待3个月，不如立即动手解决

### 下一步计划
有了第一版的实现，小李已经计划好了第二版的优化方案，要做的事情还不少呢。
至于第二版到底该往原生埋点、日志告警，还是更正规的日志转指标链路上走，小李还在继续摸索。但至少第一版已经帮团队撑过了最被动的阶段。
看到这儿，你是不是也有了自己的意见/建议呢？欢迎在评论区分享你的看法和经历，让我们一起学习和成长！


----- English


# Rolling His Own Monitoring Metrics: Mike's Level-Up Journey

## Story Background

Recently, the development team rolled out a brand new feature and deployed it to the K8S cluster in the data center. As a member of the SRE team, Mike was given a seemingly simple task: monitor how this new feature behaved in production.

Mike thought to himself, "A new feature is going live—getting the monitoring configured should be quick enough." However, things turned out to be far more complicated than he expected...

## Step 1: Understanding the New Feature

By looking up the submitted feature documentation and code repository, Mike quickly figured out the basic information about the new feature:

### Technical Architecture
- Java Project: implemented based on the latest version of Spring Boot
- Service Interface: provides services via REST API
- Business Logic: performs different CRUD processing based on request types

### Core Flow
In the update processing scenario, the system needs to:
1. Receive update requests from clients
2. Call external third-party services for data synchronization
3. Update local database data based on the external update results

Mike looked at the architecture diagram and nodded: "Pretty clear, just a typical microservices architecture."

## Step 2: Preparation for Go-Live

After confirming that the new feature's logs, metrics, and other telemetry were being collected properly, Mike reviewed the service's existing monitoring metrics. By checking Prometheus's metrics endpoint, he found that the application was already exposing some basic metrics:

```bash
# View metrics exposed by the application
curl http://app-service:8080/actuator/prometheus

# Key metrics examples
service_requests_total{method="GET",status="200"} 1247
service_requests_total{method="POST",status="200"} 856
service_requests_total{method="POST",status="500"} 3

external_svc_invocation_result{result="success"} 934
external_svc_invocation_result{result="failure"} 23
```

Mike reviewed these metrics, set up the corresponding Grafana dashboards and alert rules, and felt the coverage was good enough for launch. The new service went live as scheduled.

## Step 3: A Harsh Reality Check

A few days after the new service went live, Mike found an issue while looking at the monitoring dashboards: when calling third-party services during update processing, failures would occasionally occur.

The monitoring dashboard showed the statistics for the `external_svc_invocation_result` metric as follows:
- Success: 2847 times
- Failure: 23 times

Mike frowned: "There are 23 failures, but what specifically caused them?"

The existing `external_svc_invocation_result` metric only reflected two states, `success` and `failure`, completely failing to reflect more detailed error information:
- Was it a network timeout?
- Did the third-party service return an error code?
- Or did parameter validation fail?

"This kind of monitoring information fundamentally cannot help us quickly pinpoint the problem!" Mike felt a bit frustrated. So he checked other metrics exposed by the application again, yet found no more detailed information.

## Step 4: Seeking Help

Mike quickly submitted an improvement request ticket to the R&D team, with the following description:
> Please add error code information to the `external_svc_invocation_result` metric, including but not limited to:
> - HTTP status codes
> - Business error codes
> - Timeout types
>
> This will help the monitoring team quickly locate problems and take corresponding measures.

However, the R&D team's reply caught Mike a bit off guard:

> "Request received, but since the current sprint is already full, this modification won't be submitted until the next quarter. It's expected to go live in 3 months."

Looking at this reply, Mike had mixed feelings: "3 months? Then what if a problem occurs during this time?"

## Step 5: The Decision to be Self-Reliant

"Since I can't get support from the development team anytime soon, I'll figure out a workaround myself!" Mike decided to roll his own monitoring metrics to make the dashboards and alerts more useful.

### Current Situation Analysis

Mike carefully analyzed the existing information sources and found that the specific error messages were indeed recorded in the program's runtime logs:

```log
2024-01-15 14:23:15.123 ERROR [external-svc] Failed to call external service: HTTP 500 - Internal Server Error
2024-01-15 14:25:32.456 ERROR [external-svc] Failed to call external service: HTTP 503 - Service Unavailable
2024-01-15 14:27:18.789 ERROR [external-svc] Failed to call external service: Timeout after 30000ms
2024-01-15 14:30:45.012 ERROR [external-svc] Failed to call external service: HTTP 400 - Invalid request parameters
```

"The information in the logs is very detailed, but..." Mike realized the crux of the problem:

In the current team's monitoring system, log information cannot be directly integrated into the existing Prometheus alerting pipeline!

The reason is simple:
- Prometheus's AlertManager relies on metric data, not logs
- Although errors can be viewed through log analysis tools, the current team hasn't built a unified alerting pipeline based on logs
- The existing monitoring systems are all metric systems based on time-series databases

### Mike's Solution

"Since the logs have detailed information and the metrics lack details, I'll find a way to convert the log information into metrics!"

Mike's plan was straightforward:
1. Parse error messages in application logs
2. Extract key error classification information
3. Convert this information into metrics that Prometheus can collect
4. Build precise alerting rules on top of these hand-built metrics

"This is the best option we have right now!" Once the plan was clear, Mike got to work.

## Step 6: Technical Implementation

### Solution Design

Mike decided to implement it through the following steps:

1. Log Parsing: Use regular expressions to parse error logs
2. Metric Generation: Convert parsing results into Prometheus-formatted metrics
3. Data Push: Push metrics to Prometheus via PushGateway
4. Monitoring Configuration: Configure alert rules based on the new metrics

### First Version Implementation

Mike knew very well that this version was just an emergency "get it running first" solution, not an elegant one. It had only one goal:

- Get the error classification information into the existing monitoring system first, making the alerting usable

To avoid confusion with Prometheus's counter semantics, he decided to explicitly treat the value generated by this script as "the number of errors within the recent 5-minute window," rather than a monotonically increasing total.
To this end, Mike prepared a bash script implemented as follows:
```bash
#!/bin/bash
LOG_FILE="/var/log/app/application.log"
PUSHGATEWAY_URL="http://pushgateway.monitoring.svc:9091"
JOB_NAME="external-svc-error-analysis"

# Parse logs from the last 5 minutes
parse_logs() {
    local timestamp_5min_ago=$(date -d '5 minutes ago' '+%Y-%m-%d %H:%M:%S')

    # Extract and count error messages
    grep "Failed to call external service" $LOG_FILE | \
    awk -v cutoff="$timestamp_5min_ago" '$1" "$2 > cutoff' | \
    while read -r line; do
        # Parse different types of errors
        if echo "$line" | grep -q "HTTP 500"; then
            echo "external_svc_error_window{error_type=\"http_500\",window=\"5m\"} 1"
        elif echo "$line" | grep -q "HTTP 503"; then
            echo "external_svc_error_window{error_type=\"http_503\",window=\"5m\"} 1"
        elif echo "$line" | grep -q "HTTP 400"; then
            echo "external_svc_error_window{error_type=\"http_400\",window=\"5m\"} 1"
        elif echo "$line" | grep -q "Timeout"; then
            echo "external_svc_error_window{error_type=\"timeout\",window=\"5m\"} 1"
        else
            echo "external_svc_error_window{error_type=\"unknown\",window=\"5m\"} 1"
        fi
    done | sort | uniq -c | \
    awk '{print $2" "$1}'
}

# Push to PushGateway
push_metrics() {
    local metrics=$(parse_logs)

    if [ -n "$metrics" ]; then
        echo "$metrics" | curl -X POST \
            --data-binary @- \
            "$PUSHGATEWAY_URL/metrics/job/$JOB_NAME"

        echo "$(date): Pushed metrics to PushGateway"
        echo "$metrics"
    else
        echo "$(date): No errors found in recent logs"
    fi
}

# Execute push
push_metrics
```

### Cron Job Configuration

```bash
# Add cron job, execute every 5 minutes
*/5 * * * * /opt/monitoring/log-to-metrics.sh >> /var/log/monitoring/log-metrics.log 2>&1
```

Although this first version of the script was simple and worked, Mike also noted a few limitations for himself:
- The log file has to be scanned every time; the larger the log, the more taxing it is
- It relies on the stability of the log format; if R&D changes the log template, it might break
- The statistics window is a discrete 5 minutes, not real-time stream processing
- PushGateway is used here for rapid integration into the existing Prometheus system, not as the long-term optimal architecture

## Step 7: Effect Verification

After the script ran for a few hours, Mike excitedly opened Grafana to check the effects:

```promql
# New detailed error monitoring
external_svc_error_window{error_type="http_500",window="5m"}  # HTTP 500 errors in the last 5 minutes
external_svc_error_window{error_type="http_503",window="5m"}  # HTTP 503 errors in the last 5 minutes
external_svc_error_window{error_type="timeout",window="5m"}   # Timeout errors in the last 5 minutes
external_svc_error_window{error_type="http_400",window="5m"}  # Parameter errors in the last 5 minutes
```

The monitoring dashboard immediately became clear:
- HTTP 500 errors: 15 times (Internal problem with the third-party service)
- HTTP 503 errors: 5 times (Third-party service overload)
- Timeout errors: 3 times (Network issue)

"Nice! Now we can know exactly the frequency of each type of error!" Mike then configured the corresponding alert rules:

```yaml
# Prometheus AlertManager configuration
- alert: ExternalServiceHTTP500High
  expr: external_svc_error_window{error_type="http_500",window="5m"} > 10
  for: 0m
  annotations:
    summary: "Third-party service frequently returned 500 errors in the last 5 minutes"
    description: "The number of HTTP 500 errors in the last 5 minutes was {{ $value }}"

- alert: ExternalServiceTimeoutHigh
  expr: external_svc_error_window{error_type="timeout",window="5m"} > 5
  for: 0m
  annotations:
    summary: "Third-party service frequently timed out in the last 5 minutes"
    description: "The number of timeout errors in the last 5 minutes was {{ $value }}"
```
TIPS:
- `expr` is a Prometheus Query Language (PromQL) expression used to define alert conditions
- `for` is the alert duration, indicating how long the condition must be met before triggering the alert. Here `0m` means no waiting; if the query result is greater than the threshold, it triggers immediately
- `annotations` contains the content of the alert notification, including a brief summary and a detailed description

## Step 8: Mike's Retrospective

### Experience Summary
The pros and cons of the current hand-crafted monitoring solution are as follows:

Pros:
- ✅ Quickly solved an urgent monitoring requirement
- ✅ Low cost, simple implementation
- ✅ Flexible adjustment of parsing rules
- ✅ No need to wait for the development team's schedule

Cons:
- ❌ Relies on the stability of the log format
- ❌ Has some delay (5-minute intervals)
- ❌ Requires additional maintenance costs
- ❌ Cannot completely replace native application metrics

### Mike's Reflections

"This experience made me understand a few things," Mike summarized:

1. SRE's value isn't just operations: sometimes it requires creatively solving monitoring blind spot problems
2. Logs and metrics each have their uses: logs record details, metrics support alerting; combining them is far more powerful
3. Temporary solutions can also have transitional value: although it's an emergency solution, it helped the team smoothly tide over the phase when native metrics were absent
4. Taking the initiative is more effective than passively waiting: rather than waiting 3 months, it's better to immediately take action and solve it

### Next Steps Plan
With the first version implemented, Mike has already planned the optimization scheme for the second version, and there's still a lot to do.
As for whether the second version should move toward native instrumentation, log-based alerting, or a more formal log-to-metric pipeline, Mike is still exploring. But at least the first version has helped the team get through the most passive phase.
Seeing this, do you have any opinions or suggestions of your own? Welcome to share your views and experiences in the comments section, let's learn and grow together!