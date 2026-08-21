# spec-case

> An **in-code, AI-native annotation system + multi-language toolchain**: markers like `@spec`/`@rule`/`@link` live right on the code, distilled by per-language tools into a machine-readable asset for AI to consume. It is the shared source-of-truth for **spec/case assets bound to code**, used white-box by [case-code-review (`ccr`)](https://github.com/qiankunli/case-code-review) and black-box by test/eval/perf harnesses. ｜ 中文: [README.zh-CN.md](./README.zh-CN.md)

## What it is

A **spec** states the intent/contract of a code symbol. A CaseSet **case** is a reusable black-box stimulus plus per-face judgment criteria; `spec.json` carries the smaller white-box checklist projection attached to a symbol. spec-case's distinct contribution is the stable **code↔spec/case binding** — the **symbol-id** — shared by those assets. That binding supports two consumer paths:

- A harness **runs** black-box cases (`case → verdict`).
- `ccr` **attaches** the white-box projection to a changed review **unit** as a per-function checklist.

A review **unit** is the review-side twin of a `case`: same "requirement/contract" asset, two consumers.

## Structured intent annotations

Think of spec-case markers as **structured comments bound to code symbols** — more precisely,
structured intent annotations. They preserve the reasoning that cannot be recovered reliably from
the implementation alone, while keeping it addressable and machine-readable:

- `spec` records what the code is intended to guarantee and why the contract exists.
- `rule` records what a future change or review must keep in mind.
- `link` points to the design context or related symbol that explains the intent.
- `case` adds a concrete validation scenario when one is worth preserving; it is optional.

Their primary purpose is not to replace unit or e2e tests. Tests and harnesses prove behavior;
markers preserve the intent behind that behavior. Unlike free-form comments, markers use a stable
vocabulary, bind to a `symbol-id`, compile into `spec.json`, and can be checked for drift with
`specgen --check`.

## Layout

- `docs/` — `concepts.md`, `glossary.md`
- `spec/` — normative schemas, the symbol-id contract, and per-language marker grammars
- `conformance/` — shared behavior fixtures every language toolchain must pass
- `toolchains/python/` — the pip package: markers, `specgen`, and the optional canonical Case model
- `toolchains/go/` — the Go `specgen` implementation
- `toolchains/typescript/` — TypeScript decorators, JSDoc markers, and the Compiler API `specgen`

```bash
pip install spec-case          # markers + specgen only, zero deps
pip install 'spec-case[model]' # + canonical Case model (pydantic, pyyaml)
npm install @compforge/spec-case # TypeScript CaseSet runtime + markers + specgen
```

## Status

Early WIP. The case model and vocabulary are standard test/eval terms; the **symbol-id binding** is the new piece this project owns.
