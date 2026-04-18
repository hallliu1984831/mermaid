----- Chinese
# IT安全：绕不开的Security话题

## 小李的成长之路
在转行 SRE 之前，小李做了好几年的 DevOps。在2015年到2020年这段时间，DevOps 这个词在 IT 行业里火得不行。相信你也和小李一样，对这个词耳熟能详，张口就能说出个一二三来。

经过那几年的实践，他对 DevOps 这个词已经很熟了：
- 开发和运维一起协作
- 用流水线（CI/CD）做持续集成和持续交付
- 用 docker 管理应用容器
- 用监控和日志来保障线上稳定性

在 DevOps 之外，DevSecOps 也开始流行起来。它在是 Development和Operations之间加上了Security，如字面意思，就是把安全能力往前提，不要等系统上线以后出了事，才想起来补安全。

小李也不例外，接触过一些安全相关的工作，虽然不算特别深入，但已经不算陌生。比如：

- 给服务做系统加固（hardening）
- 了解过 `AppArmor` 和 `SELinux`
- 在 CI 阶段做镜像扫描、依赖扫描、漏洞扫描
- 检查容器是否用了特权模式
- 检查密码、证书、密钥是不是放对了地方

这些事情当时看起来都挺零散：
- 有的是管进程权限
- 有的是管镜像风险
- 有的是管运行时配置
- 有的是管供应链

直到后来，小李又陆续接触到：
- Docker 里的隔离
- Kubernetes 里的 Pod sandbox
- Agentic AI Agent 里的受限执行环境

他才慢慢意识到，这些看似分散的做法，背后其实都指向一个共同思路：想办法给系统划边界。更准确地说，这些实践和今天常说的 sandbox，是同一种安全思路。

这个边界的目的很明确：
- 不是让程序什么都不能做
- 而是让程序能做该做的事，但别做得太多、太远、太危险

于是小李决定把这个词彻底想明白：Sandbox，到底是什么？

## Sandbox 概述

小李查了一圈文档之后，先得出了一个最关键的结论：
- sandbox 不是某一个固定产品，也不是某一个专属技术名词。
- 它更像是一种安全实现思想，或者说是一类常见的安全设计手法。

它要解决的问题通常是这样的：
- 某段代码我们不敢百分之百信任
- 某个进程不应该拿到完整系统能力
- 某个组件不应该越界访问资源
- 即使它出故障或被利用，也希望影响范围尽量小

所以 sandbox 的核心目标，其实很朴素：
- 通过隔离、约束和最小权限，把目标对象限制在一个可控边界里。

这个“边界”可以是计算资源，也可以是数据资源，更可以是工具使用权限。根据使用场景不同，它可能落在很多层面：
- 文件系统边界
- 网络边界
- 进程边界
- 权限边界
- 系统调用边界
- 资源边界
- 工具使用边界

你可以把它想成门禁系统：
- 不是把整栋楼锁死，谁都不让进
- 而是给不同的人发不同权限的门禁卡
- 能进办公区，不代表能进机房
- 能进机房，不代表能碰所有设备

这就是 sandbox 的核心直觉：系统不是不能运行，而是要在允许的边界内运行。


## sandbox 在 DevOps 中的体现
小李发现，DevOps 中很多安全动作虽然当时不一定叫 sandbox，但已经带有很强的 sandbox 思想。

### 1. AppArmor / SELinux：限制进程“能碰什么”

当年小李第一次接触 `AppArmor` 和 `SELinux` 时，只觉得它们“很严格，很烦，还容易把服务搞挂”。
比如：
- 哪些路径可以读
- 哪些路径可以写
- 哪些文件不能碰
- 哪些命令/行为不允许发生

这本质上就是在给进程画沙箱边界：不是说这个进程不能运行，而是它运行时不能太自由。

### 2. CI 阶段扫描：别让高风险内容进入运行环境
再比如镜像扫描、依赖扫描、漏洞扫描。

它们不直接提供运行时隔离，但它们做的是另一件很重要的事：
- 在进入运行环境之前，先把风险挡掉一部分。

比如：
- 基础镜像是不是太老
- 是否有高危 CVE
- 是否引入了有问题的依赖
- 镜像里是不是包含敏感文件

这不完全等于 sandbox，但它和 sandbox 的思路是相通的：
- 减少系统暴露面，降低后续失控的可能性。

### 3. Hardening：默认不要给太多能力
结合以前做过一些系统加固，比如：
- 关闭不必要的端口
- 禁止不该开的服务
- 精简软件包
- 收缩 root 权限
- 检查 SSH、sudo、内核参数

这些操作本质上也很像 sandbox 思想在主机层面的体现：
- 系统默认不应该暴露过多能力。
- 能不给的权限就不给，能关的入口就关，能缩小的攻击面就缩小。

TIPS：
- sandbox 不是凭空冒出来的新概念，而是安全工程里一个反复出现的共同思路。


## Docker 中的 sandbox 实践

Docker 把 Linux 里已经存在的多种机制组合起来，形成一个更清晰、更工程化的隔离环境：
- `namespace`：隔离视图
- `cgroup`：限制资源
- `capabilities`：收缩特权
- `seccomp`：限制系统调用
- `AppArmor` / `SELinux`：强化访问控制

这样一来，容器里的程序就像被放进了一个受控空间。它还能跑，还能干活，但它不是在整个宿主机上随意活动。

### Docker 里的 sandbox 具体限制了哪些边界？
- 进程边界：容器里运行 `ps`，主要看到的是容器自己的进程，而不是整机全部进程。
- 文件系统边界：容器看到的是自己的 root filesystem，而不是宿主机完整文件系统。
- 网络边界：容器通常有独立的网络命名空间、接口、路由和端口映射。
- 资源边界： 通过 `cgroup` 可以限制：CPU、内存、IO、进程数量
- 权限边界： 通过 capability 收缩、只读文件系统、禁止特权模式等方式，减少容器拿到的能力。

TIPS:
- 容器是 sandbox，但它是共享宿主机内核的 sandbox。
- 它的优点：很轻、很快、很方便，很适合工程化部署
- 限制：它不是物理隔离，不是虚拟机级别的硬边界，不能替代所有更强隔离需求
- Docker 里的 sandbox，本质上是把应用进程关进一个受限制的小环境里运行，让它比直接跑在宿主机上更可控。

## Kubernetes 里的 sandbox
到了 K8S 以后，小李发现 sandbox 这个词又变复杂了。因为在 Kubernetes 里，它经常会指两类不同的东西。
### 第一层：Pod sandbox

这是偏底层、偏 CRI 实现的概念。当 K8S 创建一个 Pod 时，往往不是直接把业务容器拉起来就结束了，而是会先准备一个 Pod sandbox。

你可以把它理解成：先把 Pod 的运行底座搭起来，再把业务容器放进去。

这个底座通常会负责：
- 建立 Pod 级别的网络命名空间
- 提供 Pod 共享的运行上下文
- 承载 Pod 内容器共享的基础环境

在很多实现里，它会体现为一个轻量的 `pause` 容器。

为什么会这样？因为在 Kubernetes 里，真正的基本运行单元是 Pod，而不是单个容器。

一个 Pod 里多个容器往往要共享：
- `localhost`
- 网络命名空间
- 部分 volume
- 一些生命周期上下文

所以 Kubernetes 需要先把这个“Pod 层面的公共空间”准备好。
如果把容器看成住户，那 Pod sandbox 就像共享宿舍：先把宿舍楼的门牌、水电、走廊和公共房间搭好，再让住户入住。它不是业务功能本身，但它是业务容器能运行起来的基础环境。


### 第二层：更强隔离的 sandbox runtime

除了 “Pod sandbox” 这个底层术语，在实际工程讨论里，K8S 里提到 sandbox，更常是另一个意思：让 Pod 跑在更强隔离的运行时里。
比如：
- `gVisor`
- `Kata Containers`
- 基于 microVM 的方案

这时候讨论的就不是那个 `pause` 容器了，而是这个 Pod 到底应该跑在什么样的隔离边界里。

为什么会需要这种更强隔离？因为 K8S 不是只跑一个服务，而是经常会把很多工作负载收拢到同一套平台里：
- 不同业务线
- 不同团队
- 不同安全等级
- 有时候甚至是多租户

这时默认容器隔离对多数场景已经够用，但对某些场景，大家会希望加一层更强边界，比如：
- 多租户平台
- 高敏感服务
- 需要更强隔离的任务型工作负载
- 不希望和其他服务共享同样风险面的场景

K8S 通过 `RuntimeClass` 机制表达这种隔离选择。它会告诉 K8S：这类 Pod 应该使用哪一种 runtime handler 来启动。

示例如下：

```yaml
apiVersion: node.k8s.io/v1
kind: RuntimeClass
metadata:
  name: kata-sandbox
handler: kata
```

然后 Pod 可以这样指定：

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: app-with-stronger-isolation
spec:
  runtimeClassName: kata-sandbox
  containers:
    - name: app
      image: nginx:latest
```

TIPS:
- Kubernetes 里的 sandbox，本质上是两层含义叠在一起的：一方面是 Pod 的运行底座; 另一方面是更强隔离的运行模型
- RuntimeClass 是 K8S 里选择运行时的 API 机制，它通过 `handler` 去引用底层容器运行时配置。`gVisor`、`Kata Containers` 这类方案是底层 runtime/handler 所对应的隔离实现，而不是 RuntimeClass 本身的“实现”。

## Agentic AI Agent 的 sandbox 

从去年开始，小李又接触到了 Agentic AI Agent。这时候他发现，sandbox 这个词又进一步升级了：从“系统隔离”走向“能力治理”

在这个场景里，要被限制的往往不再只是一个普通进程，而是一个：
- 会规划步骤的 agent
- 会调用工具的 agent
- 会读写文件的 agent
- 会执行 shell 命令的 agent
- 甚至可能会联网、调 API、操作代码仓库的 agent

这时候的重点，已经不仅仅是“进程跑在哪”，而是：这个智能体到底能做什么。

### Agent 为什么特别需要 sandbox？

和普通程序通常只会按预定逻辑执行不同，有了 LLM 的幕后加持，Agent 往往具备：
- 目标导向
- 多步规划
- 工具调用
- 结果反馈后继续动作

也正因为如此，它的风险不只是“程序崩了”，而是更大的使用场景：
- 能看得太多：本来只该读取一个项目目录，结果却能访问整台机器上的更多内容。
- 能做得太多：本来只该分析日志，结果却改了文件、改了配置，甚至执行了高风险命令。
- 能连得太远：本来只该本地处理数据，结果却能访问外部网络、调用第三方接口。
- 能持续试错直到越界：因为 agent 会不断尝试，直到完成目标；如果边界没设好，它就可能一路试到不该碰的地方。

### Agentic AI Agent 的 sandbox 变成了什么？
sandbox 给 agent 一个受控的行动空间：
- 这时候限制的通常不是单一进程视角，而是整个行动能力集合。

### 常见的限制方式
- 文件系统范围限制: 只允许它访问特定目录/白名单目录，而不是整台机器。
- 命令执行范围限制：允许它执行特定命令，而不是所有命令。比如：`ls`、`rg`、测试命令等；但不允许默认执行高风险动作，如恶名在外的 `rm -rf`，修改系统配置等
- 网络访问限制：有些场景允许联网，有些则完全不允许。
- 审批机制：特定操作如推送代码、部署服务等需要显示审批。

TIPS:
- 在 Agent 里，sandbox 的重点不是把进程单纯隔离起来，而是把 agent 的观察范围、操作范围和破坏能力限制在可控边界内。
- 当前主流的 Agent 实现，本质上是把 Agent 当成一个“智能体”，而不是一个“普通进程”，然后给它一个受控的行动空间。在 Agent 初始化时，一般会申请工作目录、申请工具权限、申请网络权限等。

## 三种 sandbox 的异同

到这儿，小李觉得可以罗列出三种 sandbox 的异同了。

- 在 Docker 里，sandbox 确保程序不要直接裸跑在宿主机上。
- 在 K8S 里，sandbox 定义并限制工作负载以什么样的边界运行在集群里。
- 在 Agentic AI Agent 里，sandbox 确保智能体的能力范围和破坏力控制在可控边界内。


## 小结

这一路看下来，小李终于把 Sandbox 弄明白了： 它不是某个单一产品，而是一种安全实现思想：通过隔离、约束和最小权限，把程序或智能体限制在一个可控边界内运行。

它的核心方法始终很稳定：
- 隔离
- 约束
- 最小权限
- 降低破坏面

在不同技术栈里，sandbox 的实现形态不同，但是背后要解决的问题是一致的：让系统能做事，但不要做傻事。

----- English
# IT Industry: The Unavoidable Security Topic

## Mike's Growth Journey
Before transitioning to SRE, Mike spent several years in DevOps. From 2015 to 2020, DevOps was incredibly popular in the IT industry. Like many others, Mike became very familiar with this term and could easily explain its key concepts.

After years of hands-on experience, he had become quite familiar with DevOps:
- Development and operations teams collaborating together
- Using pipelines (CI/CD) for continuous integration and continuous delivery
- Using Docker to manage application containers
- Using monitoring and logging to ensure production stability

Beyond DevOps, DevSecOps also started gaining popularity. It adds Security between Development and Operations, essentially shifting security capabilities earlier in the process rather than waiting until after systems go live to think about security patches.

Mike was no exception, having worked on some security-related tasks. While not particularly deep, he wasn't unfamiliar with concepts like:

- Performing system hardening for services
- Understanding `AppArmor` and `SELinux`
- Performing image scanning, dependency scanning, and vulnerability scanning during CI stages
- Checking whether containers were using privileged mode
- Verifying that passwords, certificates, and keys were stored in appropriate locations

These practices seemed quite scattered at the time:
- Some managed process permissions
- Some managed image risks
- Some managed runtime configurations
- Some managed supply chains

It wasn't until later, when Mike encountered:
- Isolation in Docker
- Pod sandbox in Kubernetes
- Restricted execution environments in Agentic AI

That he gradually realized these seemingly dispersed practices actually pointed toward a common approach: finding ways to establish boundaries for systems. More precisely, these practices and what we commonly call sandbox today share the same security philosophy.

The purpose of these boundaries is clear:
- Not to prevent programs from doing anything
- But to let programs do what they should do, while preventing them from doing too much, going too far, or becoming too dangerous

So Mike decided to thoroughly understand this concept: What exactly is a Sandbox?

## Sandbox Overview

After researching various documentation, Mike arrived at a key conclusion:
- Sandbox isn't a specific fixed product or an exclusive technical term
- It's more like a security implementation philosophy, or a common security design approach

The problems it typically aims to solve are:
- Code that we can't trust 100%
- Processes that shouldn't have full system capabilities
- Components that shouldn't access resources beyond their boundaries
- Even when they fail or get compromised, we want to minimize the impact radius

So the core goal of sandbox is actually quite straightforward:
- Through isolation, constraints, and minimum privileges, confine the target object within controllable boundaries.

These "boundaries" can be computational resources, data resources, or tool usage permissions. Depending on the use case, they might exist at various levels:
- File system boundaries
- Network boundaries
- Process boundaries
- Permission boundaries
- System call boundaries
- Resource boundaries
- Tool usage boundaries

You can think of it like an access control system:
- Not locking down the entire building so no one can enter
- But giving different people different permission levels on their access cards
- Being able to enter office areas doesn't mean you can enter server rooms
- Being able to enter server rooms doesn't mean you can touch all equipment

This is the core intuition of sandbox: systems shouldn't be prevented from running, but should run within allowed boundaries.


## Sandbox Manifestations in DevOps
Mike discovered that many security actions in DevOps, while not necessarily called sandbox at the time, already embodied strong sandbox thinking.

### 1. AppArmor / SELinux: Limiting What Processes "Can Touch"

When Mike first encountered `AppArmor` and `SELinux`, he only thought they were "very strict, very annoying, and easy to break services."
For example:
- Which paths can be read
- Which paths can be written to
- Which files cannot be touched
- Which commands/behaviors are not allowed

This is essentially drawing sandbox boundaries for processes: not saying the process can't run, but that it can't be too free when running.

### 2. CI Stage Scanning: Preventing High-Risk Content from Entering Runtime

Take image scanning, dependency scanning, and vulnerability scanning as examples.

They don't directly provide runtime isolation, but they do something else very important:
- Before entering the runtime environment, filter out some risks first.

For example:
- Whether base images are too old
- Whether there are high-risk CVEs
- Whether problematic dependencies have been introduced
- Whether images contain sensitive files

This isn't exactly equivalent to sandbox, but it shares the same philosophy:
- Reduce system exposure surface and lower the possibility of subsequent loss of control.

### 3. Hardening: Don't Give Too Many Capabilities by Default
Combined with previous system hardening work, such as:
- Closing unnecessary ports
- Disabling services that shouldn't be running
- Streamlining software packages
- Restricting root privileges
- Checking SSH, sudo, kernel parameters

These operations are essentially manifestations of sandbox thinking at the host level:
- Systems shouldn't expose too many capabilities by default.
- Don't grant permissions that don't need to be granted, close entrances that can be closed, shrink attack surfaces that can be reduced.

TIPS:
- Sandbox isn't a concept that appeared out of nowhere, but a recurring common approach in security engineering.


## Sandbox Practices in Docker

Docker combines multiple mechanisms that already exist in Linux to form a clearer, more engineering-oriented isolated environment:
- `namespace`: Isolates views
- `cgroup`: Limits resources
- `capabilities`: Reduces privileges
- `seccomp`: Restricts system calls
- `AppArmor` / `SELinux`: Strengthens access control

This way, programs inside containers are placed in a controlled space. They can still run and work, but they're not freely operating across the entire host machine.

### What Specific Boundaries Does Docker's Sandbox Limit?
- Process boundaries: Running `ps` inside a container mainly shows the container's own processes, not all processes on the entire machine.
- File system boundaries: Containers see their own root filesystem, not the host's complete file system.
- Network boundaries: Containers typically have independent network namespaces, interfaces, routing, and port mappings.
- Resource boundaries: Through `cgroup`, you can limit: CPU, memory, IO, process count
- Permission boundaries: Through capability reduction, read-only file systems, prohibiting privileged mode, etc., reduce the capabilities containers can obtain.

TIPS:
- Containers are sandboxes, but they are sandboxes that share the host kernel.
- Their advantages: Very lightweight, fast, convenient, very suitable for engineering deployments
- Limitations: They're not physical isolation, not VM-level hard boundaries, can't replace all stronger isolation needs
- Docker's sandbox essentially confines application processes to run in a restricted small environment, making them more controllable than running directly on the host.

## Sandbox in Kubernetes
When it came to K8S, Mike found the term sandbox became more complex. Because in Kubernetes, it often refers to two different types of things.

### First Layer: Pod Sandbox

This is a concept that's more low-level, more CRI implementation-oriented. When K8S creates a Pod, it often doesn't just pull up business containers and call it done, but first prepares a Pod sandbox.

You can think of it as: first setting up the Pod's runtime foundation, then placing business containers into it.

This foundation typically handles:
- Establishing Pod-level network namespaces
- Providing Pod-shared runtime context
- Hosting the basic environment shared by containers within the Pod

In many implementations, this manifests as a lightweight `pause` container.

Why is this the case? Because in Kubernetes, the real basic runtime unit is the Pod, not individual containers.

Multiple containers in a Pod often need to share:
- `localhost`
- Network namespaces
- Some volumes
- Some lifecycle contexts

So Kubernetes needs to prepare this "Pod-level common space" first.
If you think of containers as residents, then Pod sandbox is like a shared dormitory: first set up the dormitory building's room numbers, utilities, hallways, and common rooms, then let residents move in. It's not business functionality itself, but the foundational environment that enables business containers to run.


### Second Layer: Stronger Isolation Sandbox Runtime

Besides "Pod sandbox" this low-level term, in actual engineering discussions, when sandbox is mentioned in K8S, it more commonly means something else: making Pods run in stronger isolation runtimes.
For example:
- `gVisor`
- `Kata Containers`
- microVM-based solutions

At this point, the discussion isn't about that `pause` container, but about what kind of isolation boundaries this Pod should actually run within.

Why would stronger isolation be needed? Because K8S doesn't just run one service, but often consolidates many workloads onto the same platform:
- Different business lines
- Different teams
- Different security levels
- Sometimes even multi-tenancy

At this point, default container isolation is sufficient for most scenarios, but for certain scenarios, people want to add a layer of stronger boundaries, such as:
- Multi-tenant platforms
- High-sensitivity services
- Task-oriented workloads requiring stronger isolation
- Scenarios that don't want to share the same risk surface with other services

K8S expresses this isolation choice through the `RuntimeClass` mechanism. It tells K8S: this type of Pod should use which runtime handler to start.

Example as follows:

```yaml
apiVersion: node.k8s.io/v1
kind: RuntimeClass
metadata:
  name: kata-sandbox
handler: kata
```

Then Pods can specify like this:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: app-with-stronger-isolation
spec:
  runtimeClassName: kata-sandbox
  containers:
    - name: app
      image: nginx:latest
```

TIPS:
- Sandbox in Kubernetes essentially has two meanings layered together: on one hand, it's the Pod's runtime foundation; on the other hand, it's a stronger isolation runtime model
- RuntimeClass is the API mechanism for choosing runtimes in K8S. It references underlying container runtime configurations through `handler`. Solutions like `gVisor` and `Kata Containers` are isolation implementations corresponding to underlying runtime/handlers, not "implementations" of RuntimeClass itself.

## Agentic AI Agent Sandbox

Starting last year, Mike also encountered Agentic AI Agents. At this point, he found the term sandbox had upgraded further: from "system isolation" toward "capability governance"

In this scenario, what needs to be restricted is often no longer just an ordinary process, but:
- An agent that plans steps
- An agent that calls tools
- An agent that reads and writes files
- An agent that executes shell commands
- An agent that might even connect to networks, call APIs, operate code repositories

At this point, the focus is no longer just "where the process runs," but: what exactly can this intelligent agent do.

### Why Do Agents Particularly Need Sandbox?

Unlike ordinary programs that typically only execute according to predetermined logic, with LLM backing, Agents often have:
- Goal orientation
- Multi-step planning
- Tool invocation
- Continued action after result feedback

Precisely because of this, their risks aren't just "program crashed," but broader usage scenarios:
- Can see too much: Originally should only read one project directory, but can access more content across the entire machine.
- Can do too much: Originally should only analyze logs, but ends up modifying files, changing configurations, or even executing high-risk commands.
- Can connect too far: Originally should only process data locally, but can access external networks and call third-party interfaces.
- Can continuously trial-and-error until crossing boundaries: Because agents keep trying until completing goals; if boundaries aren't set properly, they might keep trying until reaching places they shouldn't touch.

### What Does Agentic AI Agent Sandbox Become?
Sandbox gives agents a controlled action space:
- At this point, what's typically limited isn't a single process perspective, but the entire capability set.

### Common Restriction Methods
- File system scope restrictions: Only allow access to specific directories/whitelisted directories, not the entire machine.
- Command execution scope restrictions: Allow execution of specific commands, not all commands. For example: `ls`, `rg`, test commands, etc.; but don't allow default execution of high-risk actions like the notorious `rm -rf`, modifying system configurations, etc.
- Network access restrictions: Some scenarios allow networking, others completely prohibit it.
- Approval mechanisms: Specific operations like pushing code, deploying services, etc., require explicit approval.

TIPS:
- In Agents, sandbox's focus isn't simply isolating processes, but limiting the agent's observation scope, operation scope, and destructive capability within controllable boundaries.
- Current mainstream Agent implementations essentially treat Agents as "intelligent entities" rather than "ordinary processes," then give them controlled action spaces. During Agent initialization, they typically request working directories, tool permissions, network permissions, etc.

## Similarities and Differences Among Three Types of Sandbox

At this point, Mike felt he could outline the similarities and differences among three types of sandbox.

- In Docker, sandbox ensures programs don't run directly bare on the host machine.
- In K8S, sandbox defines and limits what boundaries workloads run within in the cluster.
- In Agentic AI Agents, sandbox ensures intelligent entities' capability scope and destructive power are controlled within manageable boundaries.


## Summary

Looking at this journey, Mike finally understood Sandbox: It's not a single product, but a security implementation philosophy: through isolation, constraints, and minimum privileges, confine programs or intelligent entities to run within controllable boundaries.

Its core methods remain consistently stable:
- Isolation
- Constraints
- Minimum privileges
- Reduced damage surface

In different technology stacks, sandbox implementations take different forms, but the underlying problems they solve are consistent: let systems do things, but don't let them do stupid things.