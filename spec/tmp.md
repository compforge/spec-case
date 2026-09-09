# Tmp marker

`tmp` binds a temporary implementation measure and an optional exit condition to a code symbol.
It can appear without `spec`, and a declaration may have multiple `tmp` markers in source order.
The generated review projection contains `specs[].tmps`, an array of objects:

```json
{"text": "keep legacy conversion", "until": "all supported clients use v2"}
```

`text` is a required nonempty natural-language string describing the measure.
`until` is optional and states a verifiable condition for removing or replacing it when known.
A marker without an exit condition projects as `{"text": "keep legacy conversion"}`.
Whitespace is collapsed within each field. Extraction accepts literal values only:
missing, blank, or unresolved `text` causes the marker to be ignored; missing, blank, or
unresolved `until` is omitted while the measure is retained. Unknown argument fields do
not enter the projection.

The marker describes implementation lifetime. It does not waive the current `spec`, execute
cleanup, or declare an unmarked implementation permanent. Consumers need evidence before
proposing removal; when an exit condition is provided, check that it holds. An absent condition
does not authorize removal. `why` explains the current choice; `ideal`
records the target shape; supporting references use `link`.

`tmp` belongs to the white-box `spec.json` projection. It does not alter canonical CaseSet,
participate in `case_hash`, or change runtime behavior. `specgen --check` detects changes to
either field in the generated projection. Naming a marker does not itself implement handling
in a consuming reviewer.
