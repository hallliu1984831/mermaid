----- Chinese
# 小李的困惑：这个PromQL的查询语句对不上啊

## 故事背景：
某天下午快下班的时候，小李收到了一个来自产品团队的需求：
- 新加一个Grafana的dashboard，展示虚拟机磁盘使用量。
- 显示的虚拟机需要通过 “数据中心集群” 这个条件来过滤
小李心想：这不是指定一个指标就可以展示的数据表格吗？想着复杂度应该不高，于是小李痛快的给出了答复：尽快准备好提交！

## 撸起袖子开干
之后的一天，小李按照计划开始这个需求的实现，按照自己的理解，小李梳理了一遍实现过程：
1. 在 Prometheus 里面查找磁盘用量对应的指标，选取最合适展示磁盘用量的对象
2. 通过 Grafana 的变量功能，实现数据中心集群的筛选
3. 通过 Grafana 的table功能，展示磁盘使用量的数据表格
这一番罗列下来，发现整个实现过程确实不复杂，于是撸起袖子，信心满满地开始干活了。

## 2. 碰到个小问题
一番查找下来，小李找到的指标是disk_used指标，示例如下：
```
disk_used{device="vda1", fstype="xfs", host="DC01-VM-001:6379", host_alias="DC01-VM-001", mode="rw", path="/", DC="DC01"} 3000000000
....

```
咋一看，这个指标就是需要的磁盘使用量。但是小李发现，这个指标里并没有“数据中心集群”这个过滤条件，导致查询结果是全部的数据中心的磁盘使用量，但是产品同学的需求是：只显示过滤之后的磁盘使用量。
小李心想：这要是能在disk_used指标里面，新加一个集群的label，不就可以了吗？

## 3. 怎么去加这个集群的label呢
要给disk_used 这个指标加集群的label，得先找出来这个指标是如何定义的。顺着这条线索，小李开始逆向查找：
1. 这个指标没有job label，那就说明这个指标不是通过prometheus定义的job来定时poll数据的
2. 通过prometheus的target查看，确认没有对应的scrape job，进一步验证了数据并不是定时抓取来的
3. 既然数据不是取来的，那剩下的只有一个可能，那就是pushgateway push上来的数据了

查到这，小李心想：这就好办了，找到push这个数据的程序，然后在程序里面加一个集群的label，不就可以了吗？可是这个push 数据的程序在哪呢？Prometheus的大门面向整个数据中心开放，茫茫机海，去哪里找呢？

TIPS:
1. Prometheus 收集数据一般使用poll的方式，根据配置的job来定时poll数据
2. Prometheus 也支持pushgateway来接收push数据，pushgateway 是一个http服务，接收应用程序push的数据，然后由Prometheus定时从pushgateway poll数据

## 4. 去哪里找推送数据的程序呢
小李心想：我在工作群里问问，应该能得到有用的答复！正想着找同事去问，余光瞥见了如下内容：
```
host="DC01-VM-001:6379"
```
心想：这个6379的端口看着有点眼熟啊，好像在哪里见过？等等，这不就是telegraf的扫描端口么？想到这个，小李赶紧找文档验证了一下，果然是telegraf的采集端口，那这个指标就是telegraf采集上来的了。
有了这个线索，小李很快根据文档得出了结论：
1. telegraf是安装在数据中心所有VM 上的数据收集程序，根据配置来扫描所在VM 上的数据，并push到pushgateway中，进而保存到prometheus中
2. telegraf采集的数据，都会打上host的label，而这个host的label，就是telegraf所在机器的hostname
3. host 和 host_alias 都是telegraf采集上来的，但是telegraf采集的host带端口，而host_alias不带端口

找到了数据的来源，小李突然发现：数据中心这么多的VM，每台VM上都有一个telegraf，我总不能一台台的去改吧？那可怎么办呢？
TIPS:
1. telegraf 是当前主流的数据采集程序
2. telegraf 可以采集所在VM上的各种数据，如CPU、内存、磁盘、网络等数据

## 5. 到底能不能改telegraf的配置呢
进一步和同事沟通以后，小李得出了结论：修改telegraf的配置，新增一个label的方式不是最佳解决方案，原因如下：
1. telegraf的配置文件在每台VM上，是通过ansible分发的，想要修改，只能通过修改ansible的配置，然后分发到每台VM上，这个过程不是很快就可以完成的
2. 作为数据中心的VM，是不知道自己所处的集群的，这个信息不是telegraf采集得来的，需要我们人为的去设定，这个在ansible脚本里面可不好做啊
小李这下尴尬了😅，看来想直接使用disk_used这个指标来完成任务，有难度啊！

## 6. 检查集群指标
小李心想：既然telegraf采集的指标没有集群的label，那么哪些指标有这个集群的label呢？带着这个疑问，根据产品同学提供的集群名称指标"DC_CLST"，小李开始在prometheus里面查找。很快，小李就找到了DC_CLST这个指标，示例如下：
```
DC_CLST{cluster="DC_CLST_01", host="DC01-VM-001"} 1
```

看到这，事情变得清晰起来：
需要的展示指标：
disk_used{device="vda1", fstype="xfs", host="DC01-VM-001:6379", host_alias="DC01-VM-001", mode="rw", path="/", DC="DC01"} 30000000000

需要的过滤指标
DC_CLST{cluster="DC_CLST_01", host="DC01-VM-001"} 1
这两个指标都有host字段，可以做联合查询的条件，看起来任务就要完成了:
disk_used * on (host) DC_CLST{cluster="DC_CLST_01"}

等等，小李突然意识到这两个指标中的host对应的值居然不一样!一个是DC01-VM-001:6379，另一个是DC01-VM-001，真是一波未平一波又起，还是没搞定啊！

## 7. 继续想办法
小李心想：虽然两个指标的host字段值不一样，但是disk_used里的host_alias字段值和DC_CLST里的host字段值是一样的，那可不可以使用host_alias字段来作为关联条件呢？
经过一番检查，小李发现：在prometheus的查询语法中，使用on的关联语法的前提是两个指标的关联字段必须是同名的，而disk_used和DC_CLST的关联字段名却不一致，看来这条路也走不通啊！

又是一番思索，小李有了办法，最后采用的思路是：

1. 先处理 `disk_used`
2. 把其中的 `host_alias` 内容写入统一的 `host`，也就是覆盖掉原来的 `host`，去掉端口号
3. 再和 `DC_CLST` 用 `on(...)` 关联

他的核心判断是：
与其去拆 `host="DC01-VM-001:1234"`，不如直接使用已经存在的 `host_alias`。因为 `host_alias` 本来就是不带端口的干净值，风险更低，也更稳定。

这里最关键的动作，就是把 `disk_used` 里的 `host_alias` 复制成可用于 join 的 `host`。

```promql
label_replace((disk_used),"host","$1","host_alias","(.*)")
```

这个表达式的意思是：

- 从 `host_alias` 读取内容
- 用正则 `(.*)` 抓出来
- 再把抓到的结果写入新的 `host` label

处理完成后，两个指标终于可以对齐了，以下是最终的提交版本：
```
label_replace(disk_used, "host", "$1", "host_alias", "(.*)")
* on(host) 
DC_CLST{cluster="DC_CLST_01"}
```
手里的活也可以交差了。

TIPS: 
1. label_replace() 函数的使用方法：label_replace(v instant-vector, destination_label string, replacement string, source_label string, regex string)
2. on() 语法的使用方法：on(label_name [, label_name]),用于连接两个指标，要求两个指标中必须有同名的label，且值相等。如果没有同名的label，可以使用label_replace()函数来新加一个同名label。
3. 通过label关联的左右两边数据必须是一条，如果一方有多条需要过滤成一条，例如使用avg()函数来过滤成一条。
4. on() 的目的是通过后面的一个metric来执行数据的过滤

## 8. 小李的复盘

从 SRE 角度看，这个需求很小，但特别典型。它提醒我们几件事：
- 写查询之前，先看 label，不要急着上函数
- 能不能 `join`，本质取决于 label 是否可对齐
- 同名 label 不等于同义数据
- 如果已有标准字段，优先使用标准字段，不要重复做字符串拆解
- 监控系统的问题，很多不是“查不出来”，而是“数据建模不一致”

换句话说：
- 查询语言解决的是“怎么算”，
- label 设计解决的是“能不能算”。

## 9. 小结
这次需求本身不复杂，但它很像 SRE 日常里那些“看似只是写个查询，实际是在做数据对齐”的工作。PromQL 只是最后落笔的那一步。

----- English
# Mike's Confusion: These PromQL Queries Just Don't Match Up!

## Background

One afternoon, close to the end of the workday, Mike received a request from the product team:
- Add a new Grafana dashboard to display VM disk usage
- The VMs shown need to be filtered by "data center cluster" criteria

Mike thought: "Isn't this just specifying a metric to display a data table? Doesn't seem too complex." So Mike confidently replied: "I'll get this ready and submitted ASAP!"

## Rolling Up the Sleeves

The next day, Mike started implementing this requirement according to his plan. Based on his understanding, Mike outlined the implementation process:
1. Search for disk usage metrics in Prometheus and select the most suitable object for displaying disk usage
2. Use Grafana's variable functionality to implement data center cluster filtering
3. Use Grafana's table functionality to display the disk usage data table

After listing all this out, Mike found the entire implementation process was indeed not complex, so he rolled up his sleeves and started working with full confidence.

## 2. Running Into a Small Problem

After some searching, Mike found the disk_used metric, example as follows:
```
disk_used{device="vda1", fstype="xfs", host="DC01-VM-001:6379", host_alias="DC01-VM-001", mode="rw", path="/", DC="DC01"} 3000000000
....

```
At first glance, this metric was exactly the disk usage he needed. But Mike discovered that this metric didn't have the "data center cluster" filtering condition, causing the query results to show disk usage from all data centers. However, the product team's requirement was: only display filtered disk usage.

Mike thought: "If only I could add a cluster label to this disk_used metric, wouldn't that solve it?"

## 3. How to Add This Cluster Label?

To add a cluster label to the disk_used metric, Mike first needed to figure out how this metric was defined. Following this lead, Mike started reverse engineering:
1. This metric has no job label, meaning this metric isn't collected through Prometheus-defined jobs that poll data periodically
2. Checking Prometheus targets, he confirmed there was no corresponding scrape job, further verifying that the data wasn't collected through periodic scraping
3. Since the data wasn't being pulled, there was only one possibility left: this data was pushed through pushgateway

At this point, Mike thought: "This should be easy! Find the program that pushes this data, then add a cluster label in the program, right?" But where was this data-pushing program? Prometheus serves the entire data center - in this vast sea of machines, where would he even start looking?

TIPS:
1. Prometheus generally collects data using the poll method, periodically polling data according to configured jobs
2. Prometheus also supports pushgateway to receive pushed data. Pushgateway is an HTTP service that receives data pushed by applications, then Prometheus periodically polls data from pushgateway

## 4. Where to Find the Data-Pushing Program?

Mike thought: "I should ask in our work chat - that should get me some useful answers!" Just as he was about to ask colleagues, he caught sight of this content:
```
host="DC01-VM-001:6379"
```
He thought: "This 6379 port looks familiar... where have I seen it before? Wait, isn't this telegraf's scanning port?" Thinking of this, Mike quickly checked the documentation to verify, and indeed it was telegraf's collection port, so this metric was collected by telegraf.

With this clue, Mike quickly drew conclusions from the documentation:
1. Telegraf is a data collection program installed on all VMs in the data center. It scans data on the VM according to configuration and pushes it to pushgateway, which then saves it to Prometheus
2. Data collected by telegraf is tagged with a host label, and this host label is the hostname of the machine where telegraf is located
3. Both host and host_alias are collected by telegraf, but telegraf's collected host includes the port, while host_alias doesn't include the port

Having found the source of the data, Mike suddenly realized: "With so many VMs in the data center, each VM has a telegraf - I can't possibly modify them one by one, right? What should I do?"

TIPS:
1. Telegraf is a mainstream data collection program currently
2. Telegraf can collect various data from the VM it's on, such as CPU, memory, disk, network data, etc.

## 5. Can We Actually Modify Telegraf's Configuration?

After further communication with colleagues, Mike concluded that modifying telegraf's configuration to add a new label wasn't the best solution for the following reasons:
1. Telegraf's configuration files are on each VM and distributed through Ansible. To modify them, you'd have to modify Ansible's configuration and then distribute it to each VM - this process can't be completed quickly
2. As data center VMs, they don't know which cluster they belong to. This information isn't collected by telegraf and needs to be set manually, which is difficult to do in Ansible scripts

Mike felt awkward 😅. It seemed directly using the disk_used metric to complete this task would be challenging!

## 6. Checking Cluster Metrics

Mike thought: "Since metrics collected by telegraf don't have cluster labels, which metrics do have this cluster label?" With this question, based on the cluster name metric "DC_CLST" provided by the product team, Mike started searching in Prometheus. He quickly found the DC_CLST metric, example as follows:
```
DC_CLST{cluster="DC_CLST_01", host="DC01-VM-001"} 1
```

Seeing this, things became clear:
Needed display metric:
disk_used{device="vda1", fstype="xfs", host="DC01-VM-001:6379", host_alias="DC01-VM-001", mode="rw", path="/", DC="DC01"} 30000000000

Needed filter metric:
DC_CLST{cluster="DC_CLST_01", host="DC01-VM-001"} 1

Both metrics have host fields that can serve as join conditions. It looked like the task was about to be completed:
disk_used * on (host) DC_CLST{cluster="DC_CLST_01"}

Wait, Mike suddenly realized that the host values in these two metrics were actually different! One is DC01-VM-001:6379, the other is DC01-VM-001. Just when one problem was solved, another arose - still not resolved!

## 7. Continuing to Find Solutions

Mike thought: "Although the host field values in the two metrics are different, the host_alias field value in disk_used is the same as the host field value in DC_CLST. Could I use the host_alias field as the join condition?"

After some investigation, Mike discovered: in Prometheus query syntax, using the on join syntax requires that the related fields in both metrics must have the same name, but the related field names in disk_used and DC_CLST were inconsistent. This path seemed blocked too!

After more pondering, Mike came up with a solution. His final approach was:

1. First process `disk_used`
2. Copy the content from `host_alias` to a unified `host`, essentially overwriting the original `host` and removing the port number
3. Then join with `DC_CLST` using `on(...)`

His core reasoning was:
Rather than parsing `host="DC01-VM-001:1234"`, it's better to directly use the existing `host_alias`. Since `host_alias` is already a clean value without ports, it's lower risk and more stable.

The most crucial operation here is copying the `host_alias` from `disk_used` to create a `host` that can be used for joining.

```promql
label_replace((disk_used),"host","$1","host_alias","(.*)")
```

This expression means:

- Read content from `host_alias`
- Extract it using regex `(.*)`
- Write the extracted result to a new `host` label

After processing, the two metrics could finally be aligned. Here's the final submitted version:
```
label_replace(disk_used, "host", "$1", "host_alias", "(.*)")
* on(host)
DC_CLST{cluster="DC_CLST_01"}
```
The task could finally be completed.

TIPS:
1. Usage of label_replace() function: label_replace(v instant-vector, destination_label string, replacement string, source_label string, regex string)
2. Usage of on() syntax: on(label_name [, label_name]), used to join two metrics, requires both metrics to have same-name labels with equal values. If there are no same-name labels, you can use the label_replace() function to add a same-name label.
3. Data on both sides of label joins must be single records; if one side has multiple records, filter to single record, for example using the avg() function.
4. The purpose of on() is to use the latter metric to perform data filtering

## 8. Mike's Retrospective

From an SRE perspective, this requirement was small but particularly typical. It reminds us of several things:
- Before writing queries, look at labels first - don't rush to use functions
- Whether you can `join` fundamentally depends on whether labels can be aligned
- Same-name labels don't equal same-meaning data
- If standard fields already exist, prioritize using standard fields - don't repeat string parsing
- Many monitoring system problems aren't "can't query," but rather "inconsistent data modeling"

In other words:
- Query language solves "how to calculate"
- Label design solves "whether you can calculate"

## 9. Summary
This requirement itself wasn't complex, but it's very much like those SRE daily tasks that "seem like just writing a query, but are actually about data alignment." PromQL is just the final step of putting pen to paper.
