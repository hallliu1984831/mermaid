# Helm 模板里多写一个字符，为什么 YAML 就坏了？

在 Helm 模板里，`if` 本身并不难，真正容易踩坑的，反而是它旁边不起眼的一个字符：`-`

下面两种写法看起来只差一个 `-`：

```text
{{- if ... }}
{{- if ... -}}
```

咋一看没什么问题，但多出来的这个 `-`，可能会把原本分开的两行 YAML 直接拼在一起。

## 一个看起来没问题的模板

假设在 helm 的 yaml 文件配置里，我们想根据配置决定是否添加一个端口：

```yaml
ports:
{{- if .Values.service.enabled -}}
  - name: http
    port: 8080
{{- end }}
```

我们期待渲染结果是：

```yaml
ports:
  - name: http
    port: 8080
```

当条件为 `true` 时，实际渲染结果会变成：

```yaml
ports:- name: http
  port: 8080
```

`ports:` 和后面的列表项被拼到了一行，原本的 YAML 结构也被破坏了。

## 问题就出在右边的 `-`

在 Helm 模板中：

```text
{{-  删除模板语句左侧的空白
-}}  删除模板语句右侧的空白
```

这里的“空白”不只是空格，也包括换行。

因此：

```text
{{- if .Values.service.enabled -}}
```

左边的 `-` 删除了 `if` 前面的换行，右边的 `-` 又删除了 `if` 后面的换行。由于 `if` 语句本身不会输出 YAML 内容，前面的 `ports:` 和后面的 `- name: http` 就连在了一起。

Helm 官方文档也专门提醒过：同时裁剪两侧空白时，原本分开的 YAML 内容可能被拼到同一行。

## 保留右侧换行

在这个例子里，只保留左侧的 `-`：

```yaml
ports:
{{- if .Values.service.enabled }}
  - name: http
    port: 8080
{{- end }}
```

这样 `if` 后面的换行仍然存在，列表项就会从下一行开始：

```yaml
ports:
  - name: http
    port: 8080
```

同样，如果 `end` 后面的 YAML 内容必须另起一行，也不要随手写成：

```text
{{- end -}}
```

## `-}}` 并不是不能用

右侧的 `-}}` 本身不是错误语法。当你确实想删除后面的空白时，它仍然有用。

真正需要判断的是：

```text
下一段 YAML 是否必须从新的一行开始？
```

如果答案是“是”，就要小心右侧的 `-`。

修改 Helm Chart 后，可以先检查渲染结果：

```bash
helm template demo ./my-chart --debug
helm lint ./my-chart
```

比起只看模板源码，渲染后的 YAML 更容易暴露这种问题。

## 一句话记住

```text
{{- 吃掉左边的空白，-}} 吃掉右边的空白。
YAML 依赖换行表达结构时，不要让右边的 `-` 把换行也吃掉。
```

参考：[Helm 官方文档：Controlling Whitespace](https://helm.sh/docs/chart_template_guide/control_structures/#controlling-whitespace)

