# spec-case — 项目地图

## 项目定位与边界

spec-case 是**绑定到代码的 spec/case 资产的共享真源**，被两类消费方使用：

- **黑盒 harness**（test/eval/perf）：把 case 跑成 verdict（`case → verdict`，打真实被测系统）。
- **case-code-review / [`ccr`](https://github.com/qiankunli/case-code-review)**（白盒）：把 spec/case 挂到改动的评审 **unit**（函数）上，作为 review 的 checklist。

**边界**：spec-case 定义**资产的形状、表达与绑定契约**（concept / schema / marker grammar / symbol-id），并在 `toolchains/` 提供语言实现。**不实现** harness 引擎（黑盒跑 case 那套）。被测仓直接用本仓的 specgen，无需自己实现。

**它独有的那块**：`symbol-id`——把"一条 spec/一组 case 断言的是哪个代码符号"形式化为一等绑定，让绑定可被消费方 key（普通 case 模型只有跨运行对齐用的 `case_id`，没有代码符号绑定）。

## 代码地图与核心模块

- `docs/concepts.md` — 理念：spec/case/unit 三词、case 模型、双消费、三种编写前端、生成态 `spec.json`。
- `docs/glossary.md` — 术语表。
- `spec/` — ★ **规范真源**：CaseSet / `spec.json` schema、symbol-id 契约和各语言 marker grammar。
- `conformance/` — ★ **跨语言行为契约**：所有 specgen 实现共同消费的 fixture。
- `toolchains/python/` — Python marker 包、canonical Case model 与 `specgen`。
- `toolchains/go/` — Go marker grammar（`marker/`）、`specgen` 投影（`specgen/`）与 `cmd/specgen` 工具。
- `toolchains/typescript/` — TypeScript canonical CaseSet runtime、decorator / JSDoc marker 与基于 Compiler API 的 `specgen`。
- 三个 specgen 都带 `--check`：比对 committed `spec.json` vs 当前 marker，漂移（重命名/删除/marker 改动）则报差异 + 非零退出——CI 漂移门。

## 关键约定

- **身份与产物分层**：`case_id` 在 CaseSet 内对齐 case，`symbol-id` 把 spec/case 绑定到代码符号；CaseSet 是黑盒运行输入，`spec.json` 是白盒 review 投影，两者共享词汇与绑定契约但 shape 不同。
- **symbol-id 仓内、fqn 跨仓**：`symbol-id`（relpath）是仓内 key；每条 entry 另带可选 `fqn`（符号的语言原生全限定名——Python 点号 import 路径 / Go `importpath.Symbol`），是跨仓引用的 location-independent 身份。评审仓引用**依赖**里的符号（如 framework SDK 的类型）时，依赖 relpath 在本仓不存在，只有 fqn 两头对得上。fqn 取法与语言相关（Py `__init__.py` 包链、Go `go.mod`），取不到则省略。
- **spec / case / link / rule 都挂 symbol**（ccr 评审一个改动 unit 收的**四类上下文**）：一个符号 0..N spec，每个 spec 有 0..N case、0..N link、0..N rule。symbol 可以是函数、方法，或**类/类型**。link = 作者策展的 "see also"（md 路径或另一 symbol-id）；rule = 审查准则（rule.json 的共置细化）——挂在函数上是"改它时盯什么"，挂在**类/类型**上是"用到该类型时盯什么"（类型级用法约束，如"仅 per-request"），供 review 在 diff 引用该类型时回溯注入。见 `docs/concepts.md`。
- **协议一致性由工具守住**：绑定基于符号而非行号，重命名产生新 id 并由 `specgen --check` 报漂移；语言语法可以不同，但所有实现必须通过共享 conformance。
- **symbol-id 与 spec id 分层**：symbol-id 始终由源码结构生成；同一代码 symbol 需要多份契约时，用可选 `spec.id` 在 entry 的 `specs[]` 内区分，不手工覆盖 symbol-id。CaseSet 的 `binding.spec_id` 与 `specs[].id` 使用同一个 join key；单 spec 时均可省略。
- **词汇统一**：spec / case / case_id / input / judge / face / facet / verdict / run / scope / check / source，全仓一致，不另造同义词。

## References

- 消费方引擎（白盒）：[`case-code-review`](https://github.com/qiankunli/case-code-review)（`ccr`）— `UnitSplitter` / `ContextBuilder` / `SpecBuilder`。
