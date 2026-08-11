import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Case, Link, Rule, Spec } from "../src/markers.js";
import { canonical, check, extractFile, extractTree } from "../src/specgen.js";

interface ConformanceFixture {
  cases: Array<{
    name: string;
    source: { typescript: string };
    symbol: { typescript: string };
    expected_entry: unknown;
  }>;
}

const DECORATOR_SAMPLE = `
class Service {
  @Spec("does useful work")
  @Case("happy", "succeeds", {
    input: "minimal",
    expect: "ok",
    forbid: "duplicate",
  })
  @Link("docs/design.md")
  @Rule("preserve ordering")
  run(): void {}
}
`;

test("extracts decorators from methods", () => {
  const out = extractFile(DECORATOR_SAMPLE, "src/service.ts");
  assert.deepEqual(out["src/service.ts::Service.run"], {
    specs: [
      {
        cases: [
          {
            id: "happy",
            desc: "succeeds",
            input: "minimal",
            expect: "ok",
            forbid: "duplicate",
          },
        ],
        spec: "does useful work",
        links: ["docs/design.md"],
        rules: ["preserve ordering"],
      },
    ],
  });
});

test("extracts JSDoc markers from ordinary functions and function values", () => {
  const source = `
/**
 * @spec creates a notebook
 * @case id=duplicate_name,desc="duplicate",expect="409",forbid="second row"
 * @see {@link ./docs/tenancy.md}
 * @rule watch synchronous DB calls
 */
export function createNotebook(): void {}

/** @spec loads a notebook */
export const loadNotebook = async (): Promise<void> => {};
`;
  const out = extractFile(source, "src/notebook.ts");
  const create = out["src/notebook.ts::createNotebook"]?.specs[0];
  assert.equal(create?.spec, "creates a notebook");
  assert.equal(create?.cases[0]?.id, "duplicate_name");
  assert.deepEqual(create?.links, ["docs/tenancy.md"]);
  assert.equal(
    out["src/notebook.ts::loadNotebook"]?.specs[0]?.spec,
    "loads a notebook",
  );
});

test("uses spec ids to distinguish overload contracts", () => {
  const source = `
/**
 * @spec id=string_input,text=\`parses string input\`
 * @case id=empty_string,desc=\`empty input\`,expect=\`empty output\`
 */
export function parse(value: string): string;
/** @spec id=number_input,text=\`parses number input\` */
export function parse(value: number): number;
export function parse(value: string | number): string | number { return value; }
`;
  const out = extractFile(source, "src/parse.ts");
  assert.deepEqual(out["src/parse.ts::parse"], {
    specs: [
      {
        id: "string_input",
        cases: [
          {
            id: "empty_string",
            desc: "empty input",
            expect: "empty output",
          },
        ],
        spec: "parses string input",
      },
      {
        id: "number_input",
        cases: [],
        spec: "parses number input",
      },
    ],
  });
});

test("requires ids when multiple declarations carry specs", () => {
  const source = `
/** @spec first overload */
export function parse(value: string): string;
/** @spec second overload */
export function parse(value: number): number;
export function parse(value: string | number): string | number { return value; }
`;
  assert.throws(
    () => extractFile(source, "src/parse.ts"),
    /each @spec must set a unique id/u,
  );
});

test("rejects duplicate spec ids for one symbol", () => {
  const source = `
/** @spec id=input,text=\`parses string input\` */
export function parse(value: string): string;
/** @spec id=input,text=\`parses number input\` */
export function parse(value: number): number;
export function parse(value: string | number): string | number { return value; }
`;
  assert.throws(
    () => extractFile(source, "src/parse.ts"),
    /duplicate spec id "input" for "src\/parse\.ts::parse"/u,
  );
});

test("rejects an invalid spec id", () => {
  const source = `
/** @spec id=String-Input,text=\`parses string input\` */
export function parse(value: string): string { return value; }
`;
  assert.throws(
    () => extractFile(source, "src/parse.ts"),
    /invalid spec id "String-Input" for "src\/parse\.ts::parse"/u,
  );
});

test("extracts JSDoc markers from types and interface methods", () => {
  const source = `
/** @rule request scoped only */
export type RequestCache = Map<string, unknown>;

export interface NotebookStore {
  /** @spec returns undefined when absent */
  get(id: string): unknown;
}
`;
  const out = extractFile(source, "src/types.ts");
  assert.deepEqual(out["src/types.ts::RequestCache"]?.specs[0]?.rules, [
    "request scoped only",
  ]);
  assert.equal(
    out["src/types.ts::NotebookStore.get"]?.specs[0]?.spec,
    "returns undefined when absent",
  );
});

test("runs the shared conformance fixture", async () => {
  const fixturePath = fileURLToPath(
    new URL("../../../../conformance/specgen/cases.json", import.meta.url),
  );
  const fixture = JSON.parse(
    await readFile(fixturePath, "utf8"),
  ) as ConformanceFixture;
  for (const item of fixture.cases) {
    const out = extractFile(item.source.typescript, "fixture.ts");
    assert.deepEqual(
      out[item.symbol.typescript] ?? null,
      item.expected_entry,
      item.name,
    );
  }
});

test("returns an empty index for syntax errors", () => {
  assert.deepEqual(extractFile("function (", "bad.ts"), {});
});

test("marker decorators do not replace classes or methods", () => {
  @Rule("request scoped only")
  class Example {
    @Spec("returns one")
    @Case("happy", "returns one")
    @Link("docs/example.md")
    run(): number {
      return 1;
    }
  }
  assert.equal(new Example().run(), 1);
});

test("decorator Spec accepts an explicit spec id", () => {
  const source = `
class Service {
  @Spec("looks up by string", { id: "string_input" })
  lookup(value: string): string { return value; }
}
`;
  assert.deepEqual(extractFile(source, "src/service.ts")[
    "src/service.ts::Service.lookup"
  ], {
    specs: [
      {
        id: "string_input",
        cases: [],
        spec: "looks up by string",
      },
    ],
  });
});

test("extracts trees and detects drift", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "spec-case-ts-"));
  const source = path.join(root, "src");
  await mkdir(source);
  await writeFile(
    path.join(source, "a.ts"),
    "/** @spec stable */\nexport function run(): void {}\n",
  );
  const index = await extractTree(source, root);
  assert.equal(index["src/a.ts::run"]?.specs[0]?.spec, "stable");

  const output = path.join(root, "spec.json");
  await writeFile(output, canonical(index));
  assert.equal(await check(output, index), 0);
  await writeFile(output, "{}\n");
  assert.equal(await check(output, index), 1);
});
