# spec-case (TypeScript)

TypeScript 的 **spec / case / link / rule** markers 与静态 `specgen`。它把绑定到代码 symbol 的
decorator 或 JSDoc marker 编译成 `spec.json`，供 `ccr` 和其它 spec-case 消费方使用。

## 安装

```bash
npm install @compforge/spec-case
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

普通 function、function-valued variable 和纯类型 symbol 使用 JSDoc marker，无需运行时 import。完整语法
与 symbol-id 规则见 [`spec/languages/typescript.md`](../../spec/languages/typescript.md)。

## 生成与检查

```bash
npx specgen <src-dir> -o spec.json --root <repo-root>
npx specgen <src-dir> -o spec.json --root <repo-root> --check
```

`specgen` 使用 TypeScript Compiler API 静态解析源码，不 import 或执行被扫描项目。
