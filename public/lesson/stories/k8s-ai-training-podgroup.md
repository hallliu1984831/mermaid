# K8S 持续演进之小李的观察：低头干活之余，也抬头看路

## 故事背景

小李学习和使用 Kubernetes 已经有年头了。平时他的工作并不神秘，大多是一些很具体的事情，其中的亮点自然是处理告警及其引发的故障，包括但不限于：
- Pod 为什么 Pending？
- Service 为什么访问不通？
- 某个应用为什么一直 CrashLoopBackOff？
- Prometheus 为什么又开始告警？
- Grafana 图上那条线为什么突然抖了一下？
- Secret 里的密码是不是多了一个换行？

这些问题很琐碎，处理起来也着实费了不少精力，但贵在真实可靠，也让小李不断地成长并开始独当一面。他一直觉得，SRE 不能只低头处理眼前的告警，也要偶尔抬头看看路。尤其是 K8S 这种基础设施，一旦方向变了，后面的平台能力、运维方式、团队分工都会跟着变。说白了：K8S 这个方向还值不值得继续投入？

最近，小李看到了 CNCF 在 2026 年 1 月发布的 2025 年度云原生调查（Annual Cloud Native Survey）。报告里有几个数字让他不由的停下来多看了几眼：
- 82% 的容器用户已经在生产环境使用 K8S。
- 66% 托管生成式 AI 模型的组织，使用 K8S 管理部分或全部推理工作。
- 44% 的组织还没有在 K8S 上运行 AI/ML workload。

小李觉得，这几个数字放在一起，很有意思：一方面，K8S 已经不是新鲜东西了，它已经是很多公司生产环境的基础设施。另一方面，AI workload 正在往 K8S 上靠，尤其是推理服务。但同时，还有不少组织并没有真正把 AI/ML workload 跑在 K8S 上。

小李的第一反应不是“大家都已经搞定 AI 平台了”，而是：这个方向已经开始发生，但还远没有结束。同时他也更坚定了一件事：AI 时代，K8S 不会轻易退场，学好 K8S 仍然是有复利的事情。

换句话说，这些数字给小李的信号不是“AI 已经把 K8S 用明白了”，而是“K8S 正在被继续带入 AI 场景，而且这条路还在往前走”。

不过，小李也知道，AI 这个词太大了：supercomputer、万卡集群、基础大模型训练，这些都和 SRE 的日常工作关联性不强。所以他想从自己熟悉的层面来分享下他眼中 K8S 的发展前景：从 CNCF 报告中已知的信息里，管中窥豹。

## 1. 第一个小信号：K8S 早就能调度 GPU

小李最早关心的是一个朴素问题：在 GPU 火到发紫的今天，K8S 到底能不能用 GPU？

答案是：必须能，而且不是最近才开始！

到 K8S v1.26，Device Plugin 机制已经进入稳定可用状态。通过这个机制，K8S 可以支持 GPU、FPGA、高性能网卡等需要厂商插件配合的设备。管理员在 GPU worker node 上安装驱动和对应的 device plugin 后，K8S 就可以把 GPU 暴露成可调度资源。

比如一个 NVIDIA GPU 节点（K8S 集群的专用 GPU 工作节点）可能提供如下能力，乍一看，是不是像申请 CPU、memory 一样简单？

```text
# 提供可用的 GPU 数量
nvidia.com/gpu: 8

#Pod 的部署 yaml 文件可以这样申请：
...
resources:
  limits:
    nvidia.com/gpu: 1
...
```

从这个能力来看，K8S 已经较早具备了把 GPU 作为可调度资源分配给 Pod 的能力。但小李也很快意识到，能看到 GPU，只是第一步。真实使用时，大家可能还会有很多疑问：
- 这张 GPU 是什么型号？多大显存？
- GPU 安装在哪？是否健康？如何监控？
- GPU 的具体使用场景是什么？
- GPU 利用率怎么统计？

所以，小李觉得 AI 时代 K8S 面临的问题，不是“能不能看到 GPU”这么简单，而是“能不能把 GPU 这种昂贵资源管好”。

## 2. 第二个小信号：DRA 让设备申请变细

后来，小李又看到 K8S 在 DRA，也就是 Dynamic Resource Allocation 上持续推进。一开始他觉得这个名字有点抽象，后来用存储的例子一对比，就好懂多了。

存储里常见的是，从存储供应商申请存储：StorageClass -> PVC -> Pod 使用 Volume

DRA 想表达的是类似思路，从设备供应商申请设备：DeviceClass -> ResourceClaim -> Pod 使用 GPU / TPU / NIC

相较于 K8S v1.26 版本提到的 Pod 申请 GPU 的方式（nvidia.com/gpu: 1），前者很直观，但也很粗放。用大白话说，过去更像是：我要 1 张 GPU。而后者 DRA 想表达的能力更像是：我要一张符合条件的 GPU。

在普通业务里，粗一点可能还能接受。但 AI workload 有时候会更挑设备：
- 不是随便一张 GPU 都行
- 显存大小可能有要求
- 设备能力可能有差异
- 多个设备之间的拓扑关系会影响速度(在同一个机架、同一个 rack 是最理想的状态)
- 有些设备可能需要被多个 Pod 以特定方式共享

到了 K8S v1.34，DRA 的核心能力已经 GA。这说明它不再只是一个实验方向，而是 K8S 设备管理能力的重要演进。到这，小李把自己的理解写成两句话：
- Device Plugin 让 K8S 看见 GPU。
- DRA 让 K8S 更细地理解 GPU。

但这不是说每家公司都要尽快上 DRA，而是它说明 K8S 社区已经意识到：AI workload 下的设备管理，不能永远停留在“我要 1 张 GPU”这个粗粒度表达上。

## 3. 第三个小信号：调度开始从 Pod 看到任务

小李过去理解调度，基本是：Pod -> Node。用大白话说也就是：这个 Pod 能不能找到一个 Node 跑起来？这个模式对很多 Web 服务、后台服务、普通 batch job 都很好用。

比如一个 Web 服务有 4 个副本，如果今天资源只够先跑 2 个，通常也不是完全不能用，只是处理能力不足：
- 先起来 2 个副本，可以先扛一部分流量。
- 后面资源够了，再把另外 2 个补上。

但 AI 训练和一些批处理任务里，有些场景不是这种玩法。小李并没有继续深挖分布式训练细节，只列举一个之前看过的平台视角的问题：
- 有些 AI 任务不是一个 Pod 跑起来就算开始。它可能需要一组 Pod、几张 GPU、配套的数据处理任务一起到位。如果只启动其中一部分，任务并不会真正推进，反而会提前占住昂贵的 GPU 资源。

换句话说，平台要关心的已经不只是这个 Pod 能不能先跑起来？
而是更高层级的用法：这个任务需要的几个 Pod，能不能一起跑起来？如果凑不齐，是不是先别占 GPU？多个任务都在等资源，谁先跑，谁后跑？

这时候，就能理解 K8S v1.35 和 v1.36 里关于 Workload-Aware Scheduling、PodGroup、Workload API 的相关演进了。它关注的点不是单个 Pod 能不能先跑起来，而是更高一层的“任务”：
- 把一组 Pod 看作一个整体，一起调度。
- 为任务设置优先级、配额、资源需求等属性，让调度器从任务整体来做决策。

按照小李自己使用的比喻，如果把 K8S 看作一所大学，Pod 是学校的共享宿舍，那么 PodGroup / Workload API 就更像是一场课题答辩的安排单。

普通 Pod 调度，就像后勤部门给一个学生安排宿舍：只要有宿舍的空床位，这个学生就能先入住。

但有些 AI 任务不是这样。它更像一次课题答辩：不是某个学生先到会议室就能开始，而是答辩小组、会议室、投影设备、评委老师都要同时准备好。

如果只来了两个学生，评委没到，投影设备也没准备好，这场答辩就不能开始；但会议室和设备却可能已经被占住了。

所以 PodGroup / Workload API 想表达的，不是“给某个 Pod 找个地方住”，而是“这一组 Pod 背后的任务，能不能作为一个整体真正开场”。

更细一点说，Workload 更像这场答辩本身，PodGroup 更像这场答辩需要一起到场的成员名单。

## 4. PodGroup 和 Workload：方向重要，但它还在路上

有一个细节需要说明一下：K8S 原生 Workload / PodGroup API 在 v1.35 / v1.36 仍然是 alpha。这意味着它代表的是一个方向，而不是已经大规模成熟落地的生产方案。

真实生产里，很多团队会先通过已有的解决方案，如 Kueue、Volcano、Run:ai、KAI Scheduler 这类生态工具解决排队、配额、优先级和 GPU 利用率问题。

所以，小李对 PodGroup / Workload 的理解也更准确了：
- 它不是现在所有公司都要立刻采用的成熟方案。
- 它更像是 K8S 社区在把 AI 和 batch workload 的真实需求，慢慢吸收到原生调度体系里。

## 5. 小李的总结

看到这里，小李觉得 K8S 对 AI 的支持，可以先按三步理解：

```text
第一步：GPU 设置
K8S 先要能看见 GPU。
节点上装好驱动和 device plugin，Pod 才能像申请 CPU、memory 一样申请 GPU。

第二步：DRA
光知道“我要 1 张 GPU”还不够。
K8S 还需要更细地理解设备：是什么设备、能力怎样、能不能共享、适不适合这个任务。

第三步：PodGroup / Workload
有些任务不是一个 Pod 自己跑就行。
它需要一组 Pod 一起开工，所以调度器不能只盯着单个 Pod，还要看整个任务。
```

如果用一句话概括，就是：从看见 GPU --> 到理解 GPU --> 再到理解一组 Pod 背后的任务

小李觉得，这就是 K8S 在 AI 时代比较清楚的一条演进线：AI 这个题目很大，但 K8S 并没有停在原地。它正在一点一点补上 AI workload 需要的底层能力。

小李合上报告时，脑子里又冒出了另一个问题：

```text
如果 K8S 真的会成为 AI workload 的底座，那 SRE 最先接触到的 AI 场景，会不会不是训练大模型，而是告警分析、故障归因、值班助手这些更贴近日常工作的系统？
```

这个问题，他准备下一篇继续想。

## 参考

- CNCF Annual Cloud Native Survey 2025  
  https://www.cncf.io/announcements/2026/01/20/kubernetes-established-as-the-de-facto-operating-system-for-ai-as-production-use-hits-82-in-2025-cncf-annual-cloud-native-survey/
- Kubernetes v1.34: DRA has graduated to GA  
  https://kubernetes.io/blog/2025/09/01/kubernetes-v1-34-dra-updates/
- Kubernetes v1.36: Advancing Workload-Aware Scheduling  
  https://kubernetes.io/blog/2026/05/13/kubernetes-v1-36-advancing-workload-aware-scheduling/
- Kubernetes Device Plugins  
  https://kubernetes.io/docs/concepts/extend-kubernetes/compute-storage-net/device-plugins/
- Kubernetes GPU Scheduling  
  https://kubernetes.io/docs/tasks/manage-gpus/scheduling-gpus/

----- English
# K8S Keeps Evolving: Mike Looks Up While Still Doing the Work

## Background

Mike had been learning and using Kubernetes for years. His day-to-day work was not mysterious. Most of it came down to very concrete problems, especially alerts and the incidents behind them:
- Why is this Pod Pending?
- Why is this Service unreachable?
- Why does this application keep going into CrashLoopBackOff?
- Why is Prometheus firing alerts again?
- Why did that Grafana line suddenly spike?
- Did the password in this Secret accidentally include a newline?

These problems were small and repetitive, and they took real effort to handle. But they were also real production problems, and they helped Mike grow into someone who could handle incidents on his own.

Mike had always felt that an SRE should not only keep their head down and handle the alerts in front of them. From time to time, they also need to look up and see where the road is going. This is especially true for an infrastructure layer like K8S. If its direction changes, platform capabilities, operations practices, and team responsibilities will all change with it.

To put it plainly:

```text
Is K8S still a direction worth investing in?
```

Recently, Mike read the 2025 Annual Cloud Native Survey released by CNCF in January 2026. A few numbers made him stop and look twice:
- 82% of container users are already running K8S in production.
- Among organizations hosting generative AI models, 66% use K8S to manage some or all of their inference workloads.
- 44% of organizations are not yet running AI/ML workloads on K8S.

Mike found these numbers interesting when placed side by side.

On one hand, K8S is no longer something new. It has already become part of the production infrastructure in many companies.

On the other hand, AI workloads are moving toward K8S, especially inference services. At the same time, many organizations have not really started running AI/ML workloads on K8S yet.

Mike's first reaction was not, "Everyone has already figured out AI platforms."

Instead, it was:

```text
This direction has started to take shape, but it is far from finished.
```

At the same time, he became more certain about one thing: in the AI era, K8S is unlikely to disappear. Learning K8S well still has compounding value.

In other words, the signal Mike saw from these numbers was not that AI had already made full use of K8S. The signal was that K8S was continuing to be pulled into AI scenarios, and that road was still moving forward.

Mike also knew that AI is a very big word. Supercomputers, tens of thousands of GPUs, and training foundation models from scratch are not very close to the daily work of most SREs.

So he wanted to look at the future of K8S from a level he was familiar with: by taking a small glimpse from the information already visible in the CNCF report.

## 1. First Small Signal: K8S Has Been Able to Schedule GPUs for a Long Time

The first simple question Mike cared about was this:

```text
Now that GPUs are everywhere in AI discussions, can K8S actually use GPUs?
```

The answer is: yes, absolutely. And this did not start recently.

By K8S v1.26, the Device Plugin mechanism had reached a stable state. Through this mechanism, K8S can support devices that require vendor plugins, such as GPUs, FPGAs, and high-performance network cards.

After an administrator installs the driver and the corresponding device plugin on a GPU worker node, K8S can expose the GPU as a schedulable resource.

For example, an NVIDIA GPU node, which is a dedicated GPU worker node in the K8S cluster, may provide the following capacity. At first glance, it feels almost as simple as requesting CPU or memory:

```text
# Available GPU count
nvidia.com/gpu: 8

# A Pod deployment YAML can request it like this:
...
resources:
  limits:
    nvidia.com/gpu: 1
...
```

From this capability, K8S had already gained the ability to allocate GPUs to Pods as schedulable resources relatively early.

But Mike quickly realized that seeing the GPU is only the first step. In real usage, teams may still have many questions:
- What model is this GPU? How much memory does it have?
- Where is the GPU installed? Is it healthy? How should it be monitored?
- What exactly will this GPU be used for?
- How should GPU utilization be measured?

So in Mike's view, the challenge K8S faces in the AI era is not simply whether it can see GPUs.

The real question is:

```text
Can K8S manage expensive resources like GPUs well?
```

## 2. Second Small Signal: DRA Makes Device Requests More Precise

Later, Mike noticed that K8S had been continuously advancing DRA, or Dynamic Resource Allocation.

At first, the name felt a bit abstract. But once he compared it with storage, it became much easier to understand.

In storage, a common flow is:

```text
Request storage from a storage provider:
StorageClass -> PVC -> Pod uses Volume
```

DRA tries to express a similar idea:

```text
Request devices from a device provider:
DeviceClass -> ResourceClaim -> Pod uses GPU / TPU / NIC
```

Compared with the GPU request method mentioned around K8S v1.26, such as `nvidia.com/gpu: 1`, the older approach is very direct, but also coarse-grained.

In plain language, the old way is closer to:

```text
I need one GPU.
```

DRA is trying to express something more like:

```text
I need a GPU that meets certain conditions.
```

For ordinary business workloads, a coarse-grained request may often be good enough. But AI workloads can be much more selective about devices:
- Not just any GPU will work.
- GPU memory size may matter.
- Device capabilities may differ.
- The topology between multiple devices can affect performance. Being in the same rack is often the ideal case.
- Some devices may need to be shared by multiple Pods in specific ways.

By K8S v1.34, the core capability of DRA had graduated to GA. This means it is no longer just an experimental direction. It represents an important evolution in how K8S manages devices.

At this point, Mike wrote down two sentences to summarize his understanding:
- Device Plugin lets K8S see GPUs.
- DRA lets K8S understand GPUs more precisely.

This does not mean every company should rush to adopt DRA immediately.

But it does show that the K8S community has recognized one thing: under AI workloads, device management cannot stay forever at the coarse level of "I need one GPU."

## 3. Third Small Signal: Scheduling Starts to Look Beyond a Single Pod

In the past, Mike's understanding of scheduling was basically:

```text
Pod -> Node
```

In plain language:

```text
Can this Pod find a Node to run on?
```

This model works well for many web services, backend services, and ordinary batch jobs.

For example, if a web service has four replicas and the cluster only has enough resources to start two today, the service is usually not completely unusable. It just has less capacity:
- Two replicas can come up first and handle part of the traffic.
- When more resources become available, the other two replicas can be added later.

But in AI training and some batch-processing scenarios, things may work differently.

Mike did not want to dig deep into distributed training details here. He only focused on one platform-level problem he had seen before:
- Some AI tasks do not really start just because one Pod is running. They may need a group of Pods, several GPUs, and supporting data-processing tasks to be ready together. If only part of the task starts, the job may not make real progress and may instead occupy expensive GPU resources too early.

In other words, the platform should no longer only ask:

```text
Can this Pod start first?
```

It needs to ask at a higher level:

```text
Can the Pods required by this task start together?
If the cluster cannot satisfy the whole task, should it avoid occupying GPUs first?
When multiple tasks are waiting for resources, which one should run first?
```

This is where the evolution around Workload-Aware Scheduling, PodGroup, and the Workload API in K8S v1.35 and v1.36 starts to make sense.

The focus is no longer only whether a single Pod can start. It is the higher-level task:
- Treat a group of Pods as a whole and schedule them together.
- Set priority, quota, and resource requirements for the task so that the scheduler can make decisions from the task's perspective.

Using Mike's own analogy, if K8S is a university and Pods are shared dorm rooms, then PodGroup and the Workload API are more like the scheduling sheet for a thesis defense.

Ordinary Pod scheduling is like the logistics department assigning a student to a dorm room. As long as there is an empty bed, the student can move in first.

But some AI tasks are different. They are more like a thesis defense. It does not begin just because one student arrives at the meeting room. The defense group, the room, the projector, and the review committee all need to be ready at the same time.

If only two students arrive, while the committee is absent and the projector is not ready, the defense cannot begin. But the meeting room and equipment may already be occupied.

So what PodGroup and the Workload API try to express is not "find a place for this Pod to live."

It is:

```text
Can the task behind this group of Pods really start as a whole?
```

More specifically, Workload is more like the defense itself, while PodGroup is more like the list of participants who need to show up together.

## 4. PodGroup and Workload: Important Direction, Still on the Road

One detail needs to be made clear: the native K8S Workload and PodGroup APIs in v1.35 and v1.36 are still alpha.

That means they represent an important direction, not a production-ready solution that every company should adopt at scale immediately.

In real production environments, many teams are more likely to first use existing ecosystem tools such as Kueue, Volcano, Run:ai, and KAI Scheduler to solve problems around queues, quotas, priorities, and GPU utilization.

So Mike's understanding of PodGroup and Workload became more accurate:
- They are not mature solutions that every company should immediately adopt today.
- They are more like a signal that the K8S community is gradually absorbing the real needs of AI and batch workloads into the native scheduling system.

## 5. Mike's Summary

At this point, Mike felt that K8S support for AI could first be understood in three steps:

```text
Step 1: GPU setup
K8S first needs to be able to see GPUs.
After drivers and device plugins are installed on the nodes, Pods can request GPUs just like they request CPU and memory.

Step 2: DRA
Knowing only "I need one GPU" is not enough.
K8S also needs to understand devices more precisely: what the device is, what capabilities it has, whether it can be shared, and whether it is suitable for this task.

Step 3: PodGroup / Workload
Some tasks cannot be handled by a single Pod alone.
They need a group of Pods to start together, so the scheduler cannot only look at one Pod. It needs to look at the whole task.
```

In one sentence:

```text
From seeing GPUs -> to understanding GPUs -> to understanding the task behind a group of Pods
```

Mike felt that this was a relatively clear evolution path for K8S in the AI era.

AI is a huge topic, but K8S has not stood still. It is gradually filling in the low-level capabilities that AI workloads need.

As Mike closed the report, another question came to mind:

```text
If K8S really becomes the foundation for AI workloads, will the first AI scenarios SREs encounter be not training large models, but alert analysis, root cause investigation, and on-call assistants that are closer to daily operations?
```

That is a question he plans to think about in the next article.

## References

- CNCF Annual Cloud Native Survey 2025  
  https://www.cncf.io/announcements/2026/01/20/kubernetes-established-as-the-de-facto-operating-system-for-ai-as-production-use-hits-82-in-2025-cncf-annual-cloud-native-survey/
- Kubernetes v1.34: DRA has graduated to GA  
  https://kubernetes.io/blog/2025/09/01/kubernetes-v1-34-dra-updates/
- Kubernetes v1.36: Advancing Workload-Aware Scheduling  
  https://kubernetes.io/blog/2026/05/13/kubernetes-v1-36-advancing-workload-aware-scheduling/
- Kubernetes Device Plugins  
  https://kubernetes.io/docs/concepts/extend-kubernetes/compute-storage-net/device-plugins/
- Kubernetes GPU Scheduling  
  https://kubernetes.io/docs/tasks/manage-gpus/scheduling-gpus/
