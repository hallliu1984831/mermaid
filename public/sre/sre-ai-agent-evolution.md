----- Chinese
# 小李的不同值班体验

## 值班故事一

小李记得很清楚，2020 年初他从 DevOps 慢慢转到了 SRE。新岗位的日常工作之一就是值班：处理随时可能出现的告警。慢慢地，小李从刚开始值班时的手足无措到后面慢慢适应，逐渐摸清了值班的流程。

要是说到哪一次值班的经历让他印象深刻，他清楚记得2022年的一次故障：
某天凌晨两点多，告警系统突然响了。值班电话把小李从半睡半醒里拽起来。告警内容不算长，大意是某个核心服务 5xx 飙升，错误率连续几分钟超过阈值。

放下电话，小李挣扎从床上坐起来，揉揉睡眼惺忪的眼睛，让自己清醒一下以后，边开电脑边和自己说：“别慌，按流程走”。

接下来做的事情，就是保准的流程：
1. 先看告警详情，确认是偶发错误，还是持续性异常。
2. 找对应的 runbook，看这个告警是不是之前处理过，找有用线索。
3. 评估影响范围，看看是不是核心链路，评估是不是要升级故障，是不是要同步客户。

往往是经过了前面这几个步骤，就影响到了接下来的行动。值班 SRE 得定个方向，接下来怎么办。因为值班 SRE 既不能一上来就升级问题，把整个团队都拉起来；也不能误判成小问题，结果让故障继续扩大。

小李先照着 runbook 过了一遍，发现文档里写的几个常见原因罗列了流量突增、代码异常、连接池打满这几类。于是小李决定继续检查，接下来就是 SRE 最熟悉的体力活了。

他打开 Grafana，对着 dashboard 挨个查看：
- 服务的流量有没有突然增大
- 错误率是从哪一分钟开始抬头的
- 延迟有没有同步上升
- CPU、内存、连接数有没有异常
- 上下游依赖是不是也在同一个时间点开始抖

看完指标还不够，有了初步的判断以后，还得去日志系统里进一步确认。日志不是答案，却提供了佐证初步判断的详细线索。真正麻烦的地方在于，很多时候线索通常不止一条，而且不一定都对。

那天晚上，小李一边筛错误日志，一边把几个关键词来回搜了很多遍。搜着搜着，终于看到一串异常堆栈，里面出现了一个很扎眼的空指针报错。

正常到这里，还远远不能说“找到根因了”。看到一个异常，不代表它就是根因。它可能只是结果，也可能只是次生问题。所以小李又顺着异常的错误堆栈查找相应的服务代码仓库，查看最近的变更记录，确认是不是最近改过相关逻辑。

这一套动作走下来，时间已经过去快一个小时了。

最后才基本确认：发生错误的服务当天零点有新版本部署，某个小改动没有把边界条件处理完整，在新版本上线后处理特殊数据时，程序就在一个冷门分支里打出了空指针，请求不断报错，错误率自然一路飙高。

问题确认以后，后面的动作反而简单了：
- 先回滚
- 观察错误率是否回落
- 确认服务恢复
- 在群里同步结论
- 给研发团队提单，修改新引入的错误

等告警彻底消掉，时间已经过了一个多小时。第二天休息好后上班，小李坐在工位上，心里其实没什么豪情，更多是一种很熟悉的疲惫。挺累的，但这就是值班时的正常工作节奏。

查 runbook --> 看指标 --> 翻日志 --> 找代码 --> 做判断 --> 写复盘，这一整套流程，就是那时候 SRE 的日常手艺。解决了问题皆大欢喜，不然还要继续深挖。

## 值班故事二
2025 年底，小李值班的时候，又遇到了一次类似的告警。

这次是另一个核心服务的处理延迟上升，还是值班 SRE 先介入，还是要尽快判断影响、定位原因、恢复服务。可这一次，小李坐到电脑前，手上的动作已经和三年前不一样了。

他没有先去翻 runbook，也没有立刻自己点开一堆 dashboard 和日志检索页面。而是打开了团队内部设定好的 Agentic AI Agent，把告警内容、服务名和时间范围扔了进去，然后让 Agent 来分析这个告警。

接着，他看着这个 Agent 自己开始框框地“跑流程”。

- 它先去读告警对应的 runbook，确认这个告警通常关注哪些指标、哪些依赖。
- 然后它通过接进来的 MCP 工具去拉 Prometheus 的时序数据，看错误率、延迟、QPS、容器重启次数在告警时间窗口里的变化。
- 紧接着，它又通过 MCP 工具去日志系统里抓同一时间段的日志，进行分析对比，找出错误日志和异常日志。
- 继续通过 MCP 工具检查知识库，查找类似告警的处理流程和历史工单。
- 再往后，它甚至把服务对应的代码仓库也读了一遍，总结服务的处理逻辑以及是否有最近的变更。
- 最后，它自己检查了一遍各项结果，确认了告警的可能原因，输出了一份故障分析报告。

整个过程中，小李一直盯着 Agent 给出来的中间结论，偶尔补一句约束，时不时纠一下方向，确认它没有把某条错误线索误判成主因。在拿到了故障分析报告以后，小李照着 Agent 给出的建议，确认了服务的错误日志里，程序无法处理突发的高并发请求。于是他对服务做了水平扩展，顺利处理了这个告警。

## 两次告警的处理流程对比
很长一段时间 SRE 处理告警，走的都是常用的路径，大概是故事一里提到的：
1. 看告警
2. 翻 runbook
3. 判断影响范围
4. 看 dashboard
5. 查日志
6. 对照历史工单和 SOP
7. 看代码和最近变更
8. 才慢慢收敛到根因

而故事二里的处理流程，很多原本分散在不同系统、不同页面里的动作，被 Agent 在一个上下文里串起来了。

从小李的视角看，原来那些自己要来回切很多个界面、拼很多段信息、不断校正方向的步骤，现在被压缩成了三件事：
1. 告警来了，值班 SRE 先介入。
2. 把关键信息交给 Agent，让它结合 runbook、指标、日志和代码一起检查。
3. 根据它收敛出来的高概率结论，做确认、采取措施并消除告警。

连复盘这件事，也比以前轻松了很多。不是不做复盘了，而是 Agent 在给出结论的同时，顺手就把排查路径、证据链、影响范围、恢复动作整理成了一份初稿。值班 SRE 只需要补充几处关键判断，再做最后确认，故障总结文档也能很快通过 MCP 工具上传到资料库。

小李盯着那份自动整理出来的说明，心里第一反应居然不是惊喜，而是有点失落。被压缩掉的步骤，其实不是什么“累活”。而是自己这几年来慢慢熟悉的、也最能体现经验的那部分工作路径。

## 为什么 2025 年的流程会变短

如果只是“AI 给一个答案”，小李其实不会这么受冲击。真正让他不安的，不是模型更会说话了，而是它已经有条件把值班流程里最费时间的几步接起来了。

以前 SRE 处理告警，麻烦的地方不在某一个单独的检查点，而是要在下列的多个资源里跳来跳去，才能把信息拼起来。每跳一次，脑子里都得重新装上下文。
- 告警平台
- runbook
- Grafana
- Prometheus
- 日志系统
- 工单系统
- 代码仓库

而 Agent 最大的变化就在这里。它不是单纯回答一个问题，而是借助 MCP 工具，把上面原本分散的资源高效读取，然后快速把有用信息接到了一起，完成一次连续的上下文交互。

表面上看，是排障快了。往深层次看下去，是过去那些需要靠经验一点点拼起来的流程，开始被工具化、工程化、系统化地复刻出来了。

## 场景四：小李的纠结和释然

如果只看结果的话，这种变化简直太牛了：故障定位更快了，恢复更及时了，客户投诉更少了，值班的人也不用在多个系统之间来回切到眼花。更何况是在深夜，好不容易做完了都睡不着觉了。

但 Agent 和 LLM 配合压缩掉的，是很多原本被视为“经验”的东西：怎么快速判断先看什么指标，怎么从成千上万，甚至更多日志里抓住真正有用的信息，怎么把 runbook、变更记录、代码和告警现象拼成一条可信的因果链，这些原来都算 SRE 的手艺。现在，这门手艺正在被重新切分。有些部分，正在变成 Agent 的能力。

小李难免会有些焦虑，时不时想到同一个问题：“如果连这一段流程都能被接过去，那人工 SRE 还能干多久？”

焦虑归焦虑，告警不会因为你焦虑就少响一个。夜班还是有人值，故障还是要有人顶，系统还是得有人真正负责。

和领导、同事沟通了一番，也看了网络上很多关于 AI 的讨论以后，小李后来慢慢想明白，问题已经不是“AI 会不会进工作现场”了，而是它已经进来了。真正的问题是，AI 进来以后，SRE 还剩下什么东西，是不能直接外包给流程的。

至少在眼下，真正难被替掉的，还有工作流程中更上游的东西：
- 告警该不该升级
- 业务影响到底有多大
- Agent 给出的结论能不能信
- 什么时候该止损，什么时候该继续深挖
- 效率、稳定性和风险之间到底怎么取舍

这些判断看起来不如“查日志、看指标、找代码”那么具体，却恰恰是值班现场最难、也最不能轻易甩手的部分。

所以，小李后来不再纠结“以前那套流程是不是被拿走了一大半”，因为纠结也没用，变化已经发生了。他开始利用这些新东西：
- 让 Agent 帮自己先跑第一轮检查
- 让 Agent 帮自己整理证据链和复盘初稿
- 把自己从重复的切换和检索里先解放出来
- 把更多精力放在判断、兜底和复杂异常场景上

他后来慢慢接受了一件事：对 SRE 来说，最危险的是，还把自己想象成 2023 年那个只能靠手工一步步排障的人。因为同一个告警，处理流程已经不一样了。而一个技术人还能不能继续走下去，越发取决于你能不能在新的流程中找到属于自己的位置。

## 补充说明
- Agent：可以理解成“会自己分步骤做事的 AI”。它不只是回答一句话，而是会结合任务目标、上下文和工具，连续完成一串动作。
- MCP：`Model Context Protocol`，即“模型上下文协议”。简单说，就是把日志系统、监控系统、代码仓库、知识库这些外部工具和数据，安全地接给模型使用。
- runbook：运维或 SRE 场景里常见的操作手册，记录某类告警或故障通常该怎么判断、怎么处理、怎么止损。

----- English

# Mike's Different On-Call Experiences

## On-Call Story One

Mike remembers it clearly. In early 2020, he gradually moved from DevOps into SRE. One of the routine parts of the new role was being on call: responding to alerts that could fire at any time. At first, on-call work felt chaotic and disorienting. Over time, Mike settled into the rhythm and became familiar with the standard response process.

If there was one on-call incident that stuck with him, it was an outage in 2022.

One night, a little after 2 a.m., the alerting system suddenly went off. The on-call phone pulled Mike out of a half-asleep haze. The alert message was short: 5xx errors had spiked on a core service, and the error rate had stayed above the threshold for several minutes.

After hanging up, Mike dragged himself upright in bed, rubbed his eyes, and tried to wake up. As he opened his laptop, he told himself, "Don't panic. Follow the process."

What came next was the standard routine:

1. Check the alert details to determine whether this was a one-off error or a sustained issue.
2. Find the relevant runbook and see whether this alert had been handled before.
3. Assess the impact: whether it touched a critical path, whether the incident needed to be escalated, and whether customers needed to be notified.

Those first few steps usually shaped everything that followed. The on-call SRE had to choose a direction. Escalating too early could wake up the entire team unnecessarily. Misclassifying the issue as minor could let the incident grow.

Mike first worked through the runbook. It listed several common causes: a sudden traffic increase, a code bug, or an exhausted connection pool. So Mike kept digging. What followed was the kind of hands-on investigation every SRE knows well.

He opened Grafana and went through the dashboards one by one:

- Did service traffic suddenly increase?
- When did the error rate begin to rise?
- Did latency rise at the same time?
- Were CPU, memory, or connection counts abnormal?
- Did upstream or downstream dependencies start behaving strangely around the same time?

Metrics alone were not enough. Once he had an initial theory, he still had to confirm it in the logging system. Logs are not the answer by themselves, but they provide detailed clues that can support or challenge an early hypothesis. The hard part is that there are often multiple clues, and not all of them point in the right direction.

That night, Mike filtered through error logs and searched the same few keywords over and over. Eventually, he found a stack trace with a very conspicuous null pointer error.

But even then, it was still too early to say, "We found the root cause." Seeing an exception does not mean that exception caused the incident. It might be only a symptom or a secondary failure. So Mike followed the stack trace into the service's code repository, reviewed recent commits, and checked whether the related logic had changed recently.

By the time he finished that loop, almost an hour had passed.

Eventually, the likely cause became clear. A new version of the service had been deployed at midnight. A small change had failed to handle an edge case correctly. After the release, when the service processed a specific kind of data, the program hit a rarely used branch and threw a null pointer error. Requests kept failing, and the error rate climbed quickly.

Once the issue was understood, the recovery steps were straightforward:

- Roll back the deployment.
- Watch whether the error rate dropped.
- Confirm that the service recovered.
- Share the conclusion in the incident channel.
- File a ticket for the engineering team to fix the newly introduced bug.

By the time the alert fully cleared, more than an hour had passed. The next day, after getting some rest, Mike sat at his desk without much sense of victory. Mostly, he felt the familiar exhaustion that came with on-call work. It was tiring, but it was also the normal operating rhythm.

Check the runbook --> review metrics --> read logs --> inspect code --> make a judgment --> write the postmortem. That whole sequence was the everyday craft of SRE work at the time. When it solved the problem, everyone was relieved. When it did not, the digging continued.

## On-Call Story Two

Near the end of 2025, Mike was on call again when a similar alert came in.

This time, latency had increased on another core service. The on-call SRE still had to step in first, quickly assess the impact, identify the cause, and restore the service. But when Mike sat down at his computer, his workflow looked very different from three years earlier.

He did not start by opening the runbook. He did not immediately click through a pile of dashboards and log search pages. Instead, he opened the Agentic AI Agent that his team had set up internally, pasted in the alert details, service name, and time window, and asked the Agent to analyze the alert.

Then he watched the Agent start working through the process on its own.

- It first read the runbook for the alert and identified the metrics and dependencies that usually mattered.
- It used connected MCP tools to pull Prometheus time-series data and checked how error rate, latency, QPS, and container restarts changed during the alert window.
- It then used MCP tools to query the logging system for the same time period, compare the results, and identify error logs and exception patterns.
- It checked the knowledge base through MCP tools to find similar alerts, previous remediation steps, and historical tickets.
- It even read through the relevant service repository, summarized the service logic, and checked whether there had been recent changes.
- Finally, it reviewed its own findings, identified the most likely cause, and produced an incident analysis report.

Throughout the process, Mike watched the Agent's intermediate conclusions. Every now and then, he added a constraint, corrected its direction, or made sure it was not mistaking a misleading clue for the primary cause. After receiving the incident analysis report, Mike followed the Agent's recommendation and confirmed that the service was struggling to handle a sudden burst of high-concurrency traffic. He horizontally scaled the service and resolved the alert smoothly.

## Comparing The Two Alert Response Workflows

For a long time, SRE alert response followed a familiar path, roughly like the one in the first story:

1. Read the alert.
2. Check the runbook.
3. Assess the impact.
4. Review dashboards.
5. Search logs.
6. Compare against historical tickets and SOPs.
7. Inspect the code and recent changes.
8. Gradually narrow in on the root cause.

In the second story, many steps that used to be scattered across different systems and browser tabs were connected by the Agent inside one shared context.

From Mike's perspective, the old workflow required him to jump between many interfaces, piece together fragments of information, and constantly correct his own direction. Now that workflow had been compressed into three main steps:

1. The alert fires, and the on-call SRE steps in first.
2. The SRE gives the key information to the Agent and lets it inspect the runbook, metrics, logs, and code together.
3. The SRE reviews the Agent's high-probability conclusion, confirms it, takes action, and clears the alert.

Even the postmortem became easier. It was not that postmortems disappeared. Instead, when the Agent produced its conclusion, it also generated a first draft that organized the investigation path, evidence chain, impact, and recovery actions. The on-call SRE only needed to add a few key judgments and do the final review before uploading the incident summary to the knowledge base through MCP tools.

As Mike looked at the automatically generated write-up, his first reaction was not excitement. It was a faint sense of loss. The steps that had been compressed away were not just tedious chores. They were the parts of the work path he had gradually mastered over the years, and the parts where his experience had most visibly mattered.

## Why The 2025 Workflow Became Shorter

If the only change had been "AI gives an answer," Mike would not have been so shaken. What unsettled him was not that the model had become better at talking. It was that the model now had the conditions to connect the most time-consuming parts of the on-call workflow.

In the past, the hard part of alert response was not any single checkpoint. The hard part was jumping across multiple resources and stitching the information together. Every jump required Mike to reload the context in his head:

- Alerting platform
- Runbook
- Grafana
- Prometheus
- Logging system
- Ticketing system
- Code repository

This is where the Agent changed the most. It did not simply answer a question. With MCP tools, it could efficiently read the resources that used to be scattered across systems, connect the useful information, and carry out one continuous context-aware investigation.

On the surface, troubleshooting became faster. At a deeper level, workflows that used to be assembled piece by piece through experience were starting to be recreated as tools, engineering systems, and repeatable processes.

## Mike's Unease And Acceptance

If you look only at the outcome, the change is remarkable. Incidents are diagnosed faster. Recovery happens sooner. Customers complain less. On-call engineers no longer have to bounce between systems until everything blurs together, especially in the middle of the night, when it can be hard to fall back asleep even after the work is done.

But the combination of Agents and LLMs compresses away many things that used to be treated as "experience": how to quickly decide which metric to check first, how to find the useful signal among thousands or even millions of log lines, and how to connect the runbook, change history, code, and alert symptoms into a credible causal chain. Those abilities used to be part of the SRE craft. Now that craft is being divided differently. Some parts are becoming Agent capabilities.

It was natural for Mike to feel anxious. He kept coming back to the same question: "If even this part of the workflow can be handed over, how long will human SREs still be needed?"

Anxiety is anxiety, but alerts do not stop firing because someone feels worried. Someone still has to cover the night shift. Someone still has to own the incident. Someone still has to be truly accountable for the system.

After talking with his manager and teammates, and after reading many discussions about AI online, Mike gradually came to understand that the question was no longer whether AI would enter the workplace. It already had. The real question was what remains for SREs once AI is part of the workflow, especially what cannot simply be outsourced to a process.

At least for now, the hardest things to replace sit further upstream in the work:

- Whether an alert should be escalated
- How large the business impact really is
- Whether the Agent's conclusion can be trusted
- When to stop the bleeding and when to keep digging
- How to trade off efficiency, stability, and risk

These judgments may look less concrete than "check logs, review metrics, inspect code," but they are exactly the hardest and least disposable parts of on-call response.

So Mike eventually stopped dwelling on whether half of the old workflow had been taken away. Dwelling on it did not help; the change had already happened. Instead, he started using the new tools:

- Let the Agent run the first round of investigation.
- Let the Agent organize the evidence chain and draft the postmortem.
- Free himself from repetitive context switching and searching.
- Spend more energy on judgment, ownership, and complex edge cases.

Over time, Mike accepted one thing: for SREs, the greatest risk is continuing to imagine themselves as the 2023 version of the engineer who had to troubleshoot everything manually, step by step. The workflow for the same alert has changed. Whether a technologist can keep moving forward increasingly depends on whether they can find their place in the new workflow.

## Additional Notes

- Agent: An AI system that can break work into steps and carry them out. It does not only answer a question; it can use goals, context, and tools to complete a sequence of actions.
- MCP: `Model Context Protocol`. In simple terms, it safely connects external tools and data sources, such as logging systems, monitoring systems, code repositories, and knowledge bases, so models can use them.
- Runbook: A common operating guide in SRE and operations work. It records how a certain type of alert or incident is usually evaluated, handled, and mitigated.
