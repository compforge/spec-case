"""Facet vocabulary — the case-schema ``facets.<key>.{values, ordered, open}`` model.

Harness-neutral: a facet is a spec-level classification axis (difficulty / lang / kb …),
not a runner domain concept. eval- and perf-style runners both classify their cases by facets and order
report groups by them, so the model lives here once. Each runner supplies its own base
registry (if any) and projects its cases' facet dims through `validate_dimensions` /
`order_key`; the per-case facet *values* live on each runner's own case object.

- a **constrained** facet declares ``values`` (and optionally ``ordered`` so a report sorts
  ``easy < medium < hard`` rather than alphabetically);
- an **open** facet (``open: true``) accepts any value — the long-tail escape hatch, so
  there is one dimension mechanism and no separate flat-tag channel.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, model_validator


class FacetSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    values: list[str] | None = None  # constrained vocabulary; None + open => any value
    ordered: bool = False  # the ``values`` order is meaningful (ordinal facet)
    open: bool = False  # accept free-form values (long-tail labels)

    @model_validator(mode="after")
    def _check(self) -> FacetSpec:
        if self.values is None and not self.open:
            raise ValueError("facet must declare `values` or be `open: true`")
        if self.ordered and not self.values:
            raise ValueError("`ordered` requires `values`")
        return self


class FacetSchema:
    """Resolved facet vocabulary = an optional base registry merged with declared overrides
    (the declarations win — they can re-open / widen a base facet)."""

    def __init__(
        self,
        facets: dict[str, FacetSpec] | None = None,
        base: dict[str, FacetSpec] | None = None,
    ) -> None:
        merged = dict(base or {})
        if facets:
            merged.update(facets)
        self.facets = merged

    @classmethod
    def from_raw(
        cls, raw: dict | None, base: dict[str, FacetSpec] | None = None
    ) -> FacetSchema:
        """Build from a raw ``facets`` mapping (``{key: {values, ordered, open}}``), as it
        appears in a config/experiment yaml. Validates each entry (FacetSpec)."""
        return cls(
            {k: FacetSpec(**(v or {})) for k, v in (raw or {}).items()}, base=base
        )

    def validate_dimensions(self, case_id: str, dims: dict[str, str]) -> None:
        for key, val in dims.items():
            spec = self.facets.get(key)
            if spec is None:
                raise ValueError(
                    f"case {case_id}: unknown facet {key!r}; "
                    f"declare it in the facets ({sorted(self.facets)})"
                )
            if spec.values is not None and not spec.open and val not in spec.values:
                raise ValueError(
                    f"case {case_id}: facet {key}={val!r} not in {spec.values}"
                )

    def order_key(self, facet: str, value: str) -> tuple[int, str]:
        """Sort key for grouping a facet's values (ordinal order, else alpha)."""
        spec = self.facets.get(facet)
        if spec and spec.ordered and spec.values and value in spec.values:
            return (spec.values.index(value), "")
        return (10_000, value)

    def ordered_value_lists(self) -> dict[str, list[str]]:
        """``{facet: values}`` for each ordered facet — the report sort order (the form a
        report renderer wants when it groups rows by facet value)."""
        return {
            k: list(s.values) for k, s in self.facets.items() if s.ordered and s.values
        }
