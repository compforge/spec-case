# LinkRef 路径锚点

`link` 保存作者策展的 see-also 指针。仓内目标必须使用显式路径锚点，让引用的解析基准不依赖
marker 所在文件的目录或消费方当前工作目录。

## 语法

```text
link-ref       = anchored-path [ "::" symbol ]
anchored-path  = repo-path | component-path
repo-path      = "repo://" relative-path
component-path = "component://" relative-path
```

`relative-path` 使用 `/` 分隔，不以 `/` 开头，不包含空白、空路径段、`.`、`..` 或反斜杠路径段。`::symbol` 可选；
存在时目标是另一个代码 symbol，否则目标是文档等仓内资产。

```text
repo://docs/architecture.md
repo://shared/auth/policy.go::Policy.Check
component://docs/design.md
component://internal/service.go::Service.Update
```

## 两个锚点

- `repo://` 相对当前 Git snapshot 的 Repository 根解析，适合仓级文档和跨 Component 引用。
- `component://` 相对当前 marker 所属 symbol 的 Component 根解析。Component 是 Repository 内具有
  独立 build、验证和发布生命周期的服务组件；它不是语言，也不等同于源码文件所在目录。

Component 归属属于消费方的 Project Knowledge。项目清单、构建配置或显式项目配置可以为归属提供
事实，但 spec-case 不从 `go.mod`、`package.json`、`pyproject.toml` 等文件自行推断 Component。
消费方无法确定所属 Component 时，`component://` 保持 unresolved 或报错，不得回退到 Repository 根。

## 解析边界

specgen 只把符合锚点语法的 LinkRef 原样写入 `spec.json`。消费方在同一 Repository snapshot 中解析
目标，并负责确保规范化后的路径仍位于对应锚点内。LinkRef 不采用相对 marker 文件的 `../` 语义；代码
移动不应改变一条 link 指向的项目资产。
