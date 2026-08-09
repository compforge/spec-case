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
  assert.equal(out["src/notebook.ts::createNotebook"]?.spec, "creates a notebook");
  assert.equal(
    out["src/notebook.ts::createNotebook"]?.cases[0]?.id,
    "duplicate_name",
  );
  assert.deepEqual(out["src/notebook.ts::createNotebook"]?.links, [
    "docs/tenancy.md",
  ]);
  assert.equal(out["src/notebook.ts::loadNotebook"]?.spec, "loads a notebook");
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
  assert.deepEqual(out["src/types.ts::RequestCache"]?.rules, [
    "request scoped only",
  ]);
  assert.equal(
    out["src/types.ts::NotebookStore.get"]?.spec,
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

test("extracts trees and detects drift", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "spec-case-ts-"));
  const source = path.join(root, "src");
  await mkdir(source);
  await writeFile(
    path.join(source, "a.ts"),
    "/** @spec stable */\nexport function run(): void {}\n",
  );
  const index = await extractTree(source, root);
  assert.equal(index["src/a.ts::run"]?.spec, "stable");

  const output = path.join(root, "spec.json");
  await writeFile(output, canonical(index));
  assert.equal(await check(output, index), 0);
  await writeFile(output, "{}\n");
  assert.equal(await check(output, index), 1);
});
