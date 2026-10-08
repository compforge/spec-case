import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateHttpCase } from "../src/http.js";
import { caseHash, caseSetFromRaw, caseToRaw, type Case } from "../src/model.js";

const fixture = JSON.parse(readFileSync(new URL("../../../../conformance/case/http.json", import.meta.url), "utf8")) as { valid: Case[]; invalid: Case[] };
test("HTTP profile shares canonical serialization and validation across fixtures", () => {
  for (const value of fixture.valid) {
    validateHttpCase(value);
    const roundTrip = caseSetFromRaw({ caseset: "http", cases: [caseToRaw(value)] }).cases[0]!;
    validateHttpCase(roundTrip);
    assert.equal(caseHash(value), caseHash(roundTrip));
  }
  for (const value of fixture.invalid) assert.throws(() => validateHttpCase(value));
});
