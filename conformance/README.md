# Conformance fixtures

`specgen/cases.json` defines language-neutral entry expectations with one source snippet per
language grammar. Every toolchain must run these cases in its own test suite so syntax can vary
without changing the generated `spec.json` semantics.

Language-specific parser edge cases remain in each toolchain's local tests.
