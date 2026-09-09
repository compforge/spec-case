# Rust：spec/case 表达

Rust 用 item 上方的 **doc comment marker** 表达结构化意图。`specgen` 通过 `syn` 静态解析源码，不编译、加载或运行被扫描代码。

## 标记语法

```rust
impl NotebookService {
    /// +spec=`tenant/user header 必填；同名 notebook 不可重复创建`
    /// +case:id=happy_minimal,desc=`只传 name 应创建成功`,expect=`id 非空`
    /// +case:id=duplicate_name,desc=`重复 name`,expect=`Conflict`,forbid=`写入第二条记录`
    /// +why=`数据库唯一约束是多副本写入的最终权威`
    /// +ideal=`由单一持久化 owner 负责写入`
    /// +link=component://docs/tenancy.md
    /// +rule=`请求热路径，留意新增的同步 IO`
    fn create_notebook(&self, request: Request) -> Result<Notebook, Error> {
        // ...
    }
}
```

Rust 与 Go 共用 `+spec` / `+case` / `+why` / `+ideal` / `+tmp` / `+link` / `+rule` 的字段与取值规则：

- `+spec=\`...\``；需要显式身份时写 `+spec:id=string_input,text=\`...\``。
- `+case:id=...,desc=...,input=...,expect=...,forbid=...`，其中 `id` 必须匹配 `^[a-z][a-z0-9_]*$`。
- 自然语言中含逗号时使用反引号或双引号包裹。
- `+link` 必须使用 `repo://` 或 `component://` 锚点。

marker 必须位于 `///` 或 `/** ... */` doc comment 中；普通 `//` 注释不绑定 item，也不会被抽取。等价的 `#[doc = "+spec=..."]` 属性同样可被读取。

七个 marker 可绑定到 free function、associated function / method、struct、enum、union、type alias、trait 及 trait method。inline module 会形成点号限定前缀。

## 绑定（symbol-id）

| Rust 符号 | symbol-id |
|---|---|
| free function `run` @ `src/main.rs` | `src/main.rs::run` |
| inline module `worker` 中的 `run` | `src/main.rs::worker.run` |
| inherent impl `Service::start` | `src/service.rs::Service.start` |
| trait method `Store::get` | `src/store.rs::Store.get` |
| `impl Store for Service` 中的 `get` | `src/service.rs::Service.Store.get` |
| struct / enum / union / type alias `Request` | `src/types.rs::Request` |

泛型参数不进入 symbol；`impl<T> Service<T>` 仍绑定为 `Service.method`。inline module、类型与方法使用点号限定，是因为顶层 symbol-id 已使用 `::` 分隔路径与 symbol，schema 不允许 symbol 内再出现冒号。

同一文件中多个带 marker 的声明若落到同一 symbol-id（例如条件编译的同名实现），每份契约必须通过 `+spec:id=...` 提供唯一 id；缺少 id 或 id 重复时 `specgen` 报错，禁止静默覆盖。

Rust 首版不生成可选 `fqn`。Cargo package name、lib/bin target、自定义 target path 与源码 module path 不能仅从单个 `.rs` 文件稳定还原；在 Cargo target/module resolution 契约明确前省略比生成不稳定身份更安全。

## 抽取与漂移门

仓库内开发可直接运行：

```bash
cargo run --manifest-path toolchains/rust/Cargo.toml --bin specgen -- \
  --root <repo-root> -o spec.json <src-dir>

cargo run --manifest-path toolchains/rust/Cargo.toml --bin specgen -- \
  --root <repo-root> --check -o spec.json <src-dir>
```

`specgen` 递归扫描 `.rs` 文件，忽略 `.git` 与 `target` 目录。语法无法解析的文件与暂时不可读的文件会被跳过；symbol 冲突和非法 spec id 属于契约歧义，会明确报错。


## tmp

```rust
/// +tmp:text=`keep fallback`
fn fallback() {}

/// +tmp:text=`keep legacy conversion`,until=`all supported clients use v2`
fn normalize_request() {}
```

`text` 必填，`until` 选填；未填时生成 `tmps: [{text}]`，填写时生成 `tmps: [{text, until}]`。
多个标记保持声明顺序。
完整语义、字段与提取约束见 [Tmp 契约](../tmp.md)。
