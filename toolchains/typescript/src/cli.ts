#!/usr/bin/env node

import { promises as fs } from "node:fs";
import path from "node:path";
import { canonical, check, extractTree } from "./specgen.js";

interface Options {
  source: string;
  output: string;
  root?: string;
  check: boolean;
}

const USAGE =
  "usage: specgen [-o spec.json] [--root <repo-root>] [--check] <src-dir>";

function parseArgs(args: readonly string[]): Options | undefined {
  let output = "-";
  let root: string | undefined;
  let checkOnly = false;
  let source: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "-o" || arg === "--out") {
      output = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--root") {
      root = args[index + 1];
      index += 1;
    } else if (arg === "--check") {
      checkOnly = true;
    } else if (arg === "-h" || arg === "--help") {
      return undefined;
    } else if (arg?.startsWith("-")) {
      return undefined;
    } else if (source === undefined) {
      source = arg;
    } else {
      return undefined;
    }
  }
  if (source === undefined || output === "" || (checkOnly && output === "-")) {
    return undefined;
  }
  return { source, output, ...(root === undefined ? {} : { root }), check: checkOnly };
}

export async function main(args: readonly string[]): Promise<number> {
  const options = parseArgs(args);
  if (options === undefined) {
    console.error(USAGE);
    return 2;
  }
  const source = path.resolve(options.source);
  const root = path.resolve(options.root ?? source);
  let index;
  try {
    index = await extractTree(source, root);
  } catch (error) {
    console.error(
      `specgen: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  }
  if (options.check) {
    return check(options.output, index);
  }
  const rendered = canonical(index);
  if (options.output === "-") {
    process.stdout.write(rendered);
  } else {
    await fs.writeFile(options.output, rendered, "utf8");
    console.error(
      `specgen: ${Object.keys(index).length} symbol(s) -> ${options.output}`,
    );
  }
  return 0;
}

process.exitCode = await main(process.argv.slice(2));
