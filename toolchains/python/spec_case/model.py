"""Canonical case — the runner-neutral INPUT contract (``spec/case.schema.json``),
the mirror of the verdict output contract (``case.id`` == ``verdict.case_id``).

Requires the ``spec-case[model]`` extra (pydantic + pyyaml); the marker/specgen core
stays dependency-free.

A case is one accumulable, git-versioned unit of "how to exercise the system once",
deliberately decoupled from three things so it can be **reused** across faces, SUTs and
experiments:

- **input ⟂ judgment** — ``judge`` is partitioned by face and every face is optional. A
  case carries one stimulus (``input``) and a map of *per-face* criteria; a missing face
  means "observe that face, don't judge it" (观测面 ⟂ 判定面).
- **case ⟂ environment** — ``input`` carries no base_url / token / model; environment is
  experiment config, so the same case runs against any SUT.
- **case ⟂ experiment params** — no weight / concurrency / repeat; those are the
  experiment's mix, so the same case is reusable across experiments.

What this module owns (the neutral *frame*): the ``Case`` / ``CaseSet`` / ``Source`` shape,
load + validate (id uniqueness, facets declared, requires resolve, judge faces ∈ `FACES`),
``case_hash`` (intent-drift), ``Source.key`` (content-addressed reuse key). What it does
NOT own (left to each runner): the *content* — ``input`` semantics and the per-face
``judge.<face>`` criteria fields are runner-autonomous; each runner projects a ``Case``
into its own internal model. ``id`` is the primary key joining input → output and across
runs/faces.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

import yaml

from spec_case.facets import FacetSchema

# Face is the judgment-face vocabulary — the cross-cutting enum tying the input contract
# to the output contract: a case declares criteria per face (`case.judge.<face>`) and the
# runner for that face produces a verdict for it (`verdict.harness`). Both sides share
# THIS tuple, so a face can't exist on one side only.
Face = Literal["e2e", "eval", "perf", "trace"]
FACES: tuple[Face, ...] = ("e2e", "eval", "perf", "trace")

# A case.yaml is a shareable interchange artifact (hand it to others; run anyone's against
# your SUT) — so the format is versioned, like verdict's. A file may declare `schema_version`
# at the top; absent ⇒ 1. Bump only on an incompatible change.
SCHEMA_VERSION = 1
CASE_ID_PATTERN = re.compile(r"^[a-z][a-z0-9_]*$")
SYMBOL_ID_PATTERN = re.compile(r"^[^:]+::[^:]+$")


@dataclass
class Source:
    """A material a case depends on — declared with the case (git), provisioned by the
    experiment at runtime. ``uri`` xor ``content``."""

    name: str
    uri: str | None = None
    content: str | None = None
    meta: dict = field(default_factory=dict)

    def key(self) -> str:
        """Declaration-level content-addressed reuse key — same content ⇒ same key, so the
        provisioner reuses one provisioned resource. Inline content hashes the bytes; a
        ``uri`` hashes the pointer (the provisioner may refine it to the resolved content)."""
        seed = self.content if self.content is not None else (self.uri or "")
        return hashlib.sha256(seed.encode("utf-8")).hexdigest()[:16]


@dataclass
class Binding:
    """The code symbol a case asserts, plus its shared contract preamble."""

    symbol_id: str
    spec: str = ""


@dataclass
class Case:
    """One reusable stimulus + its per-face judgment criteria.

    ``input`` is a protocol-agnostic request description interpreted by each runner's
    adapter (runner / solver / workload) — schemaless here on purpose. ``facets`` classify
    the case (validated against the set's vocab). ``requires`` names the sources it needs
    (declaration only). ``judge`` maps a face → that face's criteria dict; faces ∈ `FACES`,
    all optional, inner fields runner-owned. ``binding`` optionally attaches the case to the
    code symbol whose contract it exercises.
    """

    id: str
    input: dict
    desc: str = ""
    facets: dict[str, str] = field(default_factory=dict)
    requires: list[str] = field(default_factory=list)
    judge: dict[str, dict] = field(default_factory=dict)
    binding: Binding | None = None


@dataclass
class CaseSet:
    """A case file = sources + facet vocab + cases — the accumulable, *shareable* git asset.
    One canonical type all three faces read; there is no per-runner Case class."""

    caseset: str
    focus: str = ""
    facet_schema: FacetSchema = field(default_factory=FacetSchema)
    sources: list[Source] = field(default_factory=list)
    cases: list[Case] = field(default_factory=list)
    schema_version: int = SCHEMA_VERSION


def load_caseset(path: str | Path) -> CaseSet:
    """Parse a canonical case file (``spec/case.schema.json`` shape) → ``CaseSet``. Does
    not validate beyond parsing — call ``validate`` for the integrity rules."""
    raw = yaml.safe_load(Path(path).read_text(encoding="utf-8")) or {}
    return from_raw(raw)


def case_from_raw(c: dict) -> Case:
    """Build one ``Case`` from a parsed ``cases[]`` entry. The case-level counterpart of
    ``from_raw`` — exposed so a runner that owns its own set container (one that
    carries a corpus that ``CaseSet`` can't model) can still parse canonical cases directly,
    without round-tripping through a ``CaseSet``."""
    binding_raw = c.get("binding")
    binding = (
        Binding(
            symbol_id=binding_raw.get("symbol_id", ""),
            spec=binding_raw.get("spec", ""),
        )
        if binding_raw
        else None
    )
    return Case(
        # .get: a missing id must surface as validate()'s "case with empty id",
        # not a KeyError deep in parsing
        id=c.get("id", ""),
        input=c.get("input") or {},
        desc=c.get("desc", ""),
        facets=dict(c.get("facets") or {}),
        requires=list(c.get("requires") or []),
        judge=dict(c.get("judge") or {}),
        binding=binding,
    )


def case_to_raw(case: Case) -> dict:
    """Round-trippable ``cases[]`` entry — the write side of ``case_from_raw``, mirror of
    the verdict records ``to_dict`` on the output side. Omit-empty so a hand-written case stays terse
    and ``case_from_raw(case_to_raw(c)) == c``. ``input`` is always emitted (a case with no
    stimulus is meaningless); everything else is dropped when empty."""
    d: dict = {"id": case.id, "input": dict(case.input)}
    if case.desc:
        d["desc"] = case.desc
    if case.facets:
        d["facets"] = dict(case.facets)
    if case.requires:
        d["requires"] = list(case.requires)
    if case.judge:
        d["judge"] = {face: dict(crit) for face, crit in case.judge.items()}
    if case.binding:
        d["binding"] = {"symbol_id": case.binding.symbol_id}
        if case.binding.spec:
            d["binding"]["spec"] = case.binding.spec
    return d


def from_raw(raw: dict) -> CaseSet:
    """Build a ``CaseSet`` from an already-parsed mapping."""
    facet_schema = FacetSchema.from_raw(raw.get("facets"))
    sources = [
        Source(
            name=s["name"],
            uri=s.get("uri"),
            content=s.get("content"),
            meta=s.get("meta") or {},
        )
        for s in (raw.get("sources") or [])
    ]
    cases = [case_from_raw(c) for c in (raw.get("cases") or [])]
    return CaseSet(
        caseset=raw.get("caseset", ""),
        focus=raw.get("focus", ""),
        facet_schema=facet_schema,
        sources=sources,
        cases=cases,
        schema_version=int(raw.get("schema_version", SCHEMA_VERSION)),
    )


def validate(cs: CaseSet) -> None:
    """Enforce the canonical integrity rules; raise ``ValueError`` on the first breach.

    - source names unique; each source has ``uri`` xor ``content``;
    - case ids match the schema pattern and are set-unique;
      immutability across edits is enforced by ``case_hash`` drift, not here;
    - every ``case.facets`` key is a declared facet, values in-vocab (`spec_case.facets`);
    - every ``requires`` name resolves to a declared source;
    - every ``judge`` key is a known face (`FACES`); inner criteria are runner-owned.
    - binding symbol ids match the symbol-id shape.
    """
    src_names: set[str] = set()
    for s in cs.sources:
        if not s.name:
            raise ValueError("source with empty name")
        if s.name in src_names:
            raise ValueError(f"duplicate source name: {s.name}")
        src_names.add(s.name)
        if (s.uri is None) == (s.content is None):
            raise ValueError(
                f"source {s.name!r} needs exactly one of `uri` / `content`"
            )

    seen: set[str] = set()
    for c in cs.cases:
        if not c.id:
            raise ValueError("case with empty id")
        if not CASE_ID_PATTERN.fullmatch(c.id):
            raise ValueError(f"case with invalid id: {c.id!r}")
        if c.id in seen:
            raise ValueError(f"duplicate case id: {c.id}")
        seen.add(c.id)
        cs.facet_schema.validate_dimensions(c.id, c.facets)
        for name in c.requires:
            if name not in src_names:
                raise ValueError(f"case {c.id}: requires unknown source {name!r}")
        for face in c.judge:
            if face not in FACES:
                raise ValueError(
                    f"case {c.id}: unknown judge face {face!r}; faces are {list(FACES)}"
                )
        if c.binding and not SYMBOL_ID_PATTERN.fullmatch(c.binding.symbol_id):
            raise ValueError(
                f"case {c.id}: invalid binding symbol_id {c.binding.symbol_id!r}"
            )


def case_hash(case: Case) -> str:
    """Stable hash over a case's identity-defining fields (everything but the cosmetic
    ``desc``) → intent-drift detection: the hash changes iff the case's meaning changes, so
    a downstream artifact keyed by it (a generated e2e script, a cached result) knows to
    refresh. Stable across runs / machines."""
    blob = json.dumps(
        {
            "id": case.id,
            "input": case.input,
            "facets": case.facets,
            "requires": sorted(case.requires),
            "judge": case.judge,
        },
        sort_keys=True,
        ensure_ascii=False,
        separators=(",", ":"),
    )
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()[:8]
