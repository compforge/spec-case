# TypeScript：spec/case 表达

TypeScript 提供两种代码优先前端，共用同一个 `specgen` 和 `spec.json` 契约：class / method 使用
标准 decorator；普通 function、function-valued variable 和纯类型符号使用 JSDoc marker。两种形式都由
TypeScript Compiler API 静态抽取，不 import 或执行被扫描代码。

## Decorator 语法

```typescript
import { Case, Link, Rule, Spec } from "@compforge/spec-case";

class NotebookService {
  @Spec("tenant/user header 必填；同名 notebook 不可重复创建")
  @Case("happy_minimal", "只传 Name 应创建成功", {
    expect: "201; body.id 非空",
  })
  @Case("duplicate_name", "重复 Name", {
    expect: "409",
    forbid: "写入第二条记录",
  })
  @Link("docs/tenancy.md")
  @Rule("请求热路径，评审时留意新增的同步 DB 调用")
  async createNotebook(req: CreateRequest): Promise<Notebook> {
    // ...
  }
}
```

- `@Spec(text, options?)` — symbol 的契约前言；`options.id` 可选，用于区分同一 symbol 的多个契约。
- `@Case(id, desc, options?)` — 0..N 个；`options` 支持 `input` / `expect` / `forbid`。
- `@Link(ref)` — 0..N 个，指向仓库相对 md 路径或另一 symbol-id。
- `@Rule(text)` — 0..N 个，修改或使用该 symbol 时应检查的准则。

TypeScript 的 `case` 是保留字，因此 decorator 采用语言惯用的 PascalCase 名称。包内实现都是 no-op：
decorator 不替换 class 或 method，语义仅由 `specgen` 静态读取。

## JSDoc 语法

普通函数无需改写为 class method，也不需要引入运行时 marker：

```typescript
/**
 * @spec tenant/user header 必填；同名 notebook 不可重复创建
 * @case id=happy_minimal,desc=`只传 Name 应创建成功`,expect=`201; body.id 非空`
 * @case id=duplicate_name,desc=`重复 Name`,expect=`409`,forbid=`写入第二条记录`
 * @see {@link ./docs/tenancy.md}
 * @rule 请求热路径，评审时留意新增的同步 DB 调用
 */
export async function createNotebook(
  req: CreateRequest,
): Promise<Notebook> {
  // ...
}
```

- `@spec <text>`、`@rule <text>` 使用 tag 后的自然语言文本。需要显式 spec id 时写
  `@spec id=string_input,text=\`只处理字符串输入\``。
- `@case key=value,...` 与 Go marker 共用字段词汇；含逗号的值用反引号或双引号包裹，`id` 必须匹配
  `^[a-z][a-z0-9_]*$`。
- link 采用 TypeScript/TSDoc 熟悉的 `@see {@link <ref>}` 形态，抽取后仍写入 `links[]`。

JSDoc marker 可挂在 function declaration、单变量声明的 arrow/function expression、class、interface、
type alias、class method / function-valued property 和 interface method 上。

## 绑定（symbol-id）

| 符号 | symbol-id |
|---|---|
| function `createNotebook` @ `src/notebook.ts` | `src/notebook.ts::createNotebook` |
| const arrow `loadNotebook` @ `src/notebook.ts` | `src/notebook.ts::loadNotebook` |
| method `NotebookService.createNotebook` | `src/notebook.ts::NotebookService.createNotebook` |
| type alias / interface `RequestContext` | `src/types.ts::RequestContext` |
| interface method `NotebookStore.get` | `src/store.ts::NotebookStore.get` |

function expression 自带的内部名字不参与身份；function-valued variable 始终使用外层 binding name。namespace
内的 symbol 以 `Namespace.Symbol` 作为 symbol 部分。首版 TypeScript toolchain 不生成可选 `fqn`：npm
package exports、tsconfig paths 与源码路径之间没有统一映射，先保留仓内 symbol-id，避免制造不稳定身份。

TypeScript overload 的多个声明仍共享同一个 symbol-id。通常只写一份 spec；需要分别描述各 overload 时，
每个带 marker 的声明必须提供唯一 spec id：

```typescript
/** @spec id=string_input,text=`处理字符串输入` */
export function parse(value: string): string;
/** @spec id=number_input,text=`处理数字输入` */
export function parse(value: number): number;
export function parse(value: string | number): string | number;
```

所有生成 entry 都使用 `specs[]`。上例以 `src/parser.ts::parse` 为唯一 symbol-id，并在该 entry 的
`specs[]` 中保留两个命名契约。
同一 symbol 出现多个 spec 时，缺少 id 或 id 重复都会让 `specgen` 报错，禁止静默覆盖。

## 抽取与漂移门

```bash
npm install @compforge/spec-case
npx specgen <src-dir> -o spec.json --root <repo-root>
npx specgen <src-dir> -o spec.json --root <repo-root> --check
```

`specgen` 只读取字面量：decorator 别名、变量拼接、template interpolation 和计算属性不会被求值。
扫描覆盖 `.ts` / `.tsx` / `.mts` / `.cts` 及对应 JavaScript 扩展，忽略声明文件、`node_modules`、
`dist` 和 `coverage`。
