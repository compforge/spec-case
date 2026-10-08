# HTTP Case profile

The profile specializes canonical `Case.input` with `protocol: "http"`, an explicit method, optional
origin-relative path, stable headers and an optional text body. HTTP and HTTPS are URL schemes of the
runtime target, not different input protocols. Other Case inputs remain runner-defined.

Optional `judge.e2e.http` specifies accepted status codes and an optional MIME type (case-insensitive, ignoring response parameters).
Missing HTTP criteria means observe-only, never an implicit pass. Protocol executors own comparison;
spec-case owns only the data contract. Extra E2E criteria remain available to a caller's Judge.

URLs, target Host headers and credentials belong to execution preparation. Authorization,
Proxy-Authorization, Cookie and X-Api-Key headers are rejected in stable input; other secret values
also belong in the execution target. This keeps short-lived signatures out of Case identity/hash.
A prepared target may be an exact signed URL; absent `input.path` means use that URL unchanged.

`http-case.schema.json` describes the wire profile; runtime validators additionally validate HTTP
header token syntax, reject CR/LF and credential/Host headers. Shared examples are in
`conformance/case/http.json`. No executor, environment selection or I/O lives in this package.

TypeScript (`@compforge/spec-case/http`), Python (`spec_case.http`) and Go (`model.ValidateHTTPCase`)
validate the profile with the same fixtures. Profile validation complements canonical CaseSet validation;
it does not resolve source references or facet vocabularies.
