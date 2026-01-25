----- Chinese
# 💾 CSI (Container Storage Interface)：K8S大学的"专业存储工程师"

## 前言：没有存储专家，数据就无家可归

大家好！今天我们来聊聊CSI（Container Storage Interface）这个"专业存储工程师"。你可能天天用PV/PVC存储数据，但你想过没有：为什么一个YAML文件就能自动创建存储卷？为什么不同的存储系统都能无缝接入K8s？

想象一下，如果K8S大学里没有专业存储工程师：
- 📚 学生想要储物柜？抱歉，你得自己去买、自己安装、自己维护
- 💻 数据库需要持久化存储？你得手动配置每一个存储设备
- 🔄 想要备份数据？你得学会每种存储系统的专用工具

这就是没有CSI的K8s集群 - 一个"存储管理的噩梦"！

## 1️⃣ CSI是什么？K8S大学的"专业存储工程师"

### CSI：Container Storage Interface（容器存储接口）
就像大学里的专业存储工程师帮你管理各种储物设备一样，CSI把复杂的存储操作标准化，让不同的存储系统都能为K8s提供服务：

- 存储抽象：把各种存储系统统一成标准接口
- 动态供应：根据需求自动创建和删除存储卷
- 生命周期管理：从创建到删除的全程管理
- 跨平台支持：支持云存储、本地存储、网络存储等

💡 关键理解：CSI就像校园里的"万能存储管家"，你只需要说出存储需求，它就帮你搞定一切。

## 2️⃣ CSI的工作原理：存储工程师的"标准作业流程"

### CSI架构：三个专业角色的分工协作
```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│ K8s API Server  │    │   CSI Driver     │    │  Storage System │
│ (总务处)         │◄──►│  (存储工程师)      │◄──►│   (存储设备)    │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

### CSI Driver的三大组件
1. **Controller Plugin（存储调度员）**
   - 负责存储卷的创建、删除、扩容
   - 处理快照、克隆等高级功能
   - 运行在控制节点上，具体Deployment名称如：
     * `ebs-csi-controller`（AWS EBS CSI）
     * `csi-cephfs-controller`（Ceph FS CSI）
     * `csi-nfs-controller`（NFS CSI）
     * `azure-csi-controller`（Azure CSI）

2. **Node Plugin（现场工程师）**
   - 负责存储卷的挂载、卸载
   - 处理节点级别的存储操作
   - 运行在每个工作节点上，具体DaemonSet名称如：
     * `ebs-csi-node`（AWS EBS CSI）
     * `csi-cephfs-node`（Ceph FS CSI）
     * `csi-nfs-node`（NFS CSI）
     * `azure-csi-node`（Azure CSI）

3. **CSI Sidecar Containers（专业助手）**
   - external-provisioner：动态供应助手
   - external-attacher：挂载管理助手
   - external-resizer：扩容管理助手
   - external-snapshotter：快照管理助手

## 3️⃣ 集群中不存在CSI组件：本地存储就够了

如果你的K8s集群中没有任何CSI Driver，**这完全正常**！因为K8s内置支持本地存储：

### 🏠 无需CSI的本地存储方案

#### 直接使用hostPath
```yaml
apiVersion: v1
kind: Pod
metadata:
  name: app-pod
spec:
  containers:
  - name: app
    image: nginx
    volumeMounts:
    - name: data
      mountPath: /data
  volumes:
  - name: data
    hostPath:
      path: /opt/app-data
      type: DirectoryOrCreate
```

#### 使用emptyDir临时存储
```yaml
apiVersion: v1
kind: Pod
metadata:
  name: temp-pod
spec:
  containers:
  - name: app
    image: nginx
    volumeMounts:
    - name: temp-data
      mountPath: /tmp
  volumes:
  - name: temp-data
    emptyDir: {}
```

#### 手动创建本地PV
```yaml
apiVersion: v1
kind: PersistentVolume
metadata:
  name: local-pv
spec:
  capacity:
    storage: 10Gi
  accessModes:
  - ReadWriteOnce
  persistentVolumeReclaimPolicy: Retain
  local:
    path: /mnt/data
  nodeAffinity:
    required:
      nodeSelectorTerms:
      - matchExpressions:
        - key: kubernetes.io/hostname
          operator: In
          values:
          - worker-node-1
```

### ✅ 本地存储的优势
- **零配置**：K8s内置支持，无需安装任何组件
- **高性能**：直接访问本地磁盘，延迟最低
- **简单可靠**：没有网络依赖，故障点最少
- **成本最低**：无需额外的存储设备或服务

## 4️⃣ 什么场景下需要CSI

只有当你需要**外部存储系统**时，才需要CSI：

### 🏢 数据中心存储场景
```bash
# 需要共享存储时
- 多个Pod需要访问同一份数据
- 数据需要在Pod重启后保持
- 需要跨节点的数据访问

# 典型应用
- 共享配置文件
- 静态资源文件
- 多副本应用的共享数据
```

### ☁️ 云存储场景
```bash
# 需要云服务集成时
- 使用云厂商的托管存储服务
- 需要自动备份和高可用
- 需要弹性扩容存储容量

# 典型应用
- 生产数据库存储
- 大文件存储和处理
- 跨地域数据同步
```

### 🎯 选择决策树
```
你的应用需要什么？
├─ 只需要临时存储 → emptyDir（无需CSI）
├─ 只需要本地持久化 → hostPath/local PV（无需CSI）
├─ 需要跨Pod共享数据 → NFS CSI / Ceph FS CSI
├─ 需要高性能数据库存储 → 本地SSD（无需CSI）或云盘CSI
└─ 需要云服务集成 → 对应云厂商的CSI Driver
```

### 📋 常见CSI Driver
```bash
# 数据中心存储
nfs.csi.k8s.io          # NFS共享存储
rbd.csi.ceph.com        # Ceph块存储
cephfs.csi.ceph.com     # Ceph文件系统

# 云存储
ebs.csi.aws.com         # AWS云盘
disk.csi.azure.com      # Azure磁盘
pd.csi.storage.gke.io   # Google云盘
```

## 5️⃣ CSI的使用举例

### 📁 例子1：数据中心NFS共享存储

**场景**：多个Web应用需要共享静态资源文件

#### 步骤1：部署NFS Subdir External Provisioner
```bash
# 使用Helm安装（推荐）
helm repo add nfs-subdir-external-provisioner https://kubernetes-sigs.github.io/nfs-subdir-external-provisioner/
helm install nfs-subdir-external-provisioner nfs-subdir-external-provisioner/nfs-subdir-external-provisioner \
    --set nfs.server=192.168.1.100 \
    --set nfs.path=/data/shared

# 验证安装
kubectl get pods -n default | grep nfs-subdir-external-provisioner
```

#### 步骤2：创建StorageClass
```yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: nfs-storage
provisioner: k8s-sigs.io/nfs-subdir-external-provisioner
parameters:
  archiveOnDelete: "false"    # 删除PVC时不归档数据
reclaimPolicy: Delete
allowVolumeExpansion: true
```

#### 步骤3：创建PVC和使用
```yaml
# PVC
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: shared-files-pvc
spec:
  accessModes:
    - ReadWriteMany        # 多个Pod可同时读写
  resources:
    requests:
      storage: 10Gi
  storageClassName: nfs-storage

---
# 使用PVC的Pod
apiVersion: v1
kind: Pod
metadata:
  name: web-app
spec:
  containers:
  - name: nginx
    image: nginx
    volumeMounts:
    - name: shared-files
      mountPath: /usr/share/nginx/html
  volumes:
  - name: shared-files
    persistentVolumeClaim:
      claimName: shared-files-pvc
```

### ☁️ 例子2：AWS EBS云存储

**场景**：数据库需要高性能持久化存储

#### 步骤1：确保EBS CSI Driver已安装
```bash
# 在EKS中，EBS CSI Driver通常已预装
kubectl get pods -n kube-system | grep ebs-csi

# 如果没有，可以通过EKS Add-on安装
aws eks create-addon --cluster-name my-cluster --addon-name aws-ebs-csi-driver
```

#### 步骤2：创建StorageClass
```yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: fast-ssd
provisioner: ebs.csi.aws.com
parameters:
  type: gp3              # 通用SSD
  iops: "3000"          # 性能配置
  encrypted: "true"      # 加密存储
allowVolumeExpansion: true
```

#### 步骤3：创建PVC和使用
```yaml
# PVC
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: database-pvc
spec:
  accessModes:
    - ReadWriteOnce      # 单个Pod独占访问
  resources:
    requests:
      storage: 100Gi
  storageClassName: fast-ssd

---
# 数据库Pod
apiVersion: v1
kind: Pod
metadata:
  name: mysql-db
spec:
  containers:
  - name: mysql
    image: mysql:8.0
    env:
    - name: MYSQL_ROOT_PASSWORD
      value: "password"
    volumeMounts:
    - name: mysql-data
      mountPath: /var/lib/mysql
  volumes:
  - name: mysql-data
    persistentVolumeClaim:
      claimName: database-pvc
```

### 🔍 验证和测试

#### 检查存储状态
```bash
# 查看PVC状态
kubectl get pvc
# NAME               STATUS   VOLUME                     CAPACITY   ACCESS MODES   STORAGECLASS   AGE
# shared-files-pvc   Bound    pvc-12345678-1234-1234     10Gi       RWX            nfs-storage    2m
# database-pvc       Bound    pvc-87654321-4321-4321     100Gi      RWO            fast-ssd       1m

# 查看实际存储卷
kubectl get pv
```

#### 测试数据持久化
```bash
# 写入测试数据
kubectl exec web-app -- sh -c "echo 'Hello NFS!' > /usr/share/nginx/html/test.txt"
kubectl exec mysql-db -- mysql -uroot -ppassword -e "CREATE DATABASE testdb;"

# 删除Pod后重新创建，验证数据是否保持
kubectl delete pod web-app mysql-db
kubectl apply -f your-pod-configs.yaml

# 验证数据仍然存在
kubectl exec web-app -- cat /usr/share/nginx/html/test.txt
kubectl exec mysql-db -- mysql -uroot -ppassword -e "SHOW DATABASES;"
```

### 💡 关键对比

| 特性 | NFS存储 | AWS EBS存储 |
|------|---------|-------------|
| **访问模式** | ReadWriteMany | ReadWriteOnce |
| **适用场景** | 共享文件、静态资源 | 数据库、单应用数据 |
| **性能** | 网络限制 | 高IOPS，低延迟 |
| **可用性** | 依赖NFS服务器 | AWS托管，高可用 |
| **成本** | 自建NFS成本 | 按使用量付费 |

这两个例子展示了CSI的核心价值：**标准化接口，统一管理不同类型的外部存储**！

### 📝 补充说明：其他NFS方案

除了上面使用的NFS Subdir External Provisioner，还有官方的NFS CSI Driver：

```bash
# 官方NFS CSI Driver（标准CSI接口）
kubectl apply -f https://raw.githubusercontent.com/kubernetes-csi/csi-driver-nfs/master/deploy/example/kubernetes/nfs-csi-driver.yaml

# StorageClass配置
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: nfs-csi
provisioner: nfs.csi.k8s.io
parameters:
  server: 192.168.1.100
  share: /data/shared
```

**选择建议**：
- **NFS Subdir External Provisioner**：更简单，为每个PVC创建子目录，企业环境常用
- **官方NFS CSI Driver**：标准CSI接口，功能更完整，适合需要高级特性的场景

## 🎯 总结

**记住这个简单原则**：
- 🏠 **本地存储** = K8s内置 = 无需CSI
- 🌐 **外部存储** = 需要CSI = 标准化接口

大多数简单应用只需要本地存储就够了，不要为了用CSI而用CSI！



----English
