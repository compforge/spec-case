# Conformance fixtures

`specgen/cases.json` defines language-neutral entry expectations with one source snippet per
language grammar. Every toolchain must run these cases in its own test suite so syntax can vary
without changing the generated `spec.json` semantics.

Language-specific parser edge cases remain in each toolchain's local tests.
Anchored LinkRef cases are shared here because `repo://` / `component://` acceptance and rejection
must produce the same `spec.json` semantics in every language.
