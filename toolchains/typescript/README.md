# spec-case (TypeScript)

TypeScript 的 canonical CaseSet runtime，以及 **spec / case / link / rule** markers 与静态
`specgen`。CaseSet runtime 供 e2e / eval / perf 等 Harness 读取同一份资产；specgen 把绑定到代码
symbol 的 decorator 或 JSDoc marker 编译成 `spec.json`。

## 安装

```bash
npm install @compforge/spec-case
```

读取并校验可同时交给 Eval 与 Perf 的 CaseSet：

```typescript
import { loadCaseSet, validateCaseSet } from "@compforge/spec-case/model";

const cases = loadCaseSet("cases/ordinary-chat.yaml");
validateCaseSet(cases);
```

class 和 method 可以使用 no-op decorators：

```typescript
import { Case, Link, Rule, Spec } from "@compforge/spec-case";

class Service {
  @Spec("returns the notebook when it exists")
  @Case("found", "existing id", { expect: "notebook returned" })
  @Link("docs/notebook.md")
  @Rule("keep tenant filtering in the query")
  get(): void {}
}
```

TypeScript overload 需要分别维护契约时，给 `spec` 配置同一 symbol 内唯一的 `id`：

```typescript
/** @spec id=string_input,text=`looks up string input` */
export function get(value: string): string;
/** @spec id=number_input,text=`looks up numeric input` */
export function get(value: number): number;
export function get(value: string | number): string | number;
```

decorator 对应写法为 `@Spec("looks up string input", { id: "string_input" })`。所有 entry 都输出
`specs[]`；只有一个 spec 时 `id` 可省略，同一 symbol 的多个 spec 必须全部配置唯一 id。

普通 function、function-valued variable 和纯类型 symbol 使用 JSDoc marker，无需运行时 import。完整语法
与 symbol-id 规则见 [`spec/languages/typescript.md`](../../spec/languages/typescript.md)。

## 生成与检查

```bash
npx specgen <src-dir> -o spec.json --root <repo-root>
npx specgen <src-dir> -o spec.json --root <repo-root> --check
```

`specgen` 使用 TypeScript Compiler API 静态解析源码，不 import 或执行被扫描项目。
