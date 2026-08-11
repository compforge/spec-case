# spec-case

> 一套**代码内的 AI-native 标注体系 + 多语言工具链**：`@spec`/`@rule`/`@link` 这类标记就近长在代码上，由各语言工具抽成机器可读的资产供 AI 消费。它是**绑定到代码的 spec/case 资产**的共享真源，白盒侧被 [case-code-review (`ccr`)](https://github.com/qiankunli/case-code-review) 消费、黑盒侧被 test/eval/perf harness 消费。｜ English: [README.md](./README.md)

## 这是什么

**spec** 描述代码符号的意图/契约；CaseSet 中的 **case** 是黑盒运行使用的可复用激励 + 各判定面判据，`spec.json` 则保存挂在符号上的精简白盒 checklist 投影。两类资产共享 spec-case 提供的稳定 **代码↔spec/case 绑定**——**symbol-id**，分别进入两条消费路径：

- 黑盒 harness **运行** CaseSet（`case → verdict`）。
- `ccr` 把白盒投影**挂到**改动的评审 **unit** 上，作为函数级 checklist。

评审 **unit** 是 `case` 的**评审侧孪生**：同一份"需求/契约"资产，两个消费者。

## 结构化意图注释

可以把 spec-case marker 理解为**绑定到代码 symbol 的结构化注释**，更准确地说，是结构化意图注释。
它保存那些无法仅从实现稳定还原、但修改代码时必须理解的诉求，并让这些诉求可寻址、可机读：

- `spec` 记录代码应该保证什么，以及这份契约为什么存在。
- `rule` 记录后续修改或评审时必须留意的约束。
- `link` 指向解释该诉求的设计上下文或相关 symbol。
- `case` 在确有必要沉淀具体验证场景时补充，默认不是必填项。

它的主要目的不是替代 unit test 或 e2e test。测试与 harness 负责证明行为，marker 负责保存行为背后的
诉求。相比自由文本注释，marker 有稳定词汇、绑定 `symbol-id`、可编译为 `spec.json`，并可通过
`specgen --check` 检查漂移。

## 布局

- `docs/` — `concepts.md`（理念）、`glossary.md`（术语）
- `spec/` — schema、symbol-id 契约与各语言 marker grammar 的规范真源
- `conformance/` — 所有语言工具链共同通过的行为 fixture
- `toolchains/python/` — Python marker 包、`specgen` 与可选 canonical Case model
- `toolchains/go/` — Go `specgen` 实现
- `toolchains/typescript/` — TypeScript decorator / JSDoc marker 与 `specgen` 实现

## 状态

早期 WIP。case 模型与术语沿用通用 test/eval 词汇；**symbol-id 绑定**是本项目独有、要确立的那块。
