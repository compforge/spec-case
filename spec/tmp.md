# Tmp marker

`tmp` binds a temporary implementation measure and its exit condition to a code symbol.
It can appear without `spec`, and a declaration may have multiple `tmp` markers in source order.
The generated review projection contains `specs[].tmps`, an array of objects:

```json
{"text": "keep legacy conversion", "until": "all supported clients use v2"}
```

Both fields are required nonempty natural-language strings. `text` describes the measure;
`until` states a verifiable condition for removing or replacing it. Whitespace is collapsed
within each field. Extraction accepts literal values only; incomplete, blank, or unresolved
markers are ignored, following the existing marker extraction convention. No partial `tmp`
object is emitted. Unknown argument fields do not enter the projection.

The marker describes implementation lifetime. It does not waive the current `spec`, execute
cleanup, or declare an unmarked implementation permanent. Consumers need evidence that the
exit condition holds before proposing removal. `why` explains the current choice; `ideal`
records the target shape; supporting references use `link`.

`tmp` belongs to the white-box `spec.json` projection. It does not alter canonical CaseSet,
participate in `case_hash`, or change runtime behavior. `specgen --check` detects changes to
either field in the generated projection. Naming a marker does not itself implement handling
in a consuming reviewer.
