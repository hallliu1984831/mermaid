----- Chinese
Kubernetes Secret 简介
大家好，聊过安全生产法则以后，我来分享日常工作中使用Kubernetes时发生的案例。这是一个隐秘且很容易踩坑的案例，从介绍K8S的secret开始。

关于K8S Secret
在 Kubernetes 中，Secret 是一种专门用于存储敏感信息（如密码、API 密钥、证书等）的资源类型。它可以帮助我们更安全地管理和使用这些数据。Secret 作为 Kubernetes 的核心资源之一，在现代容器化应用中扮演着至关重要的角色，特别是在微服务架构中，各个服务之间需要安全地共享敏感信息。


1️⃣ 为什么要用 Secret
在管理敏感信息时，直接将这些数据存储在代码或配置文件中可能存在以下问题：
⚠️ 安全风险：敏感信息容易明文暴露，特别是在版本控制系统（如 Git）中。
⚠️ 缺乏灵活性：不同环境中的敏感信息可能不同，直接硬编码会导致修改困难。
⚠️ 权限管理不足：无法有效控制哪些用户或应用可以访问这些数据。
使用 Secret 的好处包括：
👍 安全存储：将敏感信息与应用解耦，降低泄露风险。
👍 权限控制：通过 Kubernetes 的 RBAC 机制，确保只有被授权的应用可以访问对应的 Secret。
👍 动态更新：支持敏感信息的动态更新，无需重新部署应用。
👍 版本控制友好：避免在代码仓库中存储敏感信息，符合安全最佳实践。
👍 集中管理：统一管理所有敏感信息，便于维护和审计。

2️⃣ Secret 的核心特性：
• 命名空间级别的资源：Secret 属于特定的命名空间，不同命名空间的 Secret 相互隔离
• 内存存储：Secret 数据存储在 tmpfs 中，不会写入磁盘，提高安全性
• 大小限制：单个 Secret 的大小限制为 1MB，这是为了避免对 etcd 造成过大压力
• 自动挂载：可以自动挂载到 Pod 中，无需手动配置

3️⃣ Secret 的主要类型：
K8S 提供了多种内置的 Secret 类型，每种类型都有特定的用途：

• Opaque（通用类型）：最常用的类型，可以存储任意的键值对数据
• kubernetes.io/service-account-token：用于 ServiceAccount 的访问令牌
• kubernetes.io/dockercfg：用于存储 Docker 镜像仓库的认证信息（旧格式）
• kubernetes.io/dockerconfigjson：用于存储 Docker 镜像仓库的认证信息（新格式）
• kubernetes.io/basic-auth：用于存储基本认证的用户名和密码
• kubernetes.io/ssh-auth：用于存储 SSH 认证的私钥
• kubernetes.io/tls：用于存储 TLS 证书和私钥
• bootstrap.kubernetes.io/token：用于节点引导过程中的令牌
	
4️⃣ Secret 中的值需要以 Base64 编码存储，这并不是为了加密，而是出于以下原因：
格式兼容：Base64 可以将数据转换为只包含 ASCII 字符的字符串，确保即使是二进制数据也能安全地存储在 YAML/JSON 文件中。
减少明文暴露：虽然不是加密手段，但 Base64 可以在一定程度上避免数据被直接识别。
API 要求：Kubernetes 的 API 设计要求 Secret 的值以 Base64 编码形式存储。
‼️‼️‼️ 需要注意的是，Base64 并不能真正保护数据的安全。如果需要更高的安全性，可以结合外部密钥管理系统使用。

5️⃣ Secret 的使用方式
应用可以通过以下方式使用 Secret 中存储的敏感信息：
注入环境变量，如图3所示：
将 Secret 的值注入到 Pod 的环境变量中，应用可以通过环境变量直接读取这些数据。这种方式适合简单的配置场景。
挂载到文件系统
将 Secret 的值以文件形式挂载到容器内，应用可以通过读取文件来获取敏感信息。这种方式适合管理复杂或大数据量的敏感内容。

📊 两种使用方式的对比：

| 特性 | 环境变量 | 文件挂载 |
|------|----------|----------|
| 使用便利性 | 简单直接 | 需要读取文件 |
| 安全性 | 可能在进程列表中可见 | 相对更安全 |
| 动态更新 | 需要重启 Pod | 支持热更新 |
| 大小限制 | 受环境变量限制 | 受 Secret 大小限制 |
| 适用场景 | 简单配置 | 证书、配置文件 |

6️⃣ Secret 的生命周期管理
• 创建阶段：使用 kubectl、YAML 文件或 API 创建 Secret
• 使用阶段：Pod 通过环境变量或文件挂载方式消费 Secret
• 更新阶段：修改 Secret 内容，文件挂载方式可以自动更新
• 删除阶段：删除不再使用的 Secret，注意依赖关系

7️⃣ Secret 的安全考虑
虽然 Secret 提供了比直接在代码中硬编码敏感信息更好的安全性，但仍需要注意以下安全要点：

• etcd 加密：确保 etcd 中的数据是加密存储的，避免直接访问 etcd 时泄露敏感信息
• 网络传输：Secret 在 API Server 和 kubelet 之间的传输应该使用 TLS 加密
• 节点安全：由于 Secret 会挂载到节点的内存中，需要确保节点的物理安全
• RBAC 配置：严格配置 RBAC 权限，限制对 Secret 的访问
• 审计日志：启用审计功能，记录对 Secret 的所有访问操作
• 定期轮换：定期更新 Secret 中的敏感信息，特别是密码和 API 密钥

8️⃣ Secret 的最佳实践
• 最小权限原则：只给需要的 Pod 和 ServiceAccount 访问特定 Secret 的权限
• 分离关注点：不同类型的敏感信息使用不同的 Secret 存储
• 环境隔离：不同环境（开发、测试、生产）使用独立的 Secret
• 自动化管理：使用工具如 External Secrets Operator 来自动同步外部密钥管理系统
• 监控告警：监控 Secret 的访问模式，发现异常访问时及时告警

9️⃣ 常见陷阱和注意事项
• 换行符问题：使用文件创建 Secret 时要注意文件末尾的换行符
• 编码问题：确保 Base64 编码的正确性，避免字符集问题
• 权限问题：确保 ServiceAccount 有足够的权限访问 Secret
• 命名空间问题：Secret 和使用它的 Pod 必须在同一个命名空间
• 大小写敏感：Secret 的键名是大小写敏感的

通过合理使用 Secret，可以帮助开发者更安全、高效地管理敏感信息。接下来我将具体说明案例内容以及如何修复。

----- English

Introduction to Kubernetes Secret

Hello everyone, after discussing safety production rules, I'll continue sharing cases that occurred during K8S usage.
This is a hidden and easily overlooked case, starting with an introduction to K8S secrets.

In K8S, Secret is a resource type specifically designed for storing sensitive information (such as passwords, API keys, certificates, etc.). It helps us manage and use this data more securely. As one of Kubernetes' core resources, Secret plays a crucial role in modern containerized applications, especially in microservice architectures where services need to securely share sensitive information.

🔍 Core Features of Secret:
• Namespace-level resource: Secrets belong to specific namespaces, with isolation between different namespaces
• In-memory storage: Secret data is stored in tmpfs, not written to disk, enhancing security
• Size limitation: Individual Secret size is limited to 1MB to avoid excessive pressure on etcd
• Automatic mounting: Can be automatically mounted to Pods without manual configuration

1️⃣ Why Use Secret

When managing sensitive information, directly storing this data in code or configuration files may present the following problems:
⚠️ Security risks: Sensitive information is easily exposed in plain text, especially in version control systems (like Git).
⚠️ Lack of flexibility: Sensitive information may differ across environments, and hard-coding makes modifications difficult.
⚠️ Insufficient permission management: Cannot effectively control which users or applications can access this data.

Benefits of using Secret include:
👍 Secure storage: Decouples sensitive information from applications, reducing exposure risks.
👍 Permission control: Through Kubernetes' RBAC mechanism, ensures only authorized applications can access corresponding Secrets.
👍 Dynamic updates: Supports dynamic updates of sensitive information without redeploying applications.
👍 Version control friendly: Avoids storing sensitive information in code repositories, following security best practices.
👍 Centralized management: Unified management of all sensitive information, facilitating maintenance and auditing.

📋 Main Types of Secret:
K8S provides multiple built-in Secret types, each with specific purposes:

• Opaque (generic type): Most commonly used type, can store arbitrary key-value pair data
• kubernetes.io/service-account-token: Used for ServiceAccount access tokens
• kubernetes.io/dockercfg: Used for storing Docker registry authentication information (old format)
• kubernetes.io/dockerconfigjson: Used for storing Docker registry authentication information (new format)
• kubernetes.io/basic-auth: Used for storing basic authentication username and password
• kubernetes.io/ssh-auth: Used for storing SSH authentication private keys
• kubernetes.io/tls: Used for storing TLS certificates and private keys
• bootstrap.kubernetes.io/token: Used for tokens during node bootstrap process

2️⃣ Values in Secret need to be stored in Base64 encoding, which is not for encryption but for the following reasons:

Format compatibility: Base64 can convert data into strings containing only ASCII characters, ensuring even binary data can be safely stored in YAML/JSON files.
Reduce plain text exposure: While not an encryption method, Base64 can prevent data from being directly identified to some extent.
API requirements: Kubernetes' API design requires Secret values to be stored in Base64 encoded format.
‼️‼️‼️ It's important to note that Base64 cannot truly protect data security. If higher security is needed, it can be used in combination with external key management systems.

3️⃣ Applications can use sensitive information stored in Secret through the following methods:

Inject environment variables, as shown in Figure 3:
Inject Secret values into Pod environment variables, allowing applications to directly read this data through environment variables. This method is suitable for simple configuration scenarios.

Mount to file system:
Mount Secret values as files into containers, allowing applications to obtain sensitive information by reading files. This method is suitable for managing complex or large-volume sensitive content.

📊 Comparison of Two Usage Methods:

| Feature | Environment Variables | File Mounting |
|---------|----------------------|---------------|
| Ease of use | Simple and direct | Requires file reading |
| Security | May be visible in process list | Relatively more secure |
| Dynamic updates | Requires Pod restart | Supports hot updates |
| Size limitations | Limited by environment variables | Limited by Secret size |
| Use cases | Simple configuration | Certificates, config files |

4️⃣ Secret Lifecycle Management
• Creation phase: Create Secret using kubectl, YAML files, or API
• Usage phase: Pods consume Secret through environment variables or file mounting
• Update phase: Modify Secret content, file mounting method supports automatic updates
• Deletion phase: Delete unused Secrets, pay attention to dependencies

5️⃣ Security Considerations for Secret
While Secret provides better security than hardcoding sensitive information directly in code, the following security points still need attention:

• etcd encryption: Ensure data in etcd is encrypted at rest to prevent exposure when directly accessing etcd
• Network transmission: Secret transmission between API Server and kubelet should use TLS encryption
• Node security: Since Secrets are mounted in node memory, ensure physical security of nodes
• RBAC configuration: Strictly configure RBAC permissions to limit access to Secrets
• Audit logging: Enable auditing to record all access operations to Secrets
• Regular rotation: Regularly update sensitive information in Secrets, especially passwords and API keys

6️⃣ Best Practices for Secret
• Principle of least privilege: Only grant access to specific Secrets to Pods and ServiceAccounts that need them
• Separation of concerns: Use different Secrets to store different types of sensitive information
• Environment isolation: Use independent Secrets for different environments (development, testing, production)
• Automated management: Use tools like External Secrets Operator to automatically sync external key management systems
• Monitoring and alerting: Monitor Secret access patterns and alert on anomalous access

7️⃣ Common Pitfalls and Considerations
• Newline character issues: Pay attention to newline characters at the end of files when creating Secrets from files
• Encoding issues: Ensure correctness of Base64 encoding, avoid character set problems
• Permission issues: Ensure ServiceAccount has sufficient permissions to access Secret
• Namespace issues: Secret and the Pod using it must be in the same namespace
• Case sensitivity: Secret key names are case-sensitive

By properly using Secret, developers can manage sensitive information more securely and efficiently. Next, I will specifically explain the case content and how to fix it.
