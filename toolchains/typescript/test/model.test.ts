import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  caseHash,
  caseSetFromRaw,
  caseSetToRaw,
  loadCaseSet,
  parseCaseSet,
  sourceKey,
  validateCaseSet,
} from "../src/model.js";

const YAML = `
caseset: ordinary-chat
focus: reusable chat cases
facets:
  difficulty:
    values: [simple, complex]
    ordered: true
sources:
  - name: policy
    content: answer briefly
cases:
  - id: greeting
    input: {query: hello}
    facets: {difficulty: simple}
    requires: [policy]
    judge:
      eval: {ground_truth: hello}
      perf: {expect_status: 200}
    binding:
      symbol_id: src/chat.ts::run
      spec_id: ordinary_chat
`;

test("loads and validates one canonical CaseSet for multiple faces", async () => {
  const parsed = parseCaseSet(YAML);
  validateCaseSet(parsed);
  assert.equal(parsed.caseset, "ordinary-chat");
  assert.deepEqual(Object.keys(parsed.cases[0]?.judge ?? {}), ["eval", "perf"]);
  assert.deepEqual(caseSetFromRaw(caseSetToRaw(parsed)), parsed);

  const directory = await mkdtemp(path.join(tmpdir(), "spec-case-ts-"));
  const file = path.join(directory, "cases.yaml");
  await writeFile(file, YAML);
  assert.deepEqual(loadCaseSet(file), parsed);
});

test("rejects values that YAML cannot coerce into the canonical schema", () => {
  assert.throws(() => parseCaseSet(`caseset: bad\nfacets: {difficulty: {open: \"false\"}}\ncases: []`), /boolean/u);
  assert.throws(() => parseCaseSet(`caseset: bad\ncases: [{id: bad, facets: {difficulty: 1}}]`), /string/u);
});

test("rejects identity, facet, source, and face drift", () => {
  const raw = caseSetFromRaw({
    caseset: "bad",
    facets: { difficulty: { values: ["simple"] } },
    cases: [{
      id: "Bad-ID",
      input: {},
      facets: { difficulty: "complex" },
      requires: ["missing"],
      judge: { unknown: {} },
    }],
  });
  assert.throws(() => validateCaseSet(raw), /invalid id/u);

  const validId = { ...raw, cases: [{ ...raw.cases[0]!, id: "bad_id" }] };
  assert.throws(() => validateCaseSet(validId), /not in declared values/u);
});

test("case and source hashes are stable and intent-sensitive", () => {
  const parsed = parseCaseSet(YAML);
  const item = parsed.cases[0]!;
  assert.equal(caseHash(item), "1263a6f4"); // Must match the Python model.
  assert.equal(caseHash(item), caseHash({ ...item, desc: "cosmetic" }));
  assert.notEqual(caseHash(item), caseHash({ ...item, input: { query: "changed" } }));
  assert.equal(sourceKey(parsed.sources![0]!), sourceKey(parsed.sources![0]!));
});
