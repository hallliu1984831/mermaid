----- Chinese
# 🌐 CNI插件：K8S大学的"网络运营商"

## 前言：没有网络，再好的宿舍也是孤岛
大家好！今天我们来聊聊CNI插件这个"幕后英雄"。你可能天天用kubectl，天天看Pod，但你想过没有：这些Pod是怎么互相聊天的？外面的流量是怎么进来的？

想象一下，如果K8S大学里的宿舍楼都没有网络：
- 🏠 宿舍建得再漂亮，学生们也无法互相联系
- 📱 WiFi连不上，外卖叫不了，快递收不到
- 🎮 游戏打不了，视频看不了，作业交不了

这就是没有CNI插件的K8s集群 - 一堆"数字孤岛"！

## 1️⃣ CNI插件是什么？K8S大学的"网络运营商"

### CNI：Container Network Interface（容器网络接口）
就像你家里需要选择宽带运营商一样，K8S集群也需要选择CNI插件来提供网络服务：
- 网络覆盖：给每个宿舍（Pod）提供网络连接
- IP分配：为每个学生分配唯一的网络地址
- 数据传输：确保消息能在宿舍间正确传递
- 服务质量：提供不同等级的网络服务

💡 关键理解：你需要在多个运营商中选择一个最适合你需求的。每个CNI插件都有自己的特色和优势，就像不同运营商有不同的套餐和服务质量。

### 工作原理
还记得K8S大学的设施管理员kubelet么？故事从它这里开始：
```bash
# 第1步：Pod创建时
kubelet: "嘿，CNI插件，给这个新Pod分配个网络！"
CNI插件: "收到！正在分配IP和设置网络..."

# 第2步：网络配置
CNI插件: "IP分配完毕：10.244.1.100"
CNI插件: "路由表已更新，网络接口已配置"

# 第3步：Pod删除时
kubelet: "这个Pod要删了，清理网络资源"
CNI插件: "明白！正在回收IP和清理路由..."
```

## 2️⃣ 集群中如何检查CNI组件：网络工程师的"体检报告" 🔍

### 基础健康检查：CNI插件还活着吗？
```bash
# 1. 查看CNI相关Pod状态
kubectl get pods -n kube-system | grep -E "(flannel|calico|cilium|weave|canal)"

# 正常输出示例（以Calico为例）：
NAME                                      READY   STATUS    RESTARTS        AGE
calico-kube-controllers-7bb4b4d4d-6w29j   1/1     Running   1 (3m50s ago)   37h
canal-ck4gg                               2/2     Running   2 (3m50s ago)   37h
# - calico-kube-controllers: Calico的"大脑"，负责策略管理和全局协调
# - canal-xxx: Canal是"执行器"，在每个节点上实际执行网络配置（DaemonSet）
#   Canal = Calico（策略功能）+ Flannel（网络实现）的组合

# 2. 检查CNI插件详细信息
kubectl describe pod -n kube-system calico-kube-controllers-7bb4b4d4d-6w29j
kubectl describe pod -n kube-system canal-ck4gg

# 3. 查看CNI配置文件
ls -la /etc/cni/net.d/
cat /etc/cni/net.d/10-canal.conflist  # Canal配置示例
```

### 深度诊断：查看CNI插件日志
```bash
# 1. 查看Calico控制器日志
kubectl logs -n kube-system calico-kube-controllers-7bb4b4d4d-6w29j -f

# 2. 查看Canal Pod日志
# 先检查Canal Pod的容器结构：
kubectl get pod -n kube-system canal-ck4gg -o jsonpath='{.spec.containers[*].name}'
# 输出示例：可能是 "calico-node" 或 "canal" 等

# 查看Canal Pod日志（根据实际容器名称）
kubectl logs -n kube-system canal-ck4gg -f
# 如果显示多个容器错误，则需要指定容器名：
# kubectl logs -n kube-system canal-ck4gg -c calico-node -f

# 查看容器详细信息：
kubectl describe pod -n kube-system canal-ck4gg | grep -A 10 "Containers:"

# 3. 查看历史日志（最近100行）
kubectl logs -n kube-system calico-kube-controllers-7bb4b4d4d-6w29j --tail=100

# 4. 查看所有Calico相关Pod日志
kubectl logs -n kube-system -l k8s-app=calico-kube-controllers --tail=50
kubectl logs -n kube-system -l k8s-app=canal --tail=50
```

### 典型日志内容解读：
```bash
✅ 正常工作的日志（Calico控制器示例）：
# Calico控制器正常启动日志
2024-01-20 10:30:15.123 [INFO][1] main.go 123: Starting Calico kube-controllers version v3.26.1
2024-01-20 10:30:15.234 [INFO][1] main.go 145: Loaded configuration from environment config=&config.Config{...}
2024-01-20 10:30:15.345 [INFO][1] main.go 167: Ensuring Calico datastore is initialized
2024-01-20 10:30:15.456 [INFO][1] client.go 234: Initializing CalicoClient
2024-01-20 10:30:15.567 [INFO][1] controllers.go 89: Starting policy controller
2024-01-20 10:30:15.678 [INFO][1] controllers.go 123: Policy controller is now in sync
# Canal Pod正常日志（calico-node容器）：
2024-01-20 10:30:16.123 [INFO][1] startup/startup.go 456: Early log level set to info
2024-01-20 10:30:16.234 [INFO][1] startup/startup.go 478: Using NODENAME environment for node name: controlplane
2024-01-20 10:30:16.345 [INFO][1] startup/startup.go 567: Determined node IP: 192.168.1.100
2024-01-20 10:30:16.456 [INFO][1] startup/startup.go 678: Node IPv4 changed, will check for conflicts
2024-01-20 10:30:16.567 [INFO][1] startup/startup.go 789: Calico node started successfully

❌ 有问题的日志示例：
# API Server连接失败
2024-01-20 10:30:15.123 [ERROR][1] client.go 234: Failed to create Calico client: Get "https://10.96.0.1:443/api/v1": dial tcp 10.96.0.1:443: connect: connection refused

# 节点网络配置问题
2024-01-20 10:30:16.234 [ERROR][1] startup.go 456: Failed to auto-detect an IPv4 address: no valid IPv4 addresses found on the host interfaces

# IPAM分配失败
2024-01-20 10:30:17.345 [ERROR][1] ipam.go 123: Failed to allocate IP address: IPAM block affinity changed
```

### 网络接口检查：CNI创建的"网络管道"

# 1. 查看节点网络接口（Calico/Canal环境）
```bash
ip addr show: IP地址解析
1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN group default qlen 1000
# ↑ 本地回环接口，所有系统都有，用于本机内部通信
    inet 127.0.0.1/8 scope host lo
    ...

2: enp1s0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc fq_codel state UP group default qlen 1000
# ↑ 节点主网卡，连接外部网络，IP: 172.30.1.2/24
    inet 172.30.1.2/24 brd 172.30.1.255 scope global dynamic noprefixroute enp1s0
    ...

3: docker0: <NO-CARRIER,BROADCAST,MULTICAST,UP> mtu 1454 qdisc noqueue state DOWN group default
# ↑ Docker网桥，状态DOWN说明K8s环境中不使用Docker网络，这是正常的
    inet 172.17.0.1/16 brd 172.17.255.255 scope global docker0
    ...

4: flannel.1: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1450 qdisc noqueue state UNKNOWN group default
# ↑ Flannel VXLAN隧道接口，用于跨节点Pod通信，IP: 192.168.0.0/32
    inet 192.168.0.0/32 brd 192.168.0.0 scope global flannel.1
    ...

7: cali61f99eae10e@if3: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc noqueue state UP group default
# ↑ Pod1的Calico接口 (Pod IP: 192.168.0.2) - 每个Pod都有唯一IP用于通信
    link-netns cni-842152e1-c862-1447-5370-39a4c62c7ae9
    ...

8: cali6dac6e169cb@if3: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc noqueue state UP group default
# ↑ Pod2的Calico接口 (Pod IP: 192.168.0.3) - 另一个Pod的独立IP
    link-netns cni-12d50b99-d658-eb60-0e74-32229c0e8782
    ...

9: calic45561273ca@if3: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc noqueue state UP group default
# ↑ Pod3的Calico接口 (Pod IP: 192.168.0.4) - 第三个Pod的独立IP
    link-netns cni-d4a8391a-1a8a-a19a-5d51-8ce7ad38a87d
    ...

10: cali0c6ec79a9d0@if3: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc noqueue state UP group default
# ↑ Pod4的Calico接口 (Pod IP: 192.168.0.5) - 第四个Pod的独立IP
    link-netns cni-84901d58-f898-6701-276e-d6c8c55afc27
    ...
```
💡 关键点：每个Pod都有一个唯一的IP地址（类似每个学生有独立的宿舍门牌号），用于集群内通信
- Pod可以直接通过IP互相访问：192.168.0.2 ↔ 192.168.0.3
- 这些IP是集群内部IP，外部无法直接访问
- mtu 1500表示最大传输单元为1500字节，这是以太网的标准值


# 2. 查看路由表
```bash
ip route show:路由表解析

default via 172.30.1.1 dev enp1s0 proto dhcp src 172.30.1.2 metric 1002 mtu 1500
# ↑ 默认路由，所有外部流量通过主网卡enp1s0出去

172.17.0.0/16 dev docker0 proto kernel scope link src 172.17.0.1 linkdown
# ↑ Docker网络路由，linkdown表示未激活（K8s环境正常）

172.30.1.0/24 dev enp1s0 proto dhcp scope link src 172.30.1.2 metric 1002 mtu 1500
# ↑ 本地网段路由，同网段通信直接通过主网卡

192.168.0.2 dev cali61f99eae10e scope link
192.168.0.3 dev cali6dac6e169cb scope link
192.168.0.4 dev calic45561273ca scope link
192.168.0.5 dev cali0c6ec79a9d0 scope link
# ↑ Pod IP路由：每个Pod都有一条点对点路由到对应的cali接口
# 这是Calico的特色：直接路由，无需网桥转发，性能更好
```

# 3. 查看Calico特有的网络接口
```bash
ip link show | grep cali

# Calico接口命名规则解析：
7: cali61f99eae10e@if3: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc noqueue state UP mode DEFAULT group default
# ↑ cali + 11位随机字符 + @if3（对应Pod内的eth0接口）
8: cali6dac6e169cb@if3: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc noqueue state UP mode DEFAULT group default
9: calic45561273ca@if3: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc noqueue state UP mode DEFAULT group default
10: cali0c6ec79a9d0@if3: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc noqueue state UP mode DEFAULT group default
# 每个接口都是UP状态，说明对应的Pod正在运行
```

# 4. 查看CNI网桥
```bash
brctl show  # 或者 ip link show type bridge

# 网桥状态解析：
bridge name     bridge id               STP enabled     interfaces
docker0         8000.22802df1db19       no
# ↑ 只有docker0网桥，没有接口连接（正常，因为K8s不使用Docker网络）
# 注意：Calico使用点对点路由，不需要传统的网桥，这是它的优势之一
```

### Pod网络连接检查：确认"宿舍网络"正常
```bash
# 1. 查看Pod的网络配置
kubectl exec -it <pod-name> -- ip addr show
# 应该看到eth0接口，每个Pod都有唯一IP在192.168.0.x网段

# 2. 测试Pod间网络连通性（Pod IP直接通信）
kubectl exec -it <pod1> -- ping <pod2-ip>
# 例如：kubectl exec -it test-pod -- ping 192.168.0.3
# 这证明了Pod之间可以通过IP直接通信，无需额外配置

# 3. 测试Pod到Service的连通性
kubectl exec -it <pod-name> -- nslookup kubernetes.default.svc.cluster.local
# 验证DNS解析和Service发现是否正常

# 4. 查看Pod的网络命名空间
kubectl exec -it <pod-name> -- cat /proc/net/route
# 查看Pod内部的路由表，默认路由应该指向网关

# 5. 验证Pod与外部网络连通性
kubectl exec -it <pod-name> -- ping 8.8.8.8
# 测试Pod是否能访问外部网络
```


### 系统级网络检查：底层"基础设施"状态
```bash
# 1. 检查iptables规则（CNI插件会创建相关规则）
iptables -t nat -L -n | grep -E "(KUBE|CNI)"
iptables -t filter -L -n | grep -E "(KUBE|CNI)"

# 2. 检查内核模块（某些CNI需要特定模块）
lsmod | grep -E "(vxlan|ipip|wireguard)"

# 3. 检查系统网络配置
sysctl net.bridge.bridge-nf-call-iptables
sysctl net.ipv4.ip_forward

# 这两个值应该都是1，否则CNI可能工作异常
```

## 3️⃣ 主流CNI插件大PK：网络运营商选择指南 📡

Flannel：新手友好的入门选择
✅ 配置简单：几行YAML搞定，适合K8s新手
✅ 稳定可靠：久经考验，生产环境放心用
✅ 资源占用低：不吃内存，小集群的最爱
❌ 功能有限：网络策略支持较弱
❌ 性能一般：大规模集群可能力不从心

适用场景：学习环境、小型集群、追求简单稳定

Calico：功能全面的企业级选择
✅ 性能优秀：纯三层网络，性能接近原生
✅ 安全强大：内置网络策略，安全防护到位
✅ 扩展性好：支持大规模集群（1000+节点）
✅ 功能丰富：BGP路由、IPAM、服务网格集成
❌ 配置复杂：功能多意味着配置项多
❌ 学习成本高：需要一定网络基础

适用场景：生产环境、大规模集群、对安全有要求

Cilium：新时代的技术先锋
✅ 技术先进：eBPF内核技术，性能爆表
✅ 可观测性强：网络流量可视化，故障排查利器
✅ 安全增强：API级别的安全策略
✅ 服务网格：内置Service Mesh功能
❌ 内核要求高：需要较新的Linux内核
❌ 复杂度高：功能强大但学习曲线陡峭

适用场景：云原生环境、微服务架构、追求极致性能

Weave Net：自动化的智能选择
✅ 零配置：自动发现节点，自动建立网络
✅ 加密通信：内置网络加密，安全性好
✅ 故障自愈：网络分区自动恢复
❌ 性能开销：加密和自动化带来性能损耗
❌ 调试困难：自动化程度高，出问题不好排查

适用场景：多云环境、网络不稳定场景、追求自动化


## 4️⃣ 常见问题排查：网络运营商故障处理 🔧

### 问题1：Pod无法互相通信
```bash
# 症状：ping不通其他Pod
kubectl exec -it pod1 -- ping <pod2-ip>

# 排查步骤
1. 检查CNI插件状态
kubectl get pods -n kube-system | grep -E "(flannel|calico|cilium|weave)"

2. 查看网络配置
kubectl get nodes -o wide
ip route show

3. 检查防火墙规则
iptables -L -n
```

### 问题2：外部无法访问Service
```bash
# 症状：Service创建了但访问不了
kubectl get svc

# 排查步骤  
1. 检查Service配置
kubectl describe svc <service-name>

2. 查看Endpoints
kubectl get endpoints <service-name>

3. 检查kube-proxy
kubectl get pods -n kube-system | grep kube-proxy
kubectl logs -n kube-system <kube-proxy-pod>
```

### 问题3：网络性能差
```bash
# 症状：网络延迟高，吞吐量低

# 性能测试
kubectl run test-pod --image=nicolaka/netshoot -it --rm
# 在Pod内执行
iperf3 -c <target-ip>

# 排查方向
1. CNI插件性能特性（Overlay vs Native）
2. 网络策略规则过多
3. 节点网络配置问题
```

## 🎯 总结
CNI插件就像K8S大学的"网络运营商"，虽然平时不显山不露水，但没有它，整个集群就是一盘散沙！选对了CNI插件，你的K8s集群就有了"网络基础设施"，Pod们可以愉快地通信，Service可以正常工作，你也可以安心下班！

----- English

# 🌐 CNI Plugins: The "Network Providers" of K8s University

## Introduction: Without Networking, Even the Best Dorms Are Islands

Hey there, today we're diving into CNI plugins - the unsung heroes working behind the scenes. You might use kubectl every day and check on Pods constantly, but have you ever wondered: How do these Pods actually talk to each other? How does external traffic get in?

Picture this: What if the dorm buildings at K8s University had zero network connectivity:
- 🏠 No matter how fancy the dorms, students couldn't reach each other
- 📱 No WiFi means no food delivery, no package pickup
- 🎮 No gaming, no streaming, no homework submissions

That's exactly what a K8s cluster without CNI plugins looks like - a bunch of "digital islands"!

## 1️⃣ What Are CNI Plugins? The "Network Providers" of K8s University

### CNI: Container Network Interface
Just like you need to choose an internet service provider for your home, K8s clusters need to pick a CNI plugin for network services:
- Network coverage: Connecting every dorm room (Pod) to the network
- IP allocation: Assigning unique network addresses to each student
- Data transmission: Ensuring messages get delivered between rooms correctly
- Service quality: Providing different tiers of network service

💡 Key insight: You need to choose from multiple providers to find the one that best fits your needs. Each CNI plugin has its own strengths and features, just like different ISPs offer different packages and service quality.

### How It Works
Let's say kubelet, just like the facilities manager at K8s University, kicks off the story:
```bash
# Step 1: When a Pod gets created
kubelet: "Hey CNI plugin, set up networking for this new Pod!"
CNI plugin: "Got it! Allocating IP and configuring network..."

# Step 2: Network configuration
CNI plugin: "IP assigned: 10.244.1.100"
CNI plugin: "Routing table updated, network interface configured"

# Step 3: When Pod gets deleted
kubelet: "This Pod's gotta go, clean up the network resources"
CNI plugin: "Roger that! Reclaiming IP and cleaning up routes..."
```

## 2️⃣ How to Check CNI Components in Your Cluster: Network Engineer's "Health Report" 🔍

### Basic Health Check: Is the CNI Plugin Still Alive?
```bash
# 1. Check CNI-related Pod status
kubectl get pods -n kube-system | grep -E "(flannel|calico|cilium|weave|canal)"

# Normal output example (using Calico):
NAME                                      READY   STATUS    RESTARTS        AGE
calico-kube-controllers-7bb4b4d4d-6w29j   1/1     Running   1 (3m50s ago)   37h
canal-ck4gg                               2/2     Running   2 (3m50s ago)   37h
# - calico-kube-controllers: Calico's "brain", handles policy management and global coordination
# - canal-xxx: Canal is the "executor", actually implements network config on each node (DaemonSet)
#   Canal = Calico (policy features) + Flannel (network implementation) combo

# 2. Check CNI plugin details
kubectl describe pod -n kube-system calico-kube-controllers-7bb4b4d4d-6w29j
kubectl describe pod -n kube-system canal-ck4gg

# 3. Check CNI configuration files
ls -la /etc/cni/net.d/
cat /etc/cni/net.d/10-canal.conflist  # Canal config example
```

### Deep Dive Diagnostics: Check CNI Plugin Logs
```bash
# 1. Check Calico controller logs
kubectl logs -n kube-system calico-kube-controllers-7bb4b4d4d-6w29j -f

# 2. Check Canal Pod logs
# First check Canal Pod container structure:
kubectl get pod -n kube-system canal-ck4gg -o jsonpath='{.spec.containers[*].name}'
# Example output: might be "calico-node" or "canal" etc.

# View Canal Pod logs (based on actual container name)
kubectl logs -n kube-system canal-ck4gg -f
# If you get multiple container errors, specify container name:
# kubectl logs -n kube-system canal-ck4gg -c calico-node -f

# Check container details:
kubectl describe pod -n kube-system canal-ck4gg | grep -A 10 "Containers:"

# 3. Check recent logs (last 100 lines)
kubectl logs -n kube-system calico-kube-controllers-7bb4b4d4d-6w29j --tail=100

# 4. Check all Calico-related Pod logs
kubectl logs -n kube-system -l k8s-app=calico-kube-controllers --tail=50
kubectl logs -n kube-system -l k8s-app=canal --tail=50
```

### Typical Log Content Breakdown:
```bash
✅ Normal working logs (Calico controller example):
# Calico controller normal startup logs
2024-01-20 10:30:15.123 [INFO][1] main.go 123: Starting Calico kube-controllers version v3.26.1
2024-01-20 10:30:15.234 [INFO][1] main.go 145: Loaded configuration from environment config=&config.Config{...}
2024-01-20 10:30:15.345 [INFO][1] main.go 167: Ensuring Calico datastore is initialized
2024-01-20 10:30:15.456 [INFO][1] client.go 234: Initializing CalicoClient
2024-01-20 10:30:15.567 [INFO][1] controllers.go 89: Starting policy controller
2024-01-20 10:30:15.678 [INFO][1] controllers.go 123: Policy controller is now in sync
# Canal Pod normal logs (calico-node container):
2024-01-20 10:30:16.123 [INFO][1] startup/startup.go 456: Early log level set to info
2024-01-20 10:30:16.234 [INFO][1] startup/startup.go 478: Using NODENAME environment for node name: controlplane
2024-01-20 10:30:16.345 [INFO][1] startup/startup.go 567: Determined node IP: 192.168.1.100
2024-01-20 10:30:16.456 [INFO][1] startup/startup.go 678: Node IPv4 changed, will check for conflicts
2024-01-20 10:30:16.567 [INFO][1] startup/startup.go 789: Calico node started successfully

❌ Problematic log examples:
# API Server connection failure
2024-01-20 10:30:15.123 [ERROR][1] client.go 234: Failed to create Calico client: Get "https://10.96.0.1:443/api/v1": dial tcp 10.96.0.1:443: connect: connection refused

# Node network configuration issues
2024-01-20 10:30:16.234 [ERROR][1] startup.go 456: Failed to auto-detect an IPv4 address: no valid IPv4 addresses found on the host interfaces

# IPAM allocation failure
2024-01-20 10:30:17.345 [ERROR][1] ipam.go 123: Failed to allocate IP address: IPAM block affinity changed
```

### Network Interface Check: CNI-Created "Network Pipes"

# 1. Check node network interfaces (Calico/Canal environment)
```bash
ip addr show: IP address breakdown

1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN group default qlen 1000
# ↑ Local loopback interface, every system has this for internal communication
    inet 127.0.0.1/8 scope host lo
    ...

2: enp1s0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc fq_codel state UP group default qlen 1000
# ↑ Node's main network card, connects to external network, IP: 172.30.1.2/24
    inet 172.30.1.2/24 brd 172.30.1.255 scope global dynamic noprefixroute enp1s0
    ...

3: docker0: <NO-CARRIER,BROADCAST,MULTICAST,UP> mtu 1454 qdisc noqueue state DOWN group default
# ↑ Docker bridge, DOWN state means K8s environment doesn't use Docker networking (this is normal)
    inet 172.17.0.1/16 brd 172.17.255.255 scope global docker0
    ...

4: flannel.1: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1450 qdisc noqueue state UNKNOWN group default
# ↑ Flannel VXLAN tunnel interface, used for cross-node Pod communication, IP: 192.168.0.0/32
    inet 192.168.0.0/32 brd 192.168.0.0 scope global flannel.1
    ...

7: cali61f99eae10e@if3: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc noqueue state UP group default
# ↑ Pod1's Calico interface (Pod IP: 192.168.0.2) - each Pod gets unique IP for communication
    link-netns cni-842152e1-c862-1447-5370-39a4c62c7ae9
    ...

8: cali6dac6e169cb@if3: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc noqueue state UP group default
# ↑ Pod2's Calico interface (Pod IP: 192.168.0.3) - another Pod's independent IP
    link-netns cni-12d50b99-d658-eb60-0e74-32229c0e8782
    ...

9: calic45561273ca@if3: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc noqueue state UP group default
# ↑ Pod3's Calico interface (Pod IP: 192.168.0.4) - third Pod's independent IP
    link-netns cni-d4a8391a-1a8a-a19a-5d51-8ce7ad38a87d
    ...

10: cali0c6ec79a9d0@if3: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc noqueue state UP group default
# ↑ Pod4's Calico interface (Pod IP: 192.168.0.5) - fourth Pod's independent IP
    link-netns cni-84901d58-f898-6701-276e-d6c8c55afc27
    ...
```
💡 Key point: Each Pod gets a unique IP address (like each student having their own dorm room number) for cluster-internal communication
- Pods can directly access each other via IP: 192.168.0.2 ↔ 192.168.0.3
- These are cluster-internal IPs, not accessible from outside
- mtu 1500 indicates Maximum Transmission Unit of 1500 bytes, which is the Ethernet standard


# 2. Check routing table
```bash
ip route show: routing table breakdown

default via 172.30.1.1 dev enp1s0 proto dhcp src 172.30.1.2 metric 1002 mtu 1500
# ↑ Default route, all external traffic goes out through main network card enp1s0

172.17.0.0/16 dev docker0 proto kernel scope link src 172.17.0.1 linkdown
# ↑ Docker network route, linkdown means inactive (normal in K8s environment)

172.30.1.0/24 dev enp1s0 proto dhcp scope link src 172.30.1.2 metric 1002 mtu 1500
# ↑ Local network segment route, same-segment communication goes directly through main network card

192.168.0.2 dev cali61f99eae10e scope link
192.168.0.3 dev cali6dac6e169cb scope link
192.168.0.4 dev calic45561273ca scope link
192.168.0.5 dev cali0c6ec79a9d0 scope link
# ↑ Pod IP routes: each Pod has a point-to-point route to its corresponding cali interface
# This is Calico's specialty: direct routing, no bridge forwarding needed, better performance
```

# 3. Check Calico-specific network interfaces
```bash
ip link show | grep cali

# Calico interface naming rules breakdown:
7: cali61f99eae10e@if3: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc noqueue state UP mode DEFAULT group default
# ↑ cali + 11 random characters + @if3 (corresponds to eth0 interface inside Pod)
8: cali6dac6e169cb@if3: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc noqueue state UP mode DEFAULT group default
9: calic45561273ca@if3: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc noqueue state UP mode DEFAULT group default
10: cali0c6ec79a9d0@if3: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc noqueue state UP mode DEFAULT group default
# Each interface is in UP state, indicating the corresponding Pod is running
```

# 4. Check CNI bridges
```bash
brctl show  # or ip link show type bridge

# Bridge status breakdown:
bridge name     bridge id               STP enabled     interfaces
docker0         8000.22802df1db19       no
# ↑ Only docker0 bridge, no connected interfaces (normal, because K8s doesn't use Docker networking)
# Note: Calico uses point-to-point routing, doesn't need traditional bridges - that's one of its advantages
```

### Pod Network Connection Check: Making Sure "Dorm Networking" Works
```bash
# 1. Check Pod network configuration
kubectl exec -it <pod-name> -- ip addr show
# Should see eth0 interface, each Pod has unique IP in 192.168.0.x range

# 2. Test Pod-to-Pod network connectivity (direct Pod IP communication)
kubectl exec -it <pod1> -- ping <pod2-ip>
# Example: kubectl exec -it test-pod -- ping 192.168.0.3
# This proves Pods can communicate directly via IP without extra configuration

# 3. Test Pod-to-Service connectivity
kubectl exec -it <pod-name> -- nslookup kubernetes.default.svc.cluster.local
# Verify DNS resolution and Service discovery work properly

# 4. Check Pod's network namespace
kubectl exec -it <pod-name> -- cat /proc/net/route
# Check Pod's internal routing table, default route should point to gateway

# 5. Verify Pod external network connectivity
kubectl exec -it <pod-name> -- ping 8.8.8.8
# Test if Pod can access external networks
```


### System-Level Network Check: Underlying "Infrastructure" Status
```bash
# 1. Check iptables rules (CNI plugins create related rules)
iptables -t nat -L -n | grep -E "(KUBE|CNI)"
iptables -t filter -L -n | grep -E "(KUBE|CNI)"

# 2. Check kernel modules (some CNIs need specific modules)
lsmod | grep -E "(vxlan|ipip|wireguard)"

# 3. Check system network configuration
sysctl net.bridge.bridge-nf-call-iptables
sysctl net.ipv4.ip_forward

# Both values should be 1, otherwise CNI might not work properly
```

## 3️⃣ Major CNI Plugin Showdown: Network Provider Selection Guide 📡

### 🏆 Flannel: Beginner-Friendly Entry Choice
✅ Simple configuration: Just a few lines of YAML, perfect for K8s newbies
✅ Rock solid: Battle-tested, production-ready reliability
✅ Low resource usage: Doesn't hog memory, perfect for small clusters
❌ Limited features: Weak network policy support
❌ Average performance: Might struggle with large-scale clusters

Use cases: Learning environments, small clusters, when you want simple and stable

### 🚀 Calico: Full-Featured Enterprise Choice
✅ Excellent performance: Pure Layer 3 networking, near-native performance
✅ Security powerhouse: Built-in network policies, solid security protection
✅ Great scalability: Supports large clusters (1000+ nodes)
✅ Feature-rich: BGP routing, IPAM, service mesh integration
❌ Complex configuration: More features mean more config options
❌ Steep learning curve: Requires some networking background

Use cases: Production environments, large clusters, security requirements

### ⚡ Cilium: Next-Gen Tech Pioneer
✅ Cutting-edge tech: eBPF kernel technology, mind-blowing performance
✅ Strong observability: Network traffic visualization, troubleshooting powerhouse
✅ Enhanced security: API-level security policies
✅ Service mesh: Built-in Service Mesh functionality
❌ High kernel requirements: Needs newer Linux kernels
❌ High complexity: Powerful but steep learning curve

Use cases: Cloud-native environments, microservice architectures, performance-focused

### 🔗 Weave Net: Smart Automation Choice
✅ Zero configuration: Auto-discovers nodes, auto-establishes network
✅ Encrypted communication: Built-in network encryption, great security
✅ Self-healing: Network partitions auto-recover
❌ Performance overhead: Encryption and automation come with performance costs
❌ Hard to debug: High automation makes troubleshooting tricky

Use cases: Multi-cloud environments, unstable network scenarios, automation-focused


## 4️⃣ Common Troubleshooting: Network Provider Issue Resolution 🔧

### Issue 1: Pods Can't Communicate with Each Other
```bash
# Symptom: Can't ping other Pods
kubectl exec -it pod1 -- ping <pod2-ip>

# Troubleshooting steps
1. Check CNI plugin status
kubectl get pods -n kube-system | grep -E "(flannel|calico|cilium|weave)"

2. Check network configuration
kubectl get nodes -o wide
ip route show

3. Check firewall rules
iptables -L -n
```

### Issue 2: External Access to Service Fails
```bash
# Symptom: Service created but can't access it
kubectl get svc

# Troubleshooting steps
1. Check Service configuration
kubectl describe svc <service-name>

2. Check Endpoints
kubectl get endpoints <service-name>

3. Check kube-proxy
kubectl get pods -n kube-system | grep kube-proxy
kubectl logs -n kube-system <kube-proxy-pod>
```

### Issue 3: Poor Network Performance
```bash
# Symptom: High network latency, low throughput

# Performance testing
kubectl run test-pod --image=nicolaka/netshoot -it --rm
# Execute inside Pod
iperf3 -c <target-ip>

# Investigation directions
1. CNI plugin performance characteristics (Overlay vs Native)
2. Too many network policy rules
3. Node network configuration issues
```

## 🎯 Summary
CNI plugins are like the "network providers" of K8s University - they might work behind the scenes, but without them, your whole cluster would be a scattered mess! Pick the right CNI plugin, and your K8s cluster gets solid "network infrastructure" - Pods can chat happily, Services work properly, and you can clock out with peace of mind!
