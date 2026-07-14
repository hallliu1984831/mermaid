# 两个命令让你零距离接触 k8s

## 引子
最近有好几次，我被问到一个问题：想学 Kubernetes，但不想一上来就买云服务器，也不想把电脑折腾成实验田，有没有低成本一点的办法？

先说答案：有，而且非常简单。标题里说的两个命令，指的就是 k3d 的安装和集群创建。当然严格说，前提是 Docker 和 kubectl 已经准备好。

说实话，我能理解这个问题的初衷：学习一门技术本身也是需要时间、精力和成本的，如果能用最小的代价来学习一个新知识，例如 Kubernetes，是一件让人兴奋的事情。

拿我自己举例子，我刚开始学 k8s 的时候，也被同样的原因劝退过：
- 看文档的时候，感觉 Kubernetes 知识点太多，记不住；
- 抱着一本砖头厚的《Kubernetes in Action》看了半个月，还是云里雾里。记住了后面，忘掉了前面；
- 真要自己动手，又发现没有合适的操作环境；

等到不得不实操的时候，就要考虑使用环境的各种方案：
- 云上建集群，要花钱，不符合成本最小原则；
- 自己装 kubeadm，步骤不少，出了错不知道如何修复；
- 用虚拟机跑多节点，本机风扇先起飞；虚拟机本身又提升了难度；

后来，我发现了一个挺适合入门的工具：`k3d`。它的好处不是“最接近生产”，也不是“功能最完整”，而是特别适合新手学习：有 Docker 就能起一个 Kubernetes 集群，用完就删，成本几乎为零！
虽然 k3d 出现已经很长时间了，但是它的存在感一直不高。正好最近有被问到这个问题，我想把这个工具推荐给同样想低成本学习 k8s 的人：赠人玫瑰，手有余香。

## 1. 从 k8s 开始
第一次看到 k8s 这个名字，很容易懵。我一开始也觉得奇怪：怎么和 Kubernetes 一样，都是 K 开头，中间还夹着数字？
一句话，简单可以这样理解。
- Kubernetes，把开头字母 K 和结尾字母 s 中间 8 个字母（ubernete）用 8 来替换，就成了我们常挂在嘴边的 k8s，说起来方便，也不用说这么拗口的英文单词。
类似的还有：
- i18n = internationalization
- 中文的“不明觉厉”

## 2. 扩展到 k3s 和 k3d
- k3s： 轻量版 Kubernetes
k3s 是 Rancher 推出的轻量 Kubernetes 发行版，后来进入云原生基金会沙箱项目 （CNCF Sandbox）。它的目标不是重新发明 Kubernetes，而是让 k8s 更轻、更容易在资源有限的环境里跑起来。
官方文档里也能看到，k3s 的最低资源要求比标准生产集群友好很多：server 节点最低 2 核 + 2GB，agent 节点最低 1 核 + 512MB。当然，这只是 k3s 自己和内置组件的底线，不包括你后面跑的业务。
- k3d: k3s in Docker
这个名字最直白: k3d 做的事情，就是把 k3s 跑在 Docker 容器里。你执行一条命令，它就在你的电脑上用几个 Docker 容器拼出一个 Kubernetes 集群。
总结下：
- k8s 是目标，我们的学习对象
- 为了降低学习成本，可以先用 k3s 这个 k8s 的轻量版。
- 为了更方便地在本地使用，可以再用 k3d 把 k3s 放进 Docker 里。
理解了这 3 个名字及其概念以后，你只需要执行两个命令，就可以零距离接触 k8s！

## 3. 为什么我觉得 k3d 适合入门
我推荐 k3d，不是因为它能替代生产环境，而是因为它能解决学习阶段最烦人的几个问题。
### 不用先买云服务器
只要电脑能跑 Docker，就可以起一个本地集群。学完了删掉，不会收到云账单。
### 创建和删除很快
传统方式安装/使用一个集群，心里总会有点负担：万一装坏了怎么办？万一敲错命令把集群搞崩了如何恢复？
k3d 的体验更像：
- 起一个集群试试。
- 玩坏了就删。
- 删完再建一个。
这对新手很重要，更加友好。
### 能练真正的 kubectl
用 k3d 起的集群，照样可以用各种 k8s 命令：
```bash
kubectl get pods
kubectl describe pod
kubectl logs
kubectl apply -f
kubectl delete -f
```
也就是说，新手最该练的那些 Kubernetes 基本功，k3d 都能覆盖。

### 可以模拟多节点
比如你想操作一个集群里有多个 worker node 是什么感觉，可以直接创建起来：
```bash
k3d cluster create test-k8s --servers 1 --agents 2
```
- test-k8s 是集群的名字
- servers 1 代表集群使用一个 master 节点
- agents 2 代表集群具备两个 worker 节点

这背后其实就是对应了几个 Docker 容器，但 `kubectl get nodes` 看起来就是一个小 Kubernetes 集群。

## 4. k3d 入门
下面我简单说明下具体的步骤，请各位自行实践。老话说得好：纸上得来终觉浅，绝知此事要躬行。用码农的话说：干就完了，先跑起来再说。概要步骤的命令以 MacOS 为例，其他平台请自行调整。
### 前提条件：
- Docker 已经装好
- kubectl 已经装好

### 命令一： 安装 k3d
```bash
brew install k3d
```
### 命令二：创建一个小集群：
```bash
k3d cluster create test-k8s --servers 1 --agents 2
```
到这儿，你就可以零距离接触 k8s 了。你瞧瞧，是不是两个命令就完事了？

检查结果：
```bash
# 看一下节点
kubectl get nodes
# 类似这样的输出：
NAME                    STATUS   ROLES                  AGE   VERSION
k3d-test-k8s-server-0   Ready    control-plane,master   1m    v1.xx.x+k3s
k3d-test-k8s-agent-0    Ready    <none>                 1m    v1.xx.x+k3s
k3d-test-k8s-agent-1    Ready    <none>                 1m    v1.xx.x+k3s
# 删掉：
k3d cluster delete test-k8s
```
如果看到上述结果，那就说明你的本地 k8s 集群已经起来了。这也是我喜欢 k3d 的地方：它把“搭环境”的心理负担降下来了。
## 5. 有了这个集群，可以先练什么
由于个人学习习惯不同，所以标准答案也不同。如果你问我有啥建议，我就一条：刚开始学 k8s，先把最常用的命令练熟。
如果大家有需要，可以给我留言，我后续可以发布一些练习题，能走完一个模拟场景、并且形成闭环的那种。
但前提是你要先把 k3d 装起来啊，加油💪！
## 参考
- k3d GitHub  
  https://k3d.io/stable/

----- English

# Learn Kubernetes Locally with k3d in Two Commands

## Introduction

I have been asked the same question several times recently:

> I want to learn Kubernetes, but I do not want to rent cloud servers right away, and I do not want to turn my laptop into a complicated lab environment. Is there a cheaper and simpler way to get started?

The short answer is yes.

The two commands in the title refer to installing `k3d` and creating a local Kubernetes cluster. Strictly speaking, the assumption is that Docker and `kubectl` are already installed.

I completely understand this concern. Learning a new technology already takes time and energy. If we can reduce the setup cost as much as possible, especially for something as broad as Kubernetes, that is a very good start.

When I first started learning Kubernetes, I was also discouraged by the same things:

- The documentation felt huge, and there were too many concepts to remember.
- I read *Kubernetes in Action* for a while, but still felt lost. I remembered one part, then forgot another.
- When I finally wanted to practice, I realized I did not have a convenient environment.

Once you decide to actually get your hands dirty, the environment becomes the first problem:

- Creating a cloud cluster costs money.
- Installing a cluster with `kubeadm` involves many steps, and troubleshooting installation errors is not beginner-friendly.
- Running multiple virtual machines locally can quickly make your laptop suffer, and the virtual machine setup itself adds another layer of complexity.

Later, I found a tool that is very suitable for beginners: `k3d`.

Its value is not that it is the closest thing to production, nor that it covers every Kubernetes feature. Its biggest advantage is that it is easy to use for learning: if you have Docker, you can create a Kubernetes cluster locally, practice with it, and delete it when you are done. The cost is almost zero.

Although k3d has been around for quite some time, it still does not get as much attention as it deserves. Since I have been asked about this topic recently, I want to recommend it to anyone who wants to learn Kubernetes with a low-cost local setup.

## 1. Starting with k8s

The first time you see the name `k8s`, it may look a little strange. I felt the same way at the beginning. Why does Kubernetes suddenly become something with a number in the middle?

The idea is simple:

- `Kubernetes` starts with `K` and ends with `s`. There are 8 letters in between, so people shorten it to `k8s`.

Similar examples include:

- `i18n` = internationalization
- In Chinese, we also have many shortened expressions that compress longer phrases into something easier to say

## 2. From k8s to k3s and k3d

Before we use k3d, it helps to understand three names.

- `k8s`: Kubernetes, the thing we want to learn.
- `k3s`: a lightweight Kubernetes distribution.
- `k3d`: k3s running inside Docker.

`k3s` is a lightweight Kubernetes distribution originally created by Rancher. It later became a CNCF Sandbox project. Its goal is not to reinvent Kubernetes, but to make Kubernetes lighter and easier to run in resource-constrained environments.

According to the official requirements, k3s can run with much lower resources than a typical production-grade Kubernetes cluster. A server node requires at least 2 CPU cores and 2 GB of memory, while an agent node requires at least 1 CPU core and 512 MB of memory. Of course, this only covers k3s itself and its built-in components. It does not include the workload you run later.

`k3d` is even more straightforward: it runs k3s inside Docker containers. When you run a command, k3d uses several Docker containers to create a small Kubernetes cluster on your machine.

So the learning path becomes clear:

- k8s is the target.
- k3s makes Kubernetes lighter.
- k3d makes k3s easy to run locally with Docker.

Once you understand these three names, you can get very close to Kubernetes with just two commands.

## 3. Why I Think k3d Is Great for Beginners

I recommend k3d not because it can replace a production Kubernetes environment, but because it solves several annoying problems in the learning stage.

### You do not need to rent cloud servers

As long as your machine can run Docker, you can create a local cluster. When you finish practicing, you can delete it. No cloud bill is waiting for you.

### Creating and deleting clusters is fast

With traditional cluster setup methods, there is always a bit of pressure:

- What if I break the cluster?
- What if I make a mistake and do not know how to recover?
- What if I just want to try something quickly?

k3d makes the experience much lighter:

- Create a cluster.
- Try something.
- Break it if you want.
- Delete it.
- Create another one.

This is very friendly for beginners.

### You can practice real kubectl commands

A cluster created by k3d still lets you practice common Kubernetes commands:

```bash
kubectl get pods
kubectl describe pod
kubectl logs
kubectl apply -f
kubectl delete -f
```

In other words, the basic Kubernetes skills a beginner should practice can all be covered with k3d.

### You can simulate a multi-node cluster

For example, if you want to see what it feels like to work with multiple worker nodes, you can create a small cluster like this:

```bash
k3d cluster create test-k8s --servers 1 --agents 2
```

Here:

- `test-k8s` is the cluster name.
- `--servers 1` means the cluster has one server node.
- `--agents 2` means the cluster has two worker nodes.

Behind the scenes, these nodes are Docker containers. But from the perspective of `kubectl get nodes`, it looks like a small Kubernetes cluster.

## 4. Getting Started with k3d

The following steps use macOS as an example. Other platforms may require slightly different installation commands.

### Prerequisites

- Docker is installed.
- `kubectl` is installed.

### Command 1: Install k3d

```bash
brew install k3d
```

### Command 2: Create a small cluster

```bash
k3d cluster create test-k8s --servers 1 --agents 2
```

That is it. At this point, you already have a local Kubernetes cluster.

You can check the result with:

```bash
# Check the nodes
kubectl get nodes

# Example output:
NAME                    STATUS   ROLES                  AGE   VERSION
k3d-test-k8s-server-0   Ready    control-plane,master   1m    v1.xx.x+k3s
k3d-test-k8s-agent-0    Ready    <none>                 1m    v1.xx.x+k3s
k3d-test-k8s-agent-1    Ready    <none>                 1m    v1.xx.x+k3s

# Delete the cluster when you are done
k3d cluster delete test-k8s
```

If you see the nodes in `Ready` status, your local Kubernetes cluster is up and running.

This is exactly why I like k3d: it lowers the mental cost of setting up a Kubernetes practice environment.

## 5. What Should You Practice First?

Different people have different learning habits, so there is no single standard answer.

But if you ask me, my suggestion is simple:

Start by practicing the most common Kubernetes commands.

For beginners, do not rush into every advanced topic. First get comfortable with creating resources, checking Pods, reading logs, describing objects, applying YAML files, and deleting resources.

Once you have a small local cluster running, Kubernetes becomes less abstract. You are no longer only reading concepts from a document. You can actually run commands, observe results, make mistakes, and try again.

That is often where real learning begins.

## Reference

- k3d official documentation  
  https://k3d.io/stable/
