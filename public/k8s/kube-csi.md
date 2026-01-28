----- Chinese
# 💾 CSI (Container Storage Interface)：K8S大学的"专业存储工程师"

## 前言：没有存储专家，数据就无家可归

大家好！今天我们来聊聊CSI（Container Storage Interface）这个"专业存储工程师"。你可能天天和存储打交道，但你想过没有：为什么一个YAML文件就能自动创建存储卷？为什么不同的存储系统都能无缝接入K8s？

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
K8S API Server (K8S大学总务处) <--> CSI Driver (存储工程师) <--> Storage System (存储设备)
```

### CSI Driver的三大组件
1. Controller Plugin（存储调度员）
   - 负责存储卷的创建、删除、扩容
   - 处理快照、克隆等高级功能
   - 运行在控制节点上，以Deployment的形式维护

2. Node Plugin（现场工程师）
   - 负责存储卷的挂载、卸载
   - 处理节点级别的存储操作
   - 运行在每个工作节点上，以DaemonSet的形式维护

3. CSI Sidecar Containers（专业助手）
   - external-provisioner：动态供应助手
   - external-attacher：挂载管理助手
   - external-resizer：扩容管理助手
   - external-snapshotter：快照管理助手

## 3️⃣ 集群中不存在CSI组件？本地存储也能将就

如果你的K8s集群中没有任何CSI Driver，这完全正常！因为K8s内置支持本地存储：

### 🏠 无需CSI的本地存储方案

#### 直接使用hostPath
如果从当前节点上删除POD，并且在同一个节点重新创建POD，数据不会丢失，因为数据存储在节点的本地磁盘上。如果删除后被调度到其他节点上，数据会丢失。因为新POD会在新的节点上创建目录，没有原节点数据。举例如下：
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
POD被删除以后，emptyDir中的数据会丢失，所以emptyDir适合存储临时数据，不支持持久化。举例如下：
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
同样存在对节点的依赖，请注意如下nodeAffinity的配置，它限制了该PV只能被worker-node-1节点使用。即确保了POD和PV在同一个节点上，数据才不会丢失。举例如下：
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
- 零配置：K8s内置支持，无需安装任何组件
- 高性能：直接访问本地磁盘，延迟最低
- 简单可靠：没有网络依赖，故障点最少
- 成本最低：无需额外的存储设备或服务

## 4️⃣ 什么场景下需要CSI

当你需要使用外部存储系统时，才需要CSI：

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

场景：多个Web应用需要共享静态资源文件

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
  storageClassName: nfs-storage # 指定NFS存储类，上图SC的名字

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

### ☁️ 例子2：本地集群挂载AWS S3存储

场景：本地K8s集群需要使用AWS S3作为对象存储

#### 步骤1：安装S3 CSI Driver
```bash
# 安装S3 CSI Driver
kubectl apply -f https://raw.githubusercontent.com/awslabs/mountpoint-s3-csi-driver/main/deploy/kubernetes/overlays/stable/kustomization.yaml

# 验证安装
kubectl get pods -n kube-system | grep s3-csi
```

#### 步骤2：创建AWS凭证
```bash
# 创建AWS访问密钥Secret
kubectl create secret generic aws-secret \
  --from-literal=key_id=YOUR_ACCESS_KEY_ID \
  --from-literal=access_key=YOUR_SECRET_ACCESS_KEY \
  -n kube-system
```

#### 步骤3：创建StorageClass
```yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: s3-storage
provisioner: s3.csi.aws.com
parameters:
  mounter: mountpoint-s3           # 使用Mountpoint for S3
  bucketName: my-k8s-bucket        # S3存储桶名称
  region: us-west-2                # AWS区域
mountOptions:
  - allow-delete                   # 允许删除操作
  - region=us-west-2
```

#### 步骤4：创建PVC和使用
```yaml
# PVC
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: s3-storage-pvc
spec:
  accessModes:
    - ReadWriteMany      # S3支持多Pod访问
  resources:
    requests:
      storage: 100Gi     # 逻辑容量
  storageClassName: s3-storage

---
# 应用Pod
apiVersion: v1
kind: Pod
metadata:
  name: s3-app-pod
spec:
  containers:
  - name: app
    image: nginx
    volumeMounts:
    - name: s3-data
      mountPath: /data
    env:
    - name: AWS_ACCESS_KEY_ID
      valueFrom:
        secretKeyRef:
          name: aws-secret
          key: key_id
    - name: AWS_SECRET_ACCESS_KEY
      valueFrom:
        secretKeyRef:
          name: aws-secret
          key: access_key
  volumes:
  - name: s3-data
    persistentVolumeClaim:
      claimName: s3-storage-pvc
```

### 🔍 验证和测试

```bash
# 查看PVC状态
kubectl get pvc

# 测试数据写入
kubectl exec s3-app-pod -- sh -c "echo 'Hello S3!' > /data/test.txt"

# 查看S3存储桶内容
aws s3 ls s3://my-k8s-bucket/
```

## 🎯 总结

| 特性 | 本地存储 | NFS存储 | S3云存储 |
|------|---------|---------|----------|
| 是否需要CSI | ❌ K8s内置 | ✅ 需要CSI | ✅ 需要CSI |
| 访问模式 | ReadWriteOnce | ReadWriteMany | ReadWriteMany |
| 适用场景 | 高性能、临时数据 | 共享文件、静态资源 | 对象存储、备份归档 |
| 性能 | 最高（本地磁盘） | 网络限制 | 网络限制，高吞吐 |
| 可用性 | 依赖节点 | 依赖NFS服务器 | 云服务，99.9%可用 |
| 数据持久性 | 节点故障丢失 | 服务器级持久 | 云级持久，多副本 |
| 成本 | 最低（无额外成本） | 自建NFS成本 | 按使用量付费 |
| 跨节点访问 | ❌ 不支持 | ✅ 支持 | ✅ 支持 |

记住这个简单原则：
- 🏠 本地存储 --> K8s内置 --> 无需CSI
- 🌐 外部存储 --> 需要CSI --> 标准化接口
- 生产环境一般都会使用CSI

----English

# 💾 CSI (Container Storage Interface): The "Storage Engineer" of K8s University

## Preface: Without Storage Experts, Data Has No Home

Hey there! Today we're diving into CSI (Container Storage Interface) - the "professional storage engineer" of our K8s world. You probably work with storage every day, but have you ever wondered: How does a simple YAML file automatically create storage volumes? How do different storage systems seamlessly integrate with K8s?

Imagine if K8s University had no professional storage engineers:
- 📚 Students need lockers? Sorry, you'll have to buy, install, and maintain them yourself
- 💻 Database needs persistent storage? You'll have to manually configure every storage device
- 🔄 Want to backup data? You'll need to learn each storage system's proprietary tools

That's what a K8s cluster without CSI looks like - a "storage management nightmare"!

## 1️⃣ What is CSI? The "Professional Storage Engineer" of K8s University

### CSI: Container Storage Interface
Just like professional storage engineers on campus help you manage various storage devices, CSI standardizes complex storage operations, enabling different storage systems to serve K8s:

- Storage Abstraction: Unifies various storage systems into standard interfaces
- Dynamic Provisioning: Automatically creates and deletes storage volumes based on demand
- Lifecycle Management: Complete management from creation to deletion
- Cross-Platform Support: Supports cloud storage, local storage, network storage, etc.

💡 Key Understanding: CSI is like the "universal storage butler" on campus - you just specify your storage needs, and it handles everything else.

## 2️⃣ How CSI Works: The "Standard Operating Procedures" of Storage Engineers

### CSI Architecture: Collaborative Division of Three Professional Roles
```
K8s API Server (University Administration) <--> CSI Driver (Storage Engineer) <--> Storage System (Storage Equipment)
```

### Three Major Components of CSI Driver
1. Controller Plugin (Storage Coordinator)
   - Handles storage volume creation, deletion, and expansion
   - Manages advanced features like snapshots and cloning
   - Runs on control nodes, maintained as a Deployment

2. Node Plugin (Field Engineer)
   - Handles storage volume mounting and unmounting
   - Manages node-level storage operations
   - Runs on every worker node, maintained as a DaemonSet

3. CSI Sidecar Containers (Professional Assistants)
   - external-provisioner: Dynamic provisioning assistant
   - external-attacher: Mount management assistant
   - external-resizer: Expansion management assistant
   - external-snapshotter: Snapshot management assistant

## 3️⃣ No CSI Components in Your Cluster: Local Storage is Enough

This is completely normal! Many K8s clusters run perfectly fine without any CSI components because local storage doesn't need CSI.

### 🏠 Local Storage Solutions That Don't Need CSI

#### Direct hostPath Usage
If you delete a Pod from the current node and recreate it on the same node, data won't be lost because it's stored on the node's local disk. However, if the Pod gets scheduled to a different node after deletion, data will be lost since the new Pod will create directories on the new node without access to the original node's data.

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

#### Using emptyDir for Temporary Storage
After a Pod is deleted, data in emptyDir will be lost, so emptyDir is suitable for storing temporary data and doesn't support persistence.

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
      mountPath: /tmp/data
  volumes:
  - name: temp-data
    emptyDir: {}
```

#### Manually Creating Local PVs
This also has node dependency. Note the nodeAffinity configuration below, which restricts this PV to only be used by worker-node-1. This ensures the Pod and PV are on the same node so data won't be lost.

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
  persistentVolumeReclaimPolicy: Delete
  storageClassName: local-storage
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

## 4️⃣ When Do You Need CSI?

You only need CSI when you need to use external storage systems:

### 🏢 Data Center Storage Scenarios
```bash
# When you need shared storage
- Multiple Pods need to access the same data
- Data needs to persist after Pod restarts
- Cross-node data access is required

# Typical applications
- Shared configuration files
- Static resource files
- Shared data for multi-replica applications
```

### ☁️ Cloud Storage Scenarios
```bash
# When you need cloud service integration
- Using cloud provider managed storage services
- Need automatic backup and high availability
- Need elastic storage capacity scaling

# Typical applications
- Production database storage
- Large file storage and processing
- Cross-region data synchronization
```

### 🎯 Decision Tree
```
What does your application need?
├─ Just temporary storage → emptyDir (No CSI needed)
├─ Just local persistence → hostPath/local PV (No CSI needed)
├─ Cross-Pod data sharing → NFS CSI / Ceph FS CSI
├─ High-performance database storage → Local SSD (No CSI) or Cloud disk CSI
└─ Cloud service integration → Corresponding cloud provider CSI Driver
```

### 📋 Common CSI Drivers
```bash
# Data Center Storage
- NFS: k8s-sigs.io/nfs-subdir-external-provisioner
- Ceph RBD: rbd.csi.ceph.com
- Ceph FS: cephfs.csi.ceph.com
- GlusterFS: gluster.org/glusterfs

# Cloud Storage
- AWS EBS: ebs.csi.aws.com
- AWS EFS: efs.csi.aws.com
- AWS S3: s3.csi.aws.com
- Azure Disk: disk.csi.azure.com
- GCP PD: pd.csi.storage.gke.io
```

## 5️⃣ CSI Usage Examples

### 🏢 Example 1: Data Center NFS Shared Storage

Scenario: Multiple web applications need to share static resources

#### Step 1: Install NFS Subdir External Provisioner
```bash
# Add Helm repository
helm repo add nfs-subdir-external-provisioner https://kubernetes-sigs.github.io/nfs-subdir-external-provisioner/

# Install using Helm
helm install nfs-subdir-external-provisioner nfs-subdir-external-provisioner/nfs-subdir-external-provisioner \
    --set nfs.server=192.168.1.100 \
    --set nfs.path=/data/shared

# Verify installation
kubectl get pods | grep nfs-subdir
```

#### Step 2: Create StorageClass
```yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: nfs-storage
provisioner: k8s-sigs.io/nfs-subdir-external-provisioner
parameters:
  archiveOnDelete: "false"    # Don't archive on delete
reclaimPolicy: Delete
```

#### Step 3: Create PVC and Use It
```yaml
# PVC
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: shared-files-pvc
spec:
  accessModes:
    - ReadWriteMany      # Multiple Pods can access simultaneously
  resources:
    requests:
      storage: 10Gi
  storageClassName: nfs-storage

---
# Application Pod
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

### ☁️ Example 2: Local Cluster Mounting AWS S3 Storage

Scenario: Local K8s cluster needs to use AWS S3 as object storage

#### Step 1: Install S3 CSI Driver
```bash
# Install S3 CSI Driver
kubectl apply -f https://raw.githubusercontent.com/awslabs/mountpoint-s3-csi-driver/main/deploy/kubernetes/overlays/stable/kustomization.yaml

# Verify installation
kubectl get pods -n kube-system | grep s3-csi
```

#### Step 2: Create AWS Credentials
```bash
# Create AWS access key Secret
kubectl create secret generic aws-secret \
  --from-literal=key_id=YOUR_ACCESS_KEY_ID \
  --from-literal=access_key=YOUR_SECRET_ACCESS_KEY \
  -n kube-system
```

#### Step 3: Create StorageClass
```yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: s3-storage
provisioner: s3.csi.aws.com
parameters:
  mounter: mountpoint-s3           # Use Mountpoint for S3
  bucketName: my-k8s-bucket        # S3 bucket name
  region: us-west-2                # AWS region
mountOptions:
  - allow-delete                   # Allow delete operations
  - region=us-west-2
```

#### Step 4: Create PVC and Use It
```yaml
# PVC
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: s3-storage-pvc
spec:
  accessModes:
    - ReadWriteMany      # S3 supports multiple Pod access
  resources:
    requests:
      storage: 100Gi     # Logical capacity
  storageClassName: s3-storage

---
# Application Pod
apiVersion: v1
kind: Pod
metadata:
  name: s3-app-pod
spec:
  containers:
  - name: app
    image: nginx
    volumeMounts:
    - name: s3-data
      mountPath: /data
    env:
    - name: AWS_ACCESS_KEY_ID
      valueFrom:
        secretKeyRef:
          name: aws-secret
          key: key_id
    - name: AWS_SECRET_ACCESS_KEY
      valueFrom:
        secretKeyRef:
          name: aws-secret
          key: access_key
  volumes:
  - name: s3-data
    persistentVolumeClaim:
      claimName: s3-storage-pvc
```

### 🔍 Verification and Testing

```bash
# Check PVC status
kubectl get pvc

# Test data writing
kubectl exec s3-app-pod -- sh -c "echo 'Hello S3!' > /data/test.txt"

# Check S3 bucket contents
aws s3 ls s3://my-k8s-bucket/
```

## 🎯 Summary

| Feature | Local Storage | NFS Storage | S3 Cloud Storage |
|---------|---------------|-------------|------------------|
| Requires CSI | ❌ K8s built-in | ✅ Needs CSI | ✅ Needs CSI |
| Access Mode | ReadWriteOnce | ReadWriteMany | ReadWriteMany |
| Use Cases | High performance, temporary data | Shared files, static resources | Object storage, backup archival |
| Performance | Highest (local disk) | Network limited | Network limited, high throughput |
| Availability | Node dependent | NFS server dependent | Cloud service, 99.9% available |
| Data Persistence | Lost on node failure | Server-level persistence | Cloud-level persistence, multi-replica |
| Cost | Lowest (no extra cost) | Self-hosted NFS cost | Pay-per-use |
| Cross-Node Access | ❌ Not supported | ✅ Supported | ✅ Supported |

Remember these simple principles:
- 🏠 Local Storage --> K8s built-in --> No CSI needed
- 🌐 External Storage --> Requires CSI --> Standardized interface
- Production environments typically use CSI
