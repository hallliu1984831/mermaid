# 自动化之 CI/CD：小李的 GitOps 之旅 

## 故事背景
小李记得很清楚，在 SRE 入职的时候参加的新人培训，里面有一个章节很明确的提到了自动化在 SRE 日常工作中的重要性，主要的目的是把容易出错、容易依赖人记忆的流程，变成稳定的自动化机制。从而达到如下目的：
- 减少重复性劳动，提高工作效率
- 降低人为错误率，提高系统稳定性

当时小李还觉得：自动化嘛，不就是写一些 bash 脚本，然后用各种定时任务来触发嘛。经历了几年的工作磨练后，小李才发现当时对自动化的理解还很浅显。诚然，bash 脚本 + 定时任务的方式是自动化的一种实现方式，然而在日常工作的方方面面，小李都能看到自动化的身影。

这其中，发布自动化（CI/CD）就是一个特别典型的例子。有意思的是，持续集成 (CI ：Continuous Integration) 和 持续部署 (CD：Continuous Deployment) 作为自动化发布流程，工具本身也在不断演进。接下来我们就跟着小李的亲身经历，一起看看 CI/CD 这套发布自动化流程，是怎么一步步演进的。

小李从2005年开始工作，这些年恰好见证了主流的 CI/CD 工具的演进：
```text
# 第一阶段：
实现方式：手动执行 build.xml 或者 ant.xml，生成可执行文件

# 第二阶段：流水线在 Jenkins 里
实现方式：GitHub + Jenkins

# 第三阶段：流水线在代码仓库里
实现方式：GitLab CI/CD

# 第四阶段：流水线只负责构建，部署由 GitOps 工具负责
实现方式：GitHub Actions + FluxCD
```

工具一直在变，但小李慢慢发现，真正变化的不是工具名字，而是发布自动化背后的自动化思路。

## 1. 第一阶段：手动执行 build.xml 或者 ant.xml

小李刚参加工作时，最常见的发布方式是：登录到服务器，用 git 命令拉代码，然后用 ant 命令执行 build.xml 或者 ant.xml 里的目标，生成可执行文件。

那个阶段的自动化更多体现在 build.xml 里，编译、打包有规则可循，但发布动作本身还是靠人串起来：
- build 失败要人看
- 测试失败要人查
- build 成功以后还要复制文件到发布目录
- 最后还要再手动重启服务。

小李依稀记得，当时看着 build 过程在满屏刷刷地输出各种日志时，感觉仿佛是电影《黑客帝国》的情景重现，真高级啊！

## 2. 第二阶段：GitHub + Jenkins，把手工发布脚本跑起来
特点：
- 代码放在 GitHub。
- Jenkins 负责拉代码、构建镜像、执行部署脚本。

小李还记得第一次看到 Jenkins job 时，觉得很酷炫，五颜六色的任务，各自带着进度条，有绿色的成功，红色的失败。关键是不停有新的任务自动加进来，看着很高大上。
新鲜劲过去以后，小李发现要掌握这个工具还是挺费劲儿的。因为 Jenkins 的配置全靠页面操作，而且每个任务的配置都散落在各个页面里，想要理清一个发布流程的全貌，得在 Jenkins 页面里来回切换很多次。
更麻烦的是，如果要修改一个发布流程，还得小心翼翼地在页面里点来点去，生怕改错了哪个环节。

但是相较于第一阶段，有了 Jenkins 以后，流程变成了：
- 点一下 Build 或者根据设定的触发条件自动 Build。
- Jenkins Job 自动拉代码。
- 自动执行 shell 脚本。
- 自动构建发布版本。
- 自动部署到环境。

这对当时的小李来说，已经是一个明显进步。因为它至少解决了一个问题：人不用每次都手敲同一堆命令。

后来小李接触容器知识以后，Jenkins 里又多了很多和docker相关的命令：
```bash
docker build ...
docker push ...
docker run ...
```

随着 K8S 成了主流，Jenkins 里自然又多了很多和集群相关的动作：
```bash
helm upgrade ...
kubectl apply ...
kubectl rollout status ...
```

看起来，发布已经自动化了。但用久了以后，小李也开始看到一些问题。比如：
- 很多发布逻辑藏在 Jenkins job 里。
- 有些脚本写在 Jenkins 页面里，有些脚本写在服务器目录里。
- 谁改过发布逻辑，不一定容易追踪。
- 不同环境靠参数区分，时间长了容易混乱。
- Jenkins 通常握着很大的权限，既能构建，又能部署，还能操作集群。

更麻烦的是，一旦发布出问题，小李经常要在几个地方来回切：
- GitHub 看代码
- Jenkins 看流水线
- 镜像仓库看 tag
- K8S 集群看 Deployment

遇到的问题也五花八门：
- 有时候流水线显示成功了，但线上 Pod 没起来。
- 有时候镜像确实推上去了，但 Deployment 用的还是旧 tag。
- 有时候 Jenkins job 的参数填错了，最后发布到了不该发布的环境。

小李慢慢意识到，Jenkins 把手工动作自动跑起来了，但发布逻辑本身还没有完全变得清晰、可审计、可回放。

用一句话说：Jenkins 解决了“自动执行”的问题，但没有很好解决“发布过程是否透明”的问题。

## 3. 第三阶段：GitLab CI/CD，流水线开始进入代码仓库

后来，小李又接触到了 GitLab CI/CD。

第一次看到 `.gitlab-ci.yml` 的时候，小李觉得这个思路很直观，一个文件就定义清楚了整个流程：
- 流水线配置也放进代码仓库。
- 构建、测试、部署步骤都可以跟代码一起 review。
- 谁改了发布流程，Git 里能看见。
- 不需要登录 Jenkins 页面，直接在 Git 仓库里就能看到流水线配置。

相比 Jenkins 页面里到处散落的配置，`.gitlab-ci.yml` 让 CI/CD 流程更像代码的一部分：所见即所得。

比如一个简化后的流水线可能长这样：

```yaml
stages:
  - test
  - build
  - deploy

test:
  stage: test
  script:
    - npm test

build:
  stage: build
  script:
    - docker build -t registry.example.com/order-api:$CI_COMMIT_SHA .
    - docker push registry.example.com/order-api:$CI_COMMIT_SHA

deploy:
  stage: deploy
  script:
    - helm package ./charts/order-api
    - helm upgrade order-api ./charts/order-api \
        -n production \
        --set image.tag=$CI_COMMIT_SHA
```
这比以前清楚很多：
- 流水线分3个阶段，按照 stages 定义的执行顺序，先运行 test，再 build，最后 deploy
- 每个阶段分工明确，职责清晰
- 任意阶段失败，整个构建过程就终止

小李至少能在代码的提交/ Merge Request 里看到当前构建的所有信息，这让发布流程变得更容易 review，也更容易沉淀经验。

但用了一段时间以后，小李发现，GitLab CI/CD 虽然让流水线配置更透明了，但 CD 这一段仍然有一个特点：流水线还是直接拿着 kubeconfig 去改集群。

也就是说，CI/CD 系统不只是构建镜像，还负责直接对 K8S 集群执行变更。 这当然可以工作，只不过调用地点从 Jenkins 换到了 Gitlab 的 runner 里，但小李总感觉还是有点别扭，原因很简单：
- CI/CD 系统需要持有集群写权限。
- 发布失败时，集群真实状态和 Git 仓库里的配置可能不一致。
- 发布成功时，需要额外去核对服务是否真的正常运行了。
- 有人临时 kubectl patch 过线上资源，Git 里不一定能反映。
- 要回滚时，既要看 Git，又要看流水线历史，还要看集群当前状态。

小李慢慢意识到，这里面有一个问题一直没有完全解决：线上集群当前应该是什么样，决定权到底应该在哪儿？换句话说，谁说了算？
- 是流水线最后一次执行的结果？
- 是 Git 仓库里的 YAML？
- 是 Helm values？
- 还是当前集群里 `kubectl get` 出来的状态？

这个问题，在发布顺利的时候不明显。但一旦出问题，就要检查很多地方，还是不能很快定位问题的根因。

不过，话又说回来了，gitlab CI/CD 还是有很多优点的，至少它已经把流水线配置放到了代码仓库里，这让发布流程更透明了。在很长一段时间里，小李都在不断打磨自己的流水线，让它能更高效、更自动。并将更多的 SRE 工具集成进来，很多配置都可以复用，用起来还是很方便的。

## 4. 第四阶段：GitHub Actions + FluxCD，CI 和 CD 开始分工

直到去年，小李接触到了另一种组合：GitHub Actions + FluxCD。一开始，他以为这只是工具又换了一轮：
- Jenkins 可以跑流水线。
- GitLab CI/CD 可以跑流水线。
- GitHub Actions 也可以跑流水线。

看起来没什么本质区别。但一番学习、实践并完成了一个工程的改造之后，小李的理解有很大改变。真正让小李眼前一亮的，是 FluxCD 的角色：它把 CD 单独给拎了出来！从此 CI 不再直接拿 kubeconfig 去改集群了！

在这种模式里，分工变得不一样了：
- GitHub Actions 负责 CI。
- FluxCD 负责 CD。

更具体一点：
```text
GitHub Actions：
- 跑测试
- 构建镜像
- 推送镜像
- 更新 Git 仓库里的镜像 tag / Helm values / Kustomize 配置

FluxCD：
- 运行在 K8S 集群里
- 持续监听 Git 仓库
- 发现 Git 中的期望状态变化
- 把集群真实状态对齐到 Git 中声明的状态
```

发布动作变成了：
- Github 代码合并。
- Github Action 构建镜像。
- Github Action 更新 Git 中的部署声明。
- FluxCD 看到 Git 变化。
- FluxCD 在集群内完成同步。

到这儿，小李还是想再次强调一下关键的变更，这和以前最大的不同是：
- 集群不是被外部流水线 push 改变。
- 集群是由内部控制器 pull Git 的期望状态来改变。
- Git 里的期望状态可以来自多种变更：一次代码 PR（Pull Request）、CI 更新的镜像版本号，或者 CI 更新的 Helm chart / values 配置。

前两点的好处自然不用说，小李最满意的还是第三点：以前是流水线把变更“推”进集群，现在是集群里的控制器盯着 Git，看 Git 里的期望状态有没有变化，再把该变的东西“拉”回来。

小李觉得，这个变化很关键。因为一旦 Git 成为期望状态的来源，很多事情就更清楚了：
```text
谁改了发布配置？
是 Git ！看 Git commit。

为什么线上变成这个版本？
还是 Git ！看 Git 历史。

要回滚到哪个版本？
依旧是 Git ！回滚 Git。

集群状态和 Git 不一致怎么办？
让控制器继续自动调整，直到一致。或者强制 reconcile。
```

到这儿，小李才慢慢理解 GitOps 的价值：GitOps 不是单纯换了一个 CD 工具。它更像是把发布自动化的中心，从“流水线执行了什么命令”，移动到了“Git 声明了什么状态”。

## 5. 小李的总结
这次梳理以后，小李对 SRE 自动化又多了一层理解。
- 自动化不是简单写一个脚本
- 真正好的自动化，应该让流程更稳定，也让问题更容易被追踪。

对于 CI/CD 来说，小李觉得有几个问题特别重要：
- 发布逻辑在哪里？
- 谁能改？
- 改动有没有 review？
- 发布后的真实状态和 Git 里的期望状态是否一致？
- 如果不一致，谁负责发现并修正？
- 回滚是不是可重复？

这些问题，以前小李不一定会在第一时间想到。但处理过多次 K8S 发布问题以后，他越来越觉得：
- 发布不是把镜像推上去那么简单。
- 发布本身，也是一套需要被设计、审计和持续维护的系统。

在小李完成的那个工程改造以后，他的技能树上又长出了一个新的分支。当然，改造过程并不总是顺利，因为新的工具会带来新的挑战，而且后续的其他工程的改造也会碰到更多的问题。

至于小李会踩什么样的坑，且看后续的故事吧！

----- English
# Automation and CI/CD: Mike's Journey Toward GitOps

## Background

Mike clearly remembers the onboarding training he attended when he joined as an SRE. One section explicitly emphasized the importance of automation in daily SRE work. The goal was to turn processes that are error-prone or too dependent on human memory into stable automated mechanisms, so that teams could:
- Reduce repetitive work and improve efficiency
- Lower the chance of human error and improve system stability

At the time, Mike thought automation was simple: write some bash scripts and trigger them with scheduled jobs. After several years of work, he realized that his understanding back then was still quite shallow. Bash scripts plus scheduled tasks are certainly one form of automation, but in daily work, automation appears almost everywhere.

Release automation, or CI/CD, is a particularly typical example. What is interesting is that Continuous Integration (CI) and Continuous Deployment (CD), as automated release processes, have also kept evolving as tools. Next, let's follow Mike's own experience and see how this CI/CD release automation process evolved step by step.

Mike started working in 2005, and over the years he happened to witness the evolution of mainstream CI/CD tools:

```text
# Stage 1:
Approach: manually run build.xml or ant.xml to generate executable files

# Stage 2: pipelines live in Jenkins
Approach: GitHub + Jenkins

# Stage 3: pipelines live in the code repository
Approach: GitLab CI/CD

# Stage 4: pipelines only handle builds, deployment is handled by GitOps tools
Approach: GitHub Actions + FluxCD
```

The tools kept changing, but Mike gradually realized that the real change was not the tool names. It was the automation mindset behind release automation.

## 1. Stage 1: Manually Running build.xml or ant.xml

When Mike first started working, the most common release process was to log in to a server, pull code with Git, then use Ant to run targets in `build.xml` or `ant.xml` and generate executable files.

At that stage, automation mostly lived inside `build.xml`. Compilation and packaging had some rules, but the release process itself was still stitched together by people:
- If the build failed, someone had to check it.
- If tests failed, someone had to investigate.
- After the build succeeded, someone still had to copy files to the release directory.
- Finally, someone had to manually restart the service.

Mike vaguely remembers watching the build process print logs across the screen and feeling as if he were watching a scene from *The Matrix*. It looked so advanced at the time.

## 2. Stage 2: GitHub + Jenkins, Running Manual Release Scripts Automatically

Characteristics:
- Code was stored in GitHub.
- Jenkins pulled the code, built artifacts, and executed deployment scripts.

Mike still remembers the first time he saw Jenkins jobs. They looked impressive: colorful tasks, progress bars, green successes, red failures. New tasks kept being added automatically, and it all looked very professional.

After the initial excitement faded, Mike realized that mastering Jenkins was not easy. Jenkins configuration relied heavily on UI operations, and each job's configuration was scattered across different pages. To understand the full release flow, he had to jump back and forth between Jenkins pages many times.

Even worse, if he needed to change a release flow, he had to click carefully through the UI, afraid of accidentally changing the wrong step.

Compared with the first stage, Jenkins changed the process into this:
- Click Build, or let the job run based on a configured trigger.
- The Jenkins job automatically pulls code.
- It automatically runs shell scripts.
- It automatically builds the release version.
- It automatically deploys to the environment.

For Mike at the time, this was already a clear improvement. It solved at least one problem: people no longer had to type the same commands by hand every time.

Later, after Mike learned more about containers, Jenkins jobs started to include many Docker-related commands:

```bash
docker build ...
docker push ...
docker run ...
```

As K8S became mainstream, Jenkins jobs naturally added more cluster-related actions:

```bash
helm upgrade ...
kubectl apply ...
kubectl rollout status ...
```

At first glance, release automation seemed to be in place. But after using it for a while, Mike started to notice some problems:
- A lot of release logic was hidden inside Jenkins jobs.
- Some scripts were written in Jenkins pages, while others lived in directories on servers.
- It was not always easy to trace who had changed the release logic.
- Different environments relied on parameters, which could become messy over time.
- Jenkins often held broad permissions: it could build, deploy, and operate the cluster.

More painfully, whenever a release had a problem, Mike often had to jump between several places:
- GitHub for code
- Jenkins for pipeline logs
- The image registry for tags
- The K8S cluster for Deployments

The problems varied:
- Sometimes the pipeline showed success, but the online Pods did not start.
- Sometimes the image had been pushed, but the Deployment was still using an old tag.
- Sometimes the wrong Jenkins job parameter was used, and the release went to the wrong environment.

Mike gradually realized that Jenkins automated the execution of manual steps, but the release logic itself was still not fully clear, auditable, or replayable.

In one sentence:

```text
Jenkins solved the problem of automatic execution, but it did not fully solve the problem of release transparency.
```

## 3. Stage 3: GitLab CI/CD, Pipelines Move Into the Code Repository

Later, Mike came into contact with GitLab CI/CD.

The first time he saw `.gitlab-ci.yml`, he found the idea very intuitive. One file could define the whole process:
- Pipeline configuration also lives in the code repository.
- Build, test, and deployment steps can be reviewed together with the code.
- If someone changes the release process, Git can show it.
- There is no need to log in to Jenkins pages; the pipeline configuration is visible directly in the Git repository.

Compared with Jenkins configurations scattered across UI pages, `.gitlab-ci.yml` made CI/CD feel more like part of the code: what you see is what you get.

A simplified pipeline might look like this:

```yaml
stages:
  - test
  - build
  - deploy

test:
  stage: test
  script:
    - npm test

build:
  stage: build
  script:
    - docker build -t registry.example.com/order-api:$CI_COMMIT_SHA .
    - docker push registry.example.com/order-api:$CI_COMMIT_SHA

deploy:
  stage: deploy
  script:
    - helm package ./charts/order-api
    - helm upgrade order-api ./charts/order-api \
        -n production \
        --set image.tag=$CI_COMMIT_SHA
```

This was much clearer than before:
- The pipeline has three stages and runs in the order defined by `stages`: test first, then build, then deploy.
- Each stage has a clear responsibility.
- If any stage fails, the whole build process stops.

Mike could at least see all the build information in the code commit or Merge Request. This made the release process easier to review and easier to turn into reusable team experience.

But after using it for some time, Mike noticed that although GitLab CI/CD made pipeline configuration more transparent, the CD part still had one key characteristic: the pipeline still directly used kubeconfig to modify the cluster.

In other words, the CI/CD system did not only build images. It also directly performed changes against the K8S cluster. This could certainly work, but the execution location had merely moved from Jenkins to a GitLab runner. Mike still felt that something was a little off:
- The CI/CD system needed write permissions to the cluster.
- If a release failed, the real cluster state might not match the configuration in the Git repository.
- Even if a release succeeded, someone still had to separately verify whether the service was really running correctly.
- If someone temporarily ran `kubectl patch` against production resources, Git might not reflect that change.
- During rollback, the team had to look at Git, pipeline history, and the current cluster state at the same time.

Mike slowly realized that one question still had not been fully answered:

```text
What should the online cluster look like, and where should that decision live?
```

In other words, who has the final say?

- The last pipeline execution result?
- The YAML in the Git repository?
- The Helm values?
- Or the current state returned by `kubectl get`?

When releases went smoothly, this problem was not obvious. But once something went wrong, the team had to check many places and still could not quickly identify the root cause.

That said, GitLab CI/CD still had many strengths. At the very least, it moved pipeline configuration into the code repository, making the release process more transparent. For a long time, Mike kept polishing his pipelines to make them more efficient and more automated. He also integrated more SRE tools into the process, and many configurations could be reused. It was still very convenient to use.

## 4. Stage 4: GitHub Actions + FluxCD, CI and CD Start to Separate

Last year, Mike encountered another combination: GitHub Actions + FluxCD.

At first, he thought this was just another tool change:
- Jenkins can run pipelines.
- GitLab CI/CD can run pipelines.
- GitHub Actions can also run pipelines.

It did not look fundamentally different.

But after learning, practicing, and completing the migration of one project, Mike's understanding changed a lot. What really impressed him was FluxCD's role: it pulled CD out as a separate responsibility. From then on, CI no longer directly used kubeconfig to modify the cluster.

In this model, the responsibilities are different:
- GitHub Actions handles CI.
- FluxCD handles CD.

More specifically:

```text
GitHub Actions:
- Runs tests
- Builds images
- Pushes images
- Updates image tags / Helm values / Kustomize configuration in Git

FluxCD:
- Runs inside the K8S cluster
- Continuously watches the Git repository
- Detects desired-state changes in Git
- Aligns the real cluster state with the state declared in Git
```

The release flow becomes:
- Code is merged in GitHub.
- GitHub Actions builds the image.
- GitHub Actions updates the deployment declaration in Git.
- FluxCD sees the Git change.
- FluxCD completes the sync inside the cluster.

At this point, Mike wanted to emphasize the key difference again. Compared with the previous model:
- The cluster is no longer changed by an external pipeline pushing changes into it.
- The cluster is changed by an internal controller pulling the desired state from Git.
- The desired state in Git can come from many kinds of changes: a code PR, an image version updated by CI, or a Helm chart / values configuration updated by CI.

The first two points are already useful, but Mike was most satisfied with the third one:

```text
Previously, the pipeline pushed changes into the cluster.
Now, a controller inside the cluster watches Git, checks whether the desired state has changed, and pulls the required changes back into the cluster.
```

Mike felt this change was important. Once Git becomes the source of desired state, many things become clearer:

```text
Who changed the release configuration?
Git did. Check the Git commit.

Why did production become this version?
Still Git. Check the Git history.

Which version should we roll back to?
Git again. Roll back Git.

What if the cluster state and Git do not match?
Let the controller keep reconciling until they match.
```

At this point, Mike finally started to understand the value of GitOps. GitOps is not just switching to another CD tool. It moves the center of release automation from "what command did the pipeline run?" to "what state did Git declare?"

## 5. Mike's Summary

After this review, Mike gained another layer of understanding about SRE automation.

- Automation is not just writing a script.
- Good automation should make the process more stable and make problems easier to trace.

For CI/CD, Mike felt several questions were especially important:
- Where does the release logic live?
- Who can change it?
- Is the change reviewed?
- After release, does the real cluster state match the desired state in Git?
- If not, who discovers and fixes the drift?
- Is rollback repeatable?

These were not questions Mike would always think of immediately in the past. But after handling many K8S release problems, he increasingly felt:
- Releasing is not as simple as pushing an image.
- The release process itself is also a system that needs design, auditing, and continuous maintenance.

After Mike completed that project migration, a new branch grew on his skill tree.

Of course, the migration process was not always smooth. New tools bring new challenges, and future migrations for other projects will certainly bring more problems.

As for what kind of pitfalls Mike will run into next, that will be a story for another day.
