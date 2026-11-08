----- Chinese
# SRE 使用 AI，也能像自动驾驶一样分级吗？

同样是问 AI 一个问题：查看数据库服务器过去 8 小时的 CPU 使用率。

在没有 AI 参与时，SRE 需要自己去 Prometheus 或 Grafana 中查询。

现在，随着 AI 开始进入 SRE 工作，运维的整体的工作模式发生了很大改变：
- 有的 AI 只能告诉你应该查询哪个 Metric。
- 有的 AI 可以自己查询 Prometheus，分析 CPU 的变化趋势。
- 还有的 AI，不仅能完成分析，甚至可以在经过审批后执行处理动作。

它们都叫“使用 AI”，但 AI 参与工作的程度并不一样。

## 借用自动驾驶的分级思路

总所周知，自动驾驶通常分为 L0 到 L5 六个级别。

我们可以借用这套自动驾驶的分级思路，观察 AI 在 SRE 工作中的参与和自主程度（这不是一套正式的 AI 行业标准，仅仅是帮助对照理解）。

为了区分这些等级，可以看 SRE 关注的四个问题：
- 谁获取数据？
- 谁分析问题？
- 谁执行操作？
- 谁负责兜底？

还是用查询 CPU 这个例子，我们来看看从 L0 到 L5 分别有什么不同。

## L0：手动处理 Manual

没有 AI 参与：人获取数据 -> 人分析 -> 人执行

SRE 自己确定服务器，选择 CPU Metric，编写 PromQL，再到 Prometheus 或 Grafana 中完成查询。

查到数据后，还要自己判断 CPU 是否存在异常，以及下一步应该检查什么。


## L1：AI 协助 AI Assist

AI 开始提供局部帮助：AI 提供查询建议 -> 人获取数据 -> 人分析和执行

比如，SRE 可以先问 LLM：

```text
查询一台服务器的 CPU 使用率，可能需要哪些 Metric？
PromQL 应该怎么写？
```

LLM 可以推荐 `node_cpu_seconds_total`，并生成一条可能的 PromQL。

但这条查询是否适合当前环境、应该在哪里执行、返回的数据是否正确，仍然需要人来判断。

## L2：AI 诊断 AI Diagnosis

AI 开始承担主要的分析工作：人获取数据 -> AI 分析 -> 人决定下一步

SRE 自己去 Prometheus 执行查询，再把查询结果交给 LLM 进行分析：

```text
这是过去 8 小时的 CPU 数据，请分析变化趋势和异常时间段。
```

LLM 可以根据已有数据识别峰值、持续时间和变化趋势，并给出下一步排查建议。

但它无法自己确认数据从哪里来，也不能主动补查缺少的信息。

## L3：AI 调查 AI Investigation

AI 不只负责分析，还能自己调用工具收集证据：AI 自行获取数据并分析 -> 人决定是否执行

例如 Agent 调用 Prometheus MCP 提供的时序查询 Tool，获取过去 8 小时的 CPU 数据：

```text
用户提出问题
  -> Agent 选择 Metric 和 PromQL
  -> 调用 Prometheus Tool
  -> 获取真实的时序数据
  -> 分析趋势和异常时间段
  -> 返回查询条件、证据和结论
```

如果第一次查询没有结果，Agent 还可以检查 Metric、Label、时间范围或采样步长，再调整查询。

这一层里，Agent 已经可以自己完成一轮调查，但生产环境是否需要处理，仍然由人决定。

## L4：经由人审批操作 Human-approved Action

AI 开始参与执行，但高风险动作仍然需要人审批：AI 调查并提出方案 -> 人审批 -> AI 执行和验证

例如 Agent 发现某个应用新版本发布后，数据库查询量和 CPU 同时升高，于是给出回滚该应用的建议：

```text
发现应用新版本发布后，数据库 CPU 持续升高。
建议将该应用回滚到上一个版本，是否执行？
```

SRE 审核证据和操作内容，确认后由 Agent 执行回滚，并再次查询 CPU，验证问题是否恢复。

## L5：自动闭环 Autonomous Loop

AI 在预先设定的权限和规则内自动完成闭环。

CPU 告警触发后，Agent 可以自动完成：

```text
接收告警
  -> 查询 CPU 数据
  -> 关联日志和发布记录
  -> 判断可能原因
  -> 执行预先授权的处理动作
  -> 验证 CPU 是否恢复
  -> 失败时回滚或升级给人
```

这并不意味着 Agent 拥有无限权限。它的身份权限、可调用工具和操作范围必须受到限制，所有动作还需要具备审计与回滚能力。

哪些动作可以自动执行、什么时候必须停止、失败后如何回滚，都需要提前定义清楚。

## 等级越高越好吗？

不一定。

SRE 面对的是生产环境。除了技术能力，还要考虑权限边界、操作审计、变更风险、回滚能力和事故责任。

对多数团队来说，当前更现实的目标，可能是先建立一个可靠的 L3：

```text
让 Agent 自动收集和整理证据，把生产决策留给人。
```

## 一句话记住

```text
L0：人完成全部工作
L1：AI 帮人准备查询
L2：AI 分析人提供的数据
L3：AI 自己获取数据并完成调查
L4：AI 经人审批后执行和验证
L5：AI 在限定范围内自动闭环
```

AI 从助手走向 Agent，真正改变的不是回答变得更像人，而是它开始能够自己获取证据、执行动作，并验证结果。

----- English

# Can We Classify AI Use in SRE Like Self-Driving Cars?

Consider a simple request: show me the database server's CPU utilization over the past eight hours.

Without AI, an SRE has to query Prometheus or Grafana manually.

As AI becomes part of SRE workflows, that operating model starts to change:

- Some AI systems can only suggest which metric to query.
- Some can query Prometheus and analyze the CPU trend on their own.
- Others can go beyond analysis and, with human approval, take action.

All of these count as "using AI," but the level of AI involvement is very different.

## Borrowing the Levels of Driving Automation

Driving automation is commonly described in six levels, from L0 to L5.

We can borrow that model to think about how much responsibility and autonomy AI has in SRE work. This is not a formal industry standard for AI. It is simply a useful mental model.

To distinguish the levels, consider four questions that matter to an SRE:

- Who gathers the data?
- Who analyzes the problem?
- Who takes action?
- Who is responsible when automation reaches its limit?

Using the same CPU request, here is what L0 through L5 might look like.

## L0: Manual Operations

No AI is involved: a human gathers the data -> a human analyzes it -> a human takes action.

The SRE identifies the server, selects a CPU metric, writes the PromQL query, and runs it in Prometheus or Grafana.

After retrieving the data, the SRE still has to decide whether the CPU behavior is abnormal and what to investigate next.

## L1: AI Assistance

AI provides limited assistance: AI suggests a query -> a human gathers the data -> a human analyzes it and takes action.

For example, the SRE might ask an LLM:

```text
Which metrics can I use to check CPU utilization for a server?
What would the PromQL query look like?
```

The LLM might recommend `node_cpu_seconds_total` and generate a possible PromQL query.

The human still has to determine whether that query fits the environment, where to run it, and whether the returned data is correct.

## L2: AI Diagnosis

AI takes on most of the analysis: a human gathers the data -> AI analyzes it -> a human decides what to do next.

The SRE runs the Prometheus query and gives the result to the LLM:

```text
Here is the CPU data from the past eight hours.
Analyze the trend and identify any unusual periods.
```

Based on the supplied data, the LLM can identify peaks, their duration, and the overall trend, then suggest what to investigate next.

However, it cannot verify where the data came from or retrieve missing evidence on its own.

## L3: AI Investigation

AI does more than analyze. It can call tools to gather evidence: AI gathers and analyzes the data -> a human decides whether to act.

For example, an agent can use a time-series query tool exposed by a Prometheus MCP server to retrieve the last eight hours of CPU data:

```text
User asks the question
  -> Agent selects the metric and PromQL
  -> Agent calls the Prometheus tool
  -> Agent retrieves real time-series data
  -> Agent analyzes the trend and unusual periods
  -> Agent returns the query, evidence, and conclusion
```

If the first query returns no data, the agent can inspect the metric name, labels, time range, or query step, adjust the query, and try again.

At this level, the agent can complete an initial investigation on its own, but a human still decides whether to make a change in production.

## L4: Human-Approved Action

AI begins to take action, but high-risk operations still require human approval: AI investigates and recommends -> a human approves -> AI executes and verifies.

For example, an agent notices that database query volume and CPU both increased after a new application version was deployed. It recommends rolling the application back:

```text
Database CPU has remained elevated since the new application release.
I recommend rolling the application back to the previous version. Proceed?
```

The SRE reviews the evidence and proposed action. Once approved, the agent performs the rollback, queries CPU again, and verifies whether the system recovered.

## L5: Autonomous Remediation Loop

AI completes the loop automatically within predefined permissions and policies.

After a CPU alert fires, the agent can automatically:

```text
Receive the alert
  -> Query CPU data
  -> Correlate logs and deployment history
  -> Identify the likely cause
  -> Execute a pre-authorized remediation
  -> Verify that CPU utilization has returned to normal
  -> Roll back the change or escalate to an engineer if it fails
```

This does not mean the agent has unlimited access. Its identity, available tools, and operating scope must be restricted, and every action must be auditable and reversible.

Teams must define in advance which actions can run automatically, when the agent must stop, and how failures should be rolled back.

## Is a Higher Level Always Better?

Not necessarily.

SREs work in production. Beyond technical capability, teams must consider permission boundaries, auditability, change risk, rollback options, and accountability.

For most teams, a more realistic near-term goal may be to build a reliable L3:

```text
Let the agent gather and organize the evidence.
Keep production decisions in human hands.
```

## The Short Version

```text
L0: Humans do all the work
L1: AI helps prepare the query
L2: AI analyzes human-provided data
L3: AI gathers evidence and investigates on its own
L4: AI executes and verifies after human approval
L5: AI closes the loop within defined guardrails
```

As AI evolves from assistant to agent, the real change is not that its answers sound more human. The real change is that it can gather evidence, take action, and verify the outcome.
