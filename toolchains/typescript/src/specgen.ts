import { promises as fs } from "node:fs";
import path from "node:path";
import ts from "typescript";

const CASE_ID_PATTERN = /^[a-z][a-z0-9_]*$/;
const JSDOC_MARKERS = new Map([
  ["spec", "spec"],
  ["case", "case"],
  ["link", "link"],
  ["see", "link"],
  ["rule", "rule"],
]);
const DECORATOR_MARKERS = new Map([
  ["Spec", "spec"],
  ["Case", "case"],
  ["Link", "link"],
  ["Rule", "rule"],
]);
const SKIPPED_DIRECTORIES = new Set([
  ".git",
  "coverage",
  "dist",
  "node_modules",
]);

export interface SpecCase {
  id: string;
  desc?: string;
  input?: string;
  expect?: string;
  forbid?: string;
}

export interface SpecEntry {
  spec?: string;
  cases: SpecCase[];
  links?: string[];
  rules?: string[];
}

export type SpecIndex = Record<string, SpecEntry>;

function collapseWhitespace(text: string): string {
  return text.split(/\s+/u).filter(Boolean).join(" ");
}

function literalText(node: ts.Expression | undefined): string {
  if (
    node !== undefined &&
    (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
  ) {
    return collapseWhitespace(node.text);
  }
  return "";
}

function markerName(expression: ts.LeftHandSideExpression): string | undefined {
  if (ts.isIdentifier(expression)) {
    return DECORATOR_MARKERS.get(expression.text);
  }
  if (ts.isPropertyAccessExpression(expression)) {
    return DECORATOR_MARKERS.get(expression.name.text);
  }
  return undefined;
}

function objectString(
  expression: ts.Expression | undefined,
  key: string,
): string {
  if (expression === undefined || !ts.isObjectLiteralExpression(expression)) {
    return "";
  }
  for (const property of expression.properties) {
    if (!ts.isPropertyAssignment(property)) {
      continue;
    }
    const name = propertyName(property.name);
    if (name === key) {
      return literalText(property.initializer);
    }
  }
  return "";
}

function propertyName(name: ts.PropertyName): string | undefined {
  if (
    ts.isIdentifier(name) ||
    ts.isStringLiteral(name) ||
    ts.isNumericLiteral(name) ||
    ts.isPrivateIdentifier(name)
  ) {
    return name.text;
  }
  return undefined;
}

function parseMarkerArgs(source: string): Record<string, string> {
  const args: Record<string, string> = {};
  let index = 0;
  while (index < source.length) {
    while (
      index < source.length &&
      (source[index] === "," || /\s/u.test(source[index] ?? ""))
    ) {
      index += 1;
    }
    const keyStart = index;
    while (index < source.length && source[index] !== "=") {
      index += 1;
    }
    if (index >= source.length) {
      break;
    }
    const key = source.slice(keyStart, index).trim();
    index += 1;

    let value = "";
    const quote = source[index];
    if (quote === '"' || quote === "`") {
      index += 1;
      const valueStart = index;
      while (index < source.length && source[index] !== quote) {
        index += 1;
      }
      value = source.slice(valueStart, index);
      if (index < source.length) {
        index += 1;
      }
    } else {
      const valueStart = index;
      while (index < source.length && source[index] !== ",") {
        index += 1;
      }
      value = source.slice(valueStart, index).trim();
    }
    if (key !== "") {
      args[key] = value;
    }
  }
  return args;
}

function emptyEntry(): SpecEntry {
  return { cases: [] };
}

function hasContent(entry: SpecEntry): boolean {
  return Boolean(
    entry.spec ||
      entry.cases.length > 0 ||
      entry.links?.length ||
      entry.rules?.length,
  );
}

function appendLink(entry: SpecEntry, ref: string): void {
  if (ref === "") {
    return;
  }
  (entry.links ??= []).push(ref);
}

function appendRule(entry: SpecEntry, text: string): void {
  if (text === "") {
    return;
  }
  (entry.rules ??= []).push(text);
}

function jsDocComment(tag: ts.JSDocTag): string {
  if (tag.comment === undefined) {
    return "";
  }
  if (typeof tag.comment === "string") {
    return collapseWhitespace(tag.comment);
  }
  return collapseWhitespace(
    [...tag.comment]
      .map((part) =>
        "text" in part && typeof part.text === "string" ? part.text : "",
      )
      .join(" "),
  );
}

function jsDocLink(tag: ts.JSDocTag): string {
  if (tag.comment === undefined || typeof tag.comment === "string") {
    return jsDocComment(tag).replace(/^\.\//u, "");
  }
  const link = [...tag.comment].find(ts.isJSDocLinkLike);
  if (link === undefined) {
    return jsDocComment(tag).replace(/^\.\//u, "");
  }
  const match = /^\{@(?:link|linkcode|linkplain)\s+([^|}]+)/u.exec(
    link.getText(),
  );
  return (match?.[1] ?? "").trim().replace(/^\.\//u, "");
}

function applyJSDocMarkers(node: ts.Node, entry: SpecEntry): void {
  for (const tag of ts.getJSDocTags(node)) {
    const name = JSDOC_MARKERS.get(tag.tagName.text);
    if (name === undefined || tag.comment === undefined) {
      continue;
    }
    const comment = name === "link" ? jsDocLink(tag) : jsDocComment(tag);
    if (name === "spec") {
      if (comment !== "") {
        entry.spec = comment;
      }
    } else if (name === "case") {
      const args = parseMarkerArgs(comment);
      const id = args.id ?? "";
      if (!CASE_ID_PATTERN.test(id)) {
        continue;
      }
      const item: SpecCase = { id };
      for (const key of ["desc", "input", "expect", "forbid"] as const) {
        const value = args[key];
        if (value !== undefined && value !== "") {
          item[key] = collapseWhitespace(value);
        }
      }
      entry.cases.push(item);
    } else if (name === "link") {
      appendLink(entry, comment);
    } else if (name === "rule") {
      appendRule(entry, comment);
    }
  }
}

function applyDecoratorMarkers(node: ts.Node, entry: SpecEntry): void {
  if (!ts.canHaveDecorators(node)) {
    return;
  }
  for (const decorator of ts.getDecorators(node) ?? []) {
    if (!ts.isCallExpression(decorator.expression)) {
      continue;
    }
    const call = decorator.expression;
    const name = markerName(call.expression);
    if (name === undefined) {
      continue;
    }
    if (name === "spec") {
      const text = literalText(call.arguments[0]);
      if (text !== "") {
        entry.spec = text;
      }
    } else if (name === "case") {
      const id = literalText(call.arguments[0]);
      if (!CASE_ID_PATTERN.test(id)) {
        continue;
      }
      const item: SpecCase = { id };
      const desc = literalText(call.arguments[1]);
      if (desc !== "") {
        item.desc = desc;
      }
      for (const key of ["input", "expect", "forbid"] as const) {
        const value = objectString(call.arguments[2], key);
        if (value !== "") {
          item[key] = value;
        }
      }
      entry.cases.push(item);
    } else if (name === "link") {
      appendLink(entry, literalText(call.arguments[0]));
    } else if (name === "rule") {
      appendRule(entry, literalText(call.arguments[0]));
    }
  }
}

function entryFor(...nodes: ts.Node[]): SpecEntry | undefined {
  const entry = emptyEntry();
  for (const node of nodes) {
    applyJSDocMarkers(node, entry);
    applyDecoratorMarkers(node, entry);
  }
  return hasContent(entry) ? entry : undefined;
}

function declarationName(name: ts.DeclarationName | undefined): string | undefined {
  if (
    name !== undefined &&
    (ts.isIdentifier(name) ||
      ts.isStringLiteral(name) ||
      ts.isNumericLiteral(name) ||
      ts.isPrivateIdentifier(name))
  ) {
    return name.text;
  }
  return undefined;
}

function isFunctionValue(node: ts.Expression | undefined): boolean {
  return (
    node !== undefined &&
    (ts.isArrowFunction(node) || ts.isFunctionExpression(node))
  );
}

function qualified(stack: readonly string[], name: string): string {
  return [...stack, name].join(".");
}

function emit(
  out: SpecIndex,
  relpath: string,
  symbol: string,
  entry: SpecEntry | undefined,
): void {
  if (entry !== undefined) {
    out[`${relpath}::${symbol}`] = entry;
  }
}

function visitClass(
  node: ts.ClassDeclaration,
  stack: readonly string[],
  relpath: string,
  out: SpecIndex,
): void {
  if (node.name === undefined) {
    return;
  }
  const className = qualified(stack, node.name.text);
  emit(out, relpath, className, entryFor(node));
  for (const member of node.members) {
    if (
      !ts.isMethodDeclaration(member) &&
      !(
        ts.isPropertyDeclaration(member) &&
        isFunctionValue(member.initializer)
      )
    ) {
      continue;
    }
    const name = declarationName(member.name);
    if (name !== undefined) {
      emit(out, relpath, `${className}.${name}`, entryFor(member));
    }
  }
}

function visitInterface(
  node: ts.InterfaceDeclaration,
  stack: readonly string[],
  relpath: string,
  out: SpecIndex,
): void {
  const interfaceName = qualified(stack, node.name.text);
  emit(out, relpath, interfaceName, entryFor(node));
  for (const member of node.members) {
    if (!ts.isMethodSignature(member)) {
      continue;
    }
    const name = declarationName(member.name);
    if (name !== undefined) {
      emit(out, relpath, `${interfaceName}.${name}`, entryFor(member));
    }
  }
}

function visitStatements(
  statements: ts.NodeArray<ts.Statement>,
  stack: readonly string[],
  relpath: string,
  out: SpecIndex,
): void {
  for (const statement of statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name !== undefined) {
      emit(
        out,
        relpath,
        qualified(stack, statement.name.text),
        entryFor(statement),
      );
    } else if (ts.isClassDeclaration(statement)) {
      visitClass(statement, stack, relpath, out);
    } else if (ts.isInterfaceDeclaration(statement)) {
      visitInterface(statement, stack, relpath, out);
    } else if (ts.isTypeAliasDeclaration(statement)) {
      emit(
        out,
        relpath,
        qualified(stack, statement.name.text),
        entryFor(statement),
      );
    } else if (
      ts.isVariableStatement(statement) &&
      statement.declarationList.declarations.length === 1
    ) {
      const declaration = statement.declarationList.declarations[0];
      if (
        declaration !== undefined &&
        ts.isIdentifier(declaration.name) &&
        isFunctionValue(declaration.initializer)
      ) {
        emit(
          out,
          relpath,
          qualified(stack, declaration.name.text),
          entryFor(statement, declaration),
        );
      }
    } else if (ts.isModuleDeclaration(statement)) {
      const name = statement.name.text;
      const body = statement.body;
      if (body !== undefined && ts.isModuleBlock(body)) {
        visitStatements(body.statements, [...stack, name], relpath, out);
      }
    }
  }
}

function scriptKind(relpath: string): ts.ScriptKind {
  if (relpath.endsWith(".tsx")) {
    return ts.ScriptKind.TSX;
  }
  if (relpath.endsWith(".js") || relpath.endsWith(".mjs")) {
    return ts.ScriptKind.JS;
  }
  if (relpath.endsWith(".jsx")) {
    return ts.ScriptKind.JSX;
  }
  return ts.ScriptKind.TS;
}

export function extractFile(source: string, relpath: string): SpecIndex {
  const sourceFile = ts.createSourceFile(
    relpath,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(relpath),
  );
  const parsed = sourceFile as ts.SourceFile & {
    parseDiagnostics: readonly ts.Diagnostic[];
  };
  if (parsed.parseDiagnostics.length > 0) {
    return {};
  }
  const out: SpecIndex = {};
  visitStatements(sourceFile.statements, [], relpath, out);
  return out;
}

function isSourceFile(name: string): boolean {
  return (
    /\.(?:[cm]?ts|tsx|[cm]?js|jsx)$/u.test(name) &&
    !/\.d\.[cm]?ts$/u.test(name)
  );
}

async function sourceFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  async function walk(directory: string): Promise<void> {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) {
          await walk(fullPath);
        }
      } else if (entry.isFile() && isSourceFile(entry.name)) {
        files.push(fullPath);
      }
    }
  }
  await walk(root);
  return files;
}

export async function extractTree(
  sourceRoot: string,
  repositoryRoot: string,
): Promise<SpecIndex> {
  const out: SpecIndex = {};
  for (const file of await sourceFiles(sourceRoot)) {
    let source: string;
    try {
      source = await fs.readFile(file, "utf8");
    } catch {
      continue;
    }
    const relpath = path.relative(repositoryRoot, file).split(path.sep).join("/");
    Object.assign(out, extractFile(source, relpath));
  }
  return out;
}

function sortedValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortedValue);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, sortedValue(item)]),
    );
  }
  return value;
}

export function canonical(value: unknown): string {
  return `${JSON.stringify(sortedValue(value), null, 2)}\n`;
}

export async function check(output: string, fresh: SpecIndex): Promise<number> {
  let committed: unknown;
  try {
    committed = JSON.parse(await fs.readFile(output, "utf8"));
  } catch (error) {
    console.error(
      `specgen --check: ${output} cannot be read as JSON: ${String(error)}`,
    );
    return 1;
  }
  if (canonical(committed) === canonical(fresh)) {
    console.error(
      `specgen --check: ${output} is up to date (${Object.keys(fresh).length} symbol(s))`,
    );
    return 0;
  }

  console.error(
    `specgen --check: ${output} is out of date — run specgen to regenerate:`,
  );
  const committedIndex = committed as Record<string, unknown>;
  const committedIDs = new Set(Object.keys(committedIndex));
  const freshIDs = new Set(Object.keys(fresh));
  for (const id of [...freshIDs].filter((item) => !committedIDs.has(item)).sort()) {
    console.error(`  + ${id}  (marked in code, missing from spec.json)`);
  }
  for (const id of [...committedIDs].filter((item) => !freshIDs.has(item)).sort()) {
    console.error(
      `  - ${id}  (in spec.json, but no such marked symbol — renamed/removed)`,
    );
  }
  for (const id of [...freshIDs].filter((item) => committedIDs.has(item)).sort()) {
    if (canonical(committedIndex[id]) !== canonical(fresh[id])) {
      console.error(`  ~ ${id}  (markers changed)`);
    }
  }
  return 1;
}
