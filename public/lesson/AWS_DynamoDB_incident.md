----- Chinese
# AWS DynamoDB US-EAST-1 区域中断事故总结（SRE视角）

## 📋 事故概览

2025年10月19日，AWS最重要的区域US-EAST-1发生了一次严重的服务中断，持续约14.5小时，影响了DynamoDB、EC2、Lambda、ECS等多个核心服务。这次事故的根本原因是一个看似简单但极其致命的竞态条件（Race Condition）问题。

作为SRE，我们需要深入理解这次事故的技术细节、级联影响，以及从中汲取的宝贵经验教训。这不仅是一次技术故障的复盘，更是分布式系统设计和运维实践的重要案例研究。

核心关键词： 竞态条件、DNS故障、级联失败、TOCTOU问题、分布式系统韧性

## 一、先举个例子：什么是Race Condition（竞态条件）？

想象一下这个场景：

你和室友共用一个冰箱。某天晚上，你俩都发现牛奶快没了：
- 晚上10点：你看了一眼冰箱，发现牛奶还剩一点，心想"明天早上买"
- 晚上10:05：室友也看了冰箱，也觉得"明天早上买"
- 第二天早上7点：你去超市买了一箱牛奶
- 早上7:30：室友也去超市买了一箱牛奶
- 结果：冰箱里现在有两箱牛奶，浪费了！

这就是典型的竞态条件：两个人基于"过时的信息"做决定，导致了意外的结果。

在计算机系统中，这种问题更加致命。比如：
- 进程A检查"文件是否存在" → 不存在 → 准备创建
- 进程B也检查"文件是否存在" → 不存在 → 准备创建  
- 两个进程同时创建 → 💥 冲突！

---

## 二、这次AWS生产事故到底发生了什么？

### 📅 事故时间线
- 2025年10月19日 23:48 PDT - 事故开始
- 2025年10月20日 14:20 PDT - 完全恢复
- 影响时长：约14.5小时
- 影响范围：AWS最大的区域 US-EAST-1（北弗吉尼亚）

### 🎯 核心问题：DynamoDB的DNS竞态条件

AWS DynamoDB有一个自动化的DNS管理系统，包含两个组件：

1. DNS规划器（DNS Planner）：负责监控负载均衡器健康状态，定期生成新的DNS规划
2. DNS执行器（DNS Enactor）：在3个可用区独立运行，负责将DNS规划应用到Route53
为保证韧性，DNS 执行器在三个不同的可用区 (AZ) 中以冗余且完全独立的方式运行。每个独立的 DNS 执行器实例都会查找新的规划，并尝试通过 Route53 事务将当前规划替换为新规划，这样即使多个 DNS 执行器同时尝试更新同一个终端节点，也能确保每个终端节点都能以一致的规划完成更新。正常情况下，DNS 执行器会获取最新的规划，并开始逐一处理服务终端节点以应用该规划。这个过程通常能快速完成，有效确保 DNS 状态始终保持最新。
不幸的是，一个 DNS 执行器在更新多个 DNS 终端节点时遇到了异常高的延迟，需要不断重试。故障就这样开始了：
#### 💣 致命的竞态条件是这样发生的：

```
时间轴：
T1: 执行器A 开始应用"旧规划V1"（但处理很慢，遇到异常延迟）
T2: 规划器 生成了"新规划V2"、"V3"、"V4"...
T3: 执行器B 快速应用了"最新规划V5"，完成所有终端节点更新
T4: 执行器B 启动清理流程，删除"太旧的规划"（包括V1）
T5: 执行器A 终于完成处理，把"旧规划V1"应用到DynamoDB区域终端节点
    ⚠️ 问题：执行器A在开始时检查过"V1比之前的规划新"，但现在这个检查已经过时了！
T6: 执行器B 的清理流程发现V1太旧，直接删除
T7: 💥 灾难：区域终端节点的所有IP地址被移除，DNS解析失败！
```

### 🔥 连锁反应（雪崩效应）

1. DynamoDB不可用 (23:48 - 02:40)
   - 所有通过公共终端节点的连接失败
   - DNS解析返回空记录
   - 客户应用无法连接DynamoDB

2. EC2实例启动失败 (23:48 - 13:50)
   - DWFM（Droplet工作流管理器）依赖DynamoDB
   - 与所有droplet的租约超时
   - 恢复时陷入"拥塞崩溃"：重试任务堆积 → 租约再次超时 → 更多重试
   - 新实例启动返回"容量不足"错误

3. 网络配置同步延迟 (05:28 - 10:36)
   - 网络管理器积压大量任务
   - 新启动的EC2实例无法获得网络连接

4. NLB健康检查失败 (05:30 - 14:09)
   - 健康检查对象是网络未就绪的新实例
   - 健康状态在"失败"和"正常"之间反复横跳
   - 触发可用区DNS自动故障转移
   - 部分容量被移出服务

5. 其他服务受影响
   - Lambda：函数调用失败、SQS/Kinesis处理延迟
   - ECS/EKS/Fargate：容器启动失败
   - Amazon Connect：呼叫、聊天、工单处理错误
   - Redshift：查询失败、集群无法修改
   - IAM/STS：认证失败、控制台登录失败

---

## 三、从SRE角度的深度解读

### 🎓 这次事故的核心教训

#### 1️⃣ 分布式系统中的时间假设是危险的
SRE原则：
- ⚠️ 永远不要假设"检查时的状态"在"使用时仍然有效"（TOCTOU问题）
- ✅ 应该使用乐观锁或版本号机制在每次更新时验证

#### 2️⃣ 自动化系统需要"熔断机制"

DNS执行器在遇到异常延迟时，应该：
- 检测到处理时间异常 → 主动放弃当前规划
- 避免"僵尸进程"继续执行过时的操作

类比：就像你去超市买牛奶，如果发现路上堵车2小时，应该打电话确认室友是否已经买了，而不是傻傻地继续。

#### 3️⃣ 依赖关系的级联失败

```
DynamoDB DNS失败
    ↓
DynamoDB不可用
    ↓
DWFM无法维护租约
    ↓
EC2实例启动失败
    ↓
网络配置同步延迟
    ↓
NLB健康检查失败
    ↓
Lambda/ECS/Connect等服务受影响
```

SRE原则：
- 🔴 单点故障（SPOF）是致命的
- ✅ 核心服务（如DNS、DynamoDB）需要多区域冗余
- ✅ 依赖服务应该有降级模式（Graceful Degradation）

#### 4️⃣ 恢复过程中的"拥塞崩溃"

DWFM的问题：
```
租约超时 → 重试 → 任务堆积 → 处理变慢 → 租约再次超时 → 更多重试
```

这是典型的正反馈循环（Positive Feedback Loop），系统越忙越慢，越慢越忙。

SRE解决方案：
- ✅ 限流（Rate Limiting）：控制重试速率
- ✅ 背压（Backpressure）：根据队列长度动态调整
- ✅ 断路器（Circuit Breaker）：检测到异常时暂停重试

#### 5️⃣ 监控和告警的盲区

- DNS问题在23:48发生，但直到00:38才确定根因（耗时50分钟）
- NLB健康检查问题在05:30开始，06:52才被监控检测到（耗时82分钟）

SRE原则：
- ⚠️ 你无法修复你看不见的问题
- ✅ 需要端到端的健康检查，而不仅仅是组件级监控
- ✅ 合成监控（Synthetic Monitoring）：模拟真实用户请求

#### 6️⃣ 测试覆盖的不足

AWS承认：
> "此前没有针对这种情况的既定运维恢复流程"

SRE实践：
- ✅ 混沌工程（Chaos Engineering）：主动注入故障测试系统韧性
- ✅ 灾难恢复演练（DR Drills）：定期模拟大规模故障
- ✅ Game Days：团队协作演练故障响应


### 🛠️ AWS的改进措施

1. 立即行动：
   - ✅ 全球禁用DNS自动化系统（先止血）
   - ✅ 修复竞态条件
   - ✅ 增加保护措施防止应用错误规划

2. 中期改进：
   - ✅ NLB添加速率控制，限制单次故障转移移除的容量
   - ✅ EC2构建DWFM恢复流程的测试套件
   - ✅ 改进数据同步系统的限流机制

3. 长期优化：
   - ✅ 深入分析所有受影响服务
   - ✅ 寻找避免类似事件的方法
   - ✅ 缩短恢复时间


### 🎯 总结

这次事故是一个经典的分布式系统竞态条件案例，暴露了几个关键问题：

1. 时间假设的危险性：TOCTOU（Time-of-Check to Time-of-Use）问题
2. 级联失败的威力：一个DNS问题导致整个区域多个服务瘫痪
3. 恢复过程的复杂性：拥塞崩溃、正反馈循环
4. 测试覆盖的重要性：没有演练过的恢复流程在真实故障时会手忙脚乱

最重要的教训：
> 在分布式系统中，永远不要相信"过时的检查结果"。每次关键操作前都要重新验证前提条件。

这就像开车过十字路口：即使你看到绿灯，也要在进入路口前再次确认没有车闯红灯。在分布式系统中，这种"二次确认"机制能避免很多灾难性故障。


----- English
# AWS DynamoDB US-EAST-1 Region Outage Incident Summary (SRE Perspective)

## 📋 Incident Overview

On October 19, 2025, AWS's most critical region US-EAST-1 experienced a severe service disruption lasting approximately 14.5 hours, affecting multiple core services including DynamoDB, EC2, Lambda, ECS, and others. The root cause of this incident was a seemingly simple yet extremely deadly Race Condition problem.

As SREs, we need to deeply understand the technical details of this incident, its cascading impacts, and the valuable lessons learned. This is not just a technical failure post-mortem, but an important case study for distributed system design and operational practices.

Core Keywords: Race Condition, DNS Failure, Cascading Failure, TOCTOU Problem, Distributed System Resilience

## 1. First, An Example: What is a Race Condition?

Imagine this scenario:

You and your roommate share a refrigerator. One evening, you both notice the milk is running low:
- 10:00 PM: You check the fridge, see a little milk left, think "I'll buy some tomorrow morning"
- 10:05 PM: Your roommate also checks the fridge, also thinks "I'll buy some tomorrow morning"
- Next day 7:00 AM: You go to the store and buy a carton of milk
- 7:30 AM: Your roommate also goes to the store and buys a carton of milk
- Result: Now there are two cartons of milk in the fridge, wasteful!

This is a typical race condition: two people making decisions based on "outdated information," leading to unexpected results.

In computer systems, this problem is even more deadly. For example:
- Process A checks "does file exist?" → No → prepares to create
- Process B also checks "does file exist?" → No → prepares to create
- Both processes create simultaneously → 💥 Conflict!

---

## 2. What Actually Happened in This AWS Production Incident?

### 📅 Incident Timeline
- October 19, 2025, 23:48 PDT - Incident begins
- October 20, 2025, 14:20 PDT - Full recovery
- Impact duration: Approximately 14.5 hours
- Impact scope: AWS's largest region US-EAST-1 (Northern Virginia)

### 🎯 Core Problem: DynamoDB's DNS Race Condition

AWS DynamoDB has an automated DNS management system with two components:

1. DNS Planner: Monitors load balancer health status, periodically generates new DNS plans
2. DNS Enactor: Runs independently in 3 availability zones, responsible for applying DNS plans to Route53

To ensure resilience, DNS enactors run redundantly and completely independently across three different availability zones (AZs). Each independent DNS enactor instance looks for new plans and attempts to replace the current plan with the new plan through Route53 transactions, ensuring that even if multiple DNS enactors try to update the same endpoint simultaneously, each endpoint can complete updates with a consistent plan. Under normal circumstances, DNS enactors retrieve the latest plan and begin processing service endpoints one by one to apply the plan. This process typically completes quickly, effectively ensuring DNS state remains up-to-date.

Unfortunately, one DNS enactor encountered abnormally high latency when updating multiple DNS endpoints, requiring constant retries. The failure began like this:

#### 💣 How the Fatal Race Condition Occurred:

```
Timeline:
T1: Enactor A starts applying "old plan V1" (but processes slowly, encounters abnormal latency)
T2: Planner generates "new plans V2", "V3", "V4"...
T3: Enactor B quickly applies "latest plan V5", completes all endpoint updates
T4: Enactor B starts cleanup process, deletes "too old plans" (including V1)
T5: Enactor A finally completes processing, applies "old plan V1" to DynamoDB regional endpoint
    ⚠️ Problem: Enactor A checked "V1 is newer than previous plan" at start, but this check is now outdated!
T6: Enactor B's cleanup process finds V1 too old, directly deletes it
T7: 💥 Disaster: All IP addresses for regional endpoint are removed, DNS resolution fails!
```

### 🔥 Chain Reaction (Avalanche Effect)

1. DynamoDB Unavailable (23:48 - 02:40)
   - All connections through public endpoints fail
   - DNS resolution returns empty records
   - Client applications cannot connect to DynamoDB

2. EC2 Instance Launch Failures (23:48 - 13:50)
   - DWFM (Droplet Workflow Manager) depends on DynamoDB
   - Leases with all droplets timeout
   - During recovery, falls into "congestion collapse": retry tasks pile up → leases timeout again → more retries
   - New instance launches return "insufficient capacity" errors

3. Network Configuration Sync Delays (05:28 - 10:36)
   - Network manager accumulates large task backlog
   - Newly launched EC2 instances cannot obtain network connectivity

4. NLB Health Check Failures (05:30 - 14:09)
   - Health checks target new instances with unready networks
   - Health status oscillates between "failed" and "healthy"
   - Triggers availability zone DNS automatic failover
   - Partial capacity removed from service

5. Other Affected Services
   - Lambda: Function invocation failures, SQS/Kinesis processing delays
   - ECS/EKS/Fargate: Container startup failures
   - Amazon Connect: Call, chat, and ticket processing errors
   - Redshift: Query failures, cluster modification failures
   - IAM/STS: Authentication failures, console login failures

---

## 3. In-Depth Analysis from SRE Perspective

### 🎓 Core Lessons from This Incident

#### 1️⃣ Time Assumptions in Distributed Systems Are Dangerous
SRE Principles:
- ⚠️ Never assume "state at check time" remains valid "at use time" (TOCTOU problem)
- ✅ Should use optimistic locking or version number mechanisms to verify on each update

#### 2️⃣ Automated Systems Need "Circuit Breaker Mechanisms"

DNS enactors should, when encountering abnormal latency:
- Detect abnormal processing time → actively abandon current plan
- Avoid "zombie processes" continuing to execute outdated operations

Analogy: Like going to buy milk - if you encounter a 2-hour traffic jam, you should call to confirm whether your roommate already bought milk, rather than stubbornly continuing.

#### 3️⃣ Cascading Failures from Dependencies

```
DynamoDB DNS failure
    ↓
DynamoDB unavailable
    ↓
DWFM cannot maintain leases
    ↓
EC2 instance launch failures
    ↓
Network configuration sync delays
    ↓
NLB health check failures
    ↓
Lambda/ECS/Connect services affected
```

SRE Principles:
- 🔴 Single Points of Failure (SPOF) are deadly
- ✅ Core services (like DNS, DynamoDB) need multi-region redundancy
- ✅ Dependent services should have graceful degradation modes

#### 4️⃣ "Congestion Collapse" During Recovery

DWFM's problem:
```
Lease timeout → retry → task accumulation → slower processing → lease timeout again → more retries
```

This is a typical positive feedback loop - the busier the system gets, the slower it becomes; the slower it becomes, the busier it gets.

SRE Solutions:
- ✅ Rate Limiting: Control retry rates
- ✅ Backpressure: Dynamically adjust based on queue length
- ✅ Circuit Breaker: Pause retries when anomalies detected

#### 5️⃣ Monitoring and Alerting Blind Spots

- DNS problem occurred at 23:48, but root cause wasn't identified until 00:38 (50 minutes)
- NLB health check issues started at 05:30, but weren't detected by monitoring until 06:52 (82 minutes)

SRE Principles:
- ⚠️ You can't fix what you can't see
- ✅ Need end-to-end health checks, not just component-level monitoring
- ✅ Synthetic Monitoring: Simulate real user requests

#### 6️⃣ Insufficient Test Coverage

AWS admitted:
> "There was no established operational recovery procedure for this situation"

SRE Practices:
- ✅ Chaos Engineering: Actively inject failures to test system resilience
- ✅ Disaster Recovery Drills: Regularly simulate large-scale failures
- ✅ Game Days: Team collaborative failure response exercises

### 🛠️ AWS's Improvement Measures

1. Immediate Actions:
   - ✅ Globally disabled DNS automation system (stop the bleeding first)
   - ✅ Fixed the race condition
   - ✅ Added safeguards to prevent applying incorrect plans

2. Medium-term Improvements:
   - ✅ Added rate controls to NLB, limiting capacity removed in single failover
   - ✅ Built test suites for EC2 DWFM recovery procedures
   - ✅ Improved rate limiting mechanisms for data synchronization systems

3. Long-term Optimizations:
   - ✅ Deep analysis of all affected services
   - ✅ Identify methods to avoid similar incidents
   - ✅ Reduce recovery time

### 🎯 Summary

This incident is a classic distributed system race condition case, exposing several key issues:

1. Danger of time assumptions: TOCTOU (Time-of-Check to Time-of-Use) problem
2. Power of cascading failures: One DNS issue caused multiple services across entire region to fail
3. Complexity of recovery process: Congestion collapse, positive feedback loops
4. Importance of test coverage: Recovery procedures never rehearsed will be chaotic during real failures

Most Important Lesson:
> In distributed systems, never trust "outdated check results." Always re-verify preconditions before each critical operation.

This is like driving through an intersection: even if you see a green light, you should confirm again before entering the intersection that no cars are running the red light. In distributed systems, this "double-check" mechanism can prevent many catastrophic failures.
