import { validateCase, type Case } from "./model.js";

/** Stable stimulus; resolved URLs and credentials belong to the execution target. */
export interface HttpInput extends Readonly<Record<string, unknown>> {
  readonly protocol: "http";
  readonly method: "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS";
  readonly path?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
}

export interface HttpExpectation extends Readonly<Record<string, unknown>> {
  readonly status: readonly number[];
  readonly contentType?: string;
}

/** Canonical Case specialization, with optional observation-only HTTP execution. */
export interface HttpCase extends Case {
  input: HttpInput;
  judge?: NonNullable<Case["judge"]> & { e2e?: Readonly<Record<string, unknown>> & { http?: HttpExpectation } };
}

/** @spec The HTTP profile refines canonical input and judge.e2e.http without changing Case identity. */
export function validateHttpCase(value: Case): asserts value is HttpCase {
  validateCase(value);
  const input = value.input;
  if (input.protocol !== "http") throw new Error("HTTP Case input.protocol must be http");
  if (typeof input.method !== "string" || !["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"].includes(input.method)) throw new Error("Invalid HTTP Case method");
  if (Object.keys(input).some(key => !["protocol", "method", "path", "headers", "body"].includes(key))) throw new Error("Unknown HTTP Case input field; targets belong to execution");
  if (input.path !== undefined && (typeof input.path !== "string" || !input.path.startsWith("/") || input.path.startsWith("//") || /[\\\x00-\x1f\x7f]/.test(input.path))) throw new Error("HTTP Case path must be origin-relative");
  if (input.body !== undefined && typeof input.body !== "string") throw new Error("HTTP Case body must be a string");
  if (input.headers !== undefined) {
    if (!input.headers || typeof input.headers !== "object" || Array.isArray(input.headers)) throw new Error("Invalid HTTP Case headers");
    for (const [key, header] of Object.entries(input.headers)) {
      if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(key) || typeof header !== "string" || /[\r\n]/.test(header)) throw new Error("Invalid HTTP Case header");
      if (/^(authorization|proxy-authorization|cookie|host|x-api-key)$/i.test(key)) throw new Error("HTTP Case credentials and host belong to execution target headers");
    }
  }
  const expect = value.judge?.e2e?.http as HttpExpectation | undefined;
  if (expect !== undefined) {
    if (!expect || typeof expect !== "object" || Array.isArray(expect)
      || Object.keys(expect).some(key => !["status", "contentType"].includes(key))
      || !Array.isArray(expect.status) || !expect.status.length
      || expect.status.some(status => !Number.isInteger(status) || status < 100 || status > 599)) throw new Error("Invalid HTTP Case expected status");
    if (expect.contentType !== undefined && (typeof expect.contentType !== "string" || !expect.contentType.trim())) throw new Error("Invalid HTTP Case expected contentType");
  }
}
