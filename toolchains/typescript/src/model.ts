import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { parse } from "yaml";

export const FACES = ["e2e", "eval", "perf", "trace"] as const;
export type Face = typeof FACES[number];
export const CASE_SCHEMA_VERSION = 1;

const CASE_ID_PATTERN = /^[a-z][a-z0-9_]*$/u;
const SYMBOL_ID_PATTERN = /^[^:]+::[^:]+$/u;
const FACE_SET = new Set<string>(FACES);

export interface FacetSpec {
  values?: readonly string[];
  ordered?: boolean;
  open?: boolean;
}

export interface Source {
  name: string;
  uri?: string;
  content?: string;
  meta?: Readonly<Record<string, unknown>>;
}

export interface Binding {
  symbol_id: string;
  spec_id?: string;
  spec?: string;
}

export type Judge = Partial<Record<Face, Readonly<Record<string, unknown>>>>;

export interface Case {
  id: string;
  input: Readonly<Record<string, unknown>>;
  desc?: string;
  facets?: Readonly<Record<string, string>>;
  requires?: readonly string[];
  judge?: Judge;
  binding?: Binding;
}

/** Canonical, runner-neutral CaseSet asset defined by spec/case.schema.json. */
export interface CaseSet {
  caseset: string;
  focus?: string;
  schema_version?: number;
  facets?: Readonly<Record<string, FacetSpec>>;
  sources?: readonly Source[];
  cases: readonly Case[];
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function optionalRecord(value: unknown, path: string): Record<string, unknown> {
  return value === undefined || value === null ? {} : record(value, path);
}

function strings(value: unknown, path: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${path} must be an array of strings`);
  }
  return [...value] as string[];
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${path} must be a boolean`);
  return value;
}

function stringRecord(value: unknown, path: string): Record<string, string> {
  const raw = optionalRecord(value, path);
  for (const [key, item] of Object.entries(raw)) {
    if (typeof item !== "string") throw new Error(`${path}.${key} must be a string`);
  }
  return raw as Record<string, string>;
}

function parseFacetSpec(value: unknown, path: string): FacetSpec {
  const raw = optionalRecord(value, path);
  return {
    ...(raw.values === undefined ? {} : { values: strings(raw.values, `${path}.values`) }),
    ...(raw.ordered === undefined ? {} : { ordered: boolean(raw.ordered, `${path}.ordered`) }),
    ...(raw.open === undefined ? {} : { open: boolean(raw.open, `${path}.open`) }),
  };
}

function parseCase(value: unknown, index: number): Case {
  const raw = record(value, `cases[${index}]`);
  const judgeRaw = optionalRecord(raw.judge, `cases[${index}].judge`);
  const judge = Object.fromEntries(Object.entries(judgeRaw).map(([face, criteria]) => (
    [face, record(criteria, `cases[${index}].judge.${face}`)]
  ))) as Judge;
  const bindingRaw = raw.binding === undefined
    ? undefined
    : record(raw.binding, `cases[${index}].binding`);
  return {
    id: typeof raw.id === "string" ? raw.id : "",
    input: optionalRecord(raw.input, `cases[${index}].input`),
    ...(typeof raw.desc === "string" && raw.desc ? { desc: raw.desc } : {}),
    facets: stringRecord(raw.facets, `cases[${index}].facets`),
    requires: strings(raw.requires, `cases[${index}].requires`),
    judge,
    ...(bindingRaw ? {
      binding: {
        symbol_id: typeof bindingRaw.symbol_id === "string" ? bindingRaw.symbol_id : "",
        ...(typeof bindingRaw.spec_id === "string" ? { spec_id: bindingRaw.spec_id } : {}),
        ...(typeof bindingRaw.spec === "string" ? { spec: bindingRaw.spec } : {}),
      },
    } : {}),
  };
}

export function caseSetFromRaw(value: unknown): CaseSet {
  const raw = record(value, "CaseSet");
  const facetsRaw = optionalRecord(raw.facets, "facets");
  const sourcesRaw = raw.sources ?? [];
  const casesRaw = raw.cases ?? [];
  if (!Array.isArray(sourcesRaw)) throw new Error("sources must be an array");
  if (!Array.isArray(casesRaw)) throw new Error("cases must be an array");
  return {
    caseset: typeof raw.caseset === "string" ? raw.caseset : "",
    ...(typeof raw.focus === "string" && raw.focus ? { focus: raw.focus } : {}),
    schema_version: typeof raw.schema_version === "number"
      ? raw.schema_version
      : CASE_SCHEMA_VERSION,
    facets: Object.fromEntries(Object.entries(facetsRaw).map(([name, spec]) => (
      [name, parseFacetSpec(spec, `facets.${name}`)]
    ))),
    sources: sourcesRaw.map((value, index) => {
      const source = record(value, `sources[${index}]`);
      return {
        name: typeof source.name === "string" ? source.name : "",
        ...(typeof source.uri === "string" ? { uri: source.uri } : {}),
        ...(typeof source.content === "string" ? { content: source.content } : {}),
        meta: optionalRecord(source.meta, `sources[${index}].meta`),
      };
    }),
    cases: casesRaw.map(parseCase),
  };
}

export function parseCaseSet(source: string): CaseSet {
  return caseSetFromRaw(parse(source));
}

export function loadCaseSet(path: string): CaseSet {
  return parseCaseSet(readFileSync(path, "utf8"));
}

export function caseToRaw(item: Case): Record<string, unknown> {
  return {
    id: item.id,
    input: { ...item.input },
    ...(item.desc ? { desc: item.desc } : {}),
    ...(item.facets && Object.keys(item.facets).length > 0
      ? { facets: { ...item.facets } }
      : {}),
    ...(item.requires && item.requires.length > 0 ? { requires: [...item.requires] } : {}),
    ...(item.judge && Object.keys(item.judge).length > 0
      ? { judge: Object.fromEntries(Object.entries(item.judge).map(([face, criteria]) => (
        [face, { ...criteria }]
      ))) }
      : {}),
    ...(item.binding ? {
      binding: {
        symbol_id: item.binding.symbol_id,
        ...(item.binding.spec_id === undefined ? {} : { spec_id: item.binding.spec_id }),
        ...(item.binding.spec ? { spec: item.binding.spec } : {}),
      },
    } : {}),
  };
}

/** Return the canonical wire shape used for run snapshots and YAML/JSON serialization. */
export function caseSetToRaw(caseSet: CaseSet): Record<string, unknown> {
  return {
    caseset: caseSet.caseset,
    ...(caseSet.focus ? { focus: caseSet.focus } : {}),
    ...(caseSet.schema_version === undefined
      ? {}
      : { schema_version: caseSet.schema_version }),
    ...(caseSet.facets && Object.keys(caseSet.facets).length > 0
      ? { facets: Object.fromEntries(Object.entries(caseSet.facets).map(([name, spec]) => (
        [name, {
          ...(spec.values === undefined ? {} : { values: [...spec.values] }),
          ...(spec.ordered === undefined ? {} : { ordered: spec.ordered }),
          ...(spec.open === undefined ? {} : { open: spec.open }),
        }]
      ))) }
      : {}),
    ...(caseSet.sources && caseSet.sources.length > 0
      ? { sources: caseSet.sources.map((source) => ({
        name: source.name,
        ...(source.uri === undefined ? {} : { uri: source.uri }),
        ...(source.content === undefined ? {} : { content: source.content }),
        ...(source.meta && Object.keys(source.meta).length > 0 ? { meta: { ...source.meta } } : {}),
      })) }
      : {}),
    cases: caseSet.cases.map(caseToRaw),
  };
}

/**
 * @spec Every Case keeps one stable CaseSet-local id; facets, sources, judge faces, and bindings resolve inside the same canonical asset.
 * @see {@link ../../../spec/case.schema.json}
 */
export function validateCaseSet(caseSet: CaseSet): void {
  if (!caseSet.caseset) throw new Error("CaseSet has an empty caseset id");
  const facets = caseSet.facets ?? {};
  for (const [name, spec] of Object.entries(facets)) {
    if ((!spec.values || spec.values.length === 0) && !spec.open) {
      throw new Error(`facet ${name} must declare non-empty values or be open`);
    }
    if (spec.ordered && (!spec.values || spec.values.length === 0)) {
      throw new Error(`facet ${name}: ordered requires values`);
    }
  }

  const sourceNames = new Set<string>();
  for (const source of caseSet.sources ?? []) {
    if (!source.name) throw new Error("source with empty name");
    if (sourceNames.has(source.name)) throw new Error(`duplicate source name: ${source.name}`);
    sourceNames.add(source.name);
    if ((source.uri === undefined) === (source.content === undefined)) {
      throw new Error(`source '${source.name}' needs exactly one of uri or content`);
    }
  }

  const caseIds = new Set<string>();
  for (const item of caseSet.cases) {
    if (!CASE_ID_PATTERN.test(item.id)) throw new Error(`case with invalid id: '${item.id}'`);
    if (caseIds.has(item.id)) throw new Error(`duplicate case id: ${item.id}`);
    caseIds.add(item.id);
    for (const [facet, value] of Object.entries(item.facets ?? {})) {
      const spec = facets[facet];
      if (!spec) throw new Error(`case ${item.id}: unknown facet '${facet}'`);
      if (spec.values && !spec.open && !spec.values.includes(value)) {
        throw new Error(`case ${item.id}: facet ${facet}='${value}' not in declared values`);
      }
    }
    for (const source of item.requires ?? []) {
      if (!sourceNames.has(source)) {
        throw new Error(`case ${item.id}: requires unknown source '${source}'`);
      }
    }
    for (const face of Object.keys(item.judge ?? {})) {
      if (!FACE_SET.has(face)) throw new Error(`case ${item.id}: unknown judge face '${face}'`);
    }
    if (item.binding && !SYMBOL_ID_PATTERN.test(item.binding.symbol_id)) {
      throw new Error(`case ${item.id}: invalid binding symbol_id '${item.binding.symbol_id}'`);
    }
    if (item.binding?.spec_id && !CASE_ID_PATTERN.test(item.binding.spec_id)) {
      throw new Error(`case ${item.id}: invalid binding spec_id '${item.binding.spec_id}'`);
    }
  }
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => [key, canonical(item)]));
}

export function caseHash(item: Case): string {
  const payload = canonical({
    id: item.id,
    input: item.input,
    facets: item.facets ?? {},
    requires: [...(item.requires ?? [])].sort(),
    judge: item.judge ?? {},
  });
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 8);
}

export function sourceKey(source: Source): string {
  return createHash("sha256").update(source.content ?? source.uri ?? "").digest("hex").slice(0, 16);
}
