# awk 取文件内容的奇数行，一行命令搞定

## 今天记一个很短但挺实用的命令：从文件内容里取奇数行并输出。

这种小命令平时不起眼，真要临时处理日志或文本时，还挺救急。

## 使用场景：
- 从文本里提取出奇数行，比如一组数据按“名称/数量”两行一组排列时，只提取名称行。

## 使用方法：
```bash
awk 'NR % 2 == 1' filename.txt
```

等价于：
```bash
awk 'NR % 2 != 0' filename.txt
```

## K8S 实战例子

用 `kubectl` 的 jsonpath 输出节点信息时，名称和状态会交替出现，每两行一组：

```bash
kubectl get nodes -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{.status.conditions[-1].type}{"\n"}{end}'
```

输出类似：

```
node-1
Ready
node-2
Ready
node-3
NotReady
```

此时只想拿到节点名称（奇数行）：

```bash
kubectl get nodes -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{.status.conditions[-1].type}{"\n"}{end}' \
  | awk 'NR % 2 == 1'
```

输出：

```
node-1
node-2
node-3
```