"""canonical case model: load / validate / case_hash / Source.key."""

from __future__ import annotations

from pathlib import Path

import pytest

from spec_case import model as C


CONFORMANCE_CASESET = Path(__file__).parents[3] / "conformance" / "case" / "cases.yaml"


def _raw(**over) -> dict:
    base = {
        "caseset": "demo",
        "focus": "smoke",
        "facets": {"difficulty": {"values": ["easy", "hard"], "ordered": True}},
        "sources": [{"name": "doc1", "content": "hello"}],
        "cases": [
            {
                "id": "f1",
                "input": {"query": "capital of France?"},
                "facets": {"difficulty": "easy"},
                "requires": ["doc1"],
                "judge": {"eval": {"ground_truth": "Paris"}},
            }
        ],
    }
    base.update(over)
    return base


def test_from_raw_shape():
    cs = C.from_raw(_raw())
    assert cs.caseset == "demo" and cs.focus == "smoke"
    assert [s.name for s in cs.sources] == ["doc1"]
    c = cs.cases[0]
    assert c.id == "f1" and c.input == {"query": "capital of France?"}
    assert c.facets == {"difficulty": "easy"} and c.requires == ["doc1"]
    assert c.judge == {"eval": {"ground_truth": "Paris"}}
    C.validate(cs)  # the happy set passes


def test_shared_cross_language_conformance_caseset():
    cs = C.load_caseset(CONFORMANCE_CASESET)
    C.validate(cs)
    assert cs.caseset == "canonical-model"
    assert cs.cases[0].binding == C.Binding(
        symbol_id="internal/api/answer.go::Handler.Answer",
        spec="Answers use the selected document.",
        spec_id="grounded_answer",
    )


def test_binding_round_trip():
    raw = _raw()
    raw["cases"][0]["binding"] = {
        "symbol_id": "app/api.py::Service.run",
        "spec_id": "ordered_output",
        "spec": "preserve ordering",
    }
    case = C.from_raw(raw).cases[0]
    assert case.binding == C.Binding(
        symbol_id="app/api.py::Service.run",
        spec="preserve ordering",
        spec_id="ordered_output",
    )
    assert C.case_to_raw(case)["binding"] == raw["cases"][0]["binding"]


def test_single_spec_binding_omits_spec_id():
    binding = C.Binding(
        symbol_id="app/api.py::Service.run", spec="preserve ordering"
    )
    raw = C.case_to_raw(C.Case(id="f1", input={}, binding=binding))["binding"]
    assert raw == {
        "symbol_id": "app/api.py::Service.run",
        "spec": "preserve ordering",
    }


def test_validate_duplicate_case_id():
    raw = _raw()
    raw["cases"].append({"id": "f1", "input": {}})  # dup id (the alignment key)
    with pytest.raises(ValueError, match="duplicate case id"):
        C.validate(C.from_raw(raw))


def test_validate_undeclared_facet():
    raw = _raw()
    raw["cases"][0]["facets"] = {"lang": "zh"}  # 'lang' not in the facet vocab
    with pytest.raises(ValueError, match="unknown facet"):
        C.validate(C.from_raw(raw))


def test_validate_facet_value_out_of_vocab():
    raw = _raw()
    raw["cases"][0]["facets"] = {"difficulty": "trivial"}  # not in [easy, hard]
    with pytest.raises(ValueError, match="not in"):
        C.validate(C.from_raw(raw))


def test_validate_dangling_requires():
    raw = _raw()
    raw["cases"][0]["requires"] = ["ghost"]  # no such source
    with pytest.raises(ValueError, match="unknown source"):
        C.validate(C.from_raw(raw))


def test_validate_unknown_judge_face():
    raw = _raw()
    raw["cases"][0]["judge"] = {"taste": {}}  # 口味 is not a case face
    with pytest.raises(ValueError, match="unknown judge face"):
        C.validate(C.from_raw(raw))


def test_validate_source_needs_uri_xor_content():
    raw = _raw()
    raw["sources"] = [{"name": "bad", "uri": "x", "content": "y"}]  # both → invalid
    with pytest.raises(ValueError, match="exactly one"):
        C.validate(C.from_raw(raw))


def test_case_hash_stable_and_drifts():
    c = C.from_raw(_raw()).cases[0]
    h = C.case_hash(c)
    assert h == C.case_hash(c) and len(h) == 8  # stable
    # cosmetic desc change does NOT drift
    c2 = C.from_raw(_raw())
    c2.cases[0].desc = "a human description"
    assert C.case_hash(c2.cases[0]) == h
    # an intent change (input) DOES drift
    raw = _raw()
    raw["cases"][0]["input"] = {"query": "different"}
    assert C.case_hash(C.from_raw(raw).cases[0]) != h


def test_source_key_content_addressed():
    a = C.Source(name="x", content="hello")
    b = C.Source(name="y", content="hello")  # same content, different name
    assert a.key() == b.key()  # reuse key is content-addressed, not name-addressed
    assert C.Source(name="z", content="other").key() != a.key()


def test_face_enum_shared_with_verdict():
    # the input contract's judge faces are the same enum the output contract harnesses use
    from spec_case.model import FACES

    assert set(FACES) == {"e2e", "eval", "perf", "trace"}


def test_validate_empty_case_id():
    raw = _raw()
    raw["cases"].append({"id": "", "input": {}})
    with pytest.raises(ValueError, match="case with empty id"):
        C.validate(C.from_raw(raw))


def test_validate_case_id_pattern():
    raw = _raw()
    raw["cases"][0]["id"] = "Bad-ID"
    with pytest.raises(ValueError, match="invalid id"):
        C.validate(C.from_raw(raw))


def test_validate_binding_symbol_id():
    raw = _raw()
    raw["cases"][0]["binding"] = {"symbol_id": "missing-delimiter"}
    with pytest.raises(ValueError, match="invalid binding symbol_id"):
        C.validate(C.from_raw(raw))


def test_validate_binding_spec_id():
    raw = _raw()
    raw["cases"][0]["binding"] = {
        "symbol_id": "app/api.py::Service.run",
        "spec_id": "Bad-ID",
    }
    with pytest.raises(ValueError, match="invalid binding spec_id"):
        C.validate(C.from_raw(raw))


def test_missing_case_id_parses_then_fails_validate():
    # a cases[] entry without `id` must reach validate()'s clear error, not KeyError
    raw = _raw()
    raw["cases"].append({"input": {}})
    with pytest.raises(ValueError, match="case with empty id"):
        C.validate(C.from_raw(raw))


def test_validate_empty_source_name():
    raw = _raw()
    raw["sources"].append({"name": "", "content": "x"})
    with pytest.raises(ValueError, match="source with empty name"):
        C.validate(C.from_raw(raw))


def test_validate_duplicate_source_name():
    raw = _raw()
    raw["sources"].append({"name": "doc1", "uri": "file://other"})
    with pytest.raises(ValueError, match="duplicate source name"):
        C.validate(C.from_raw(raw))


def test_validate_source_neither_uri_nor_content():
    raw = _raw()
    raw["sources"] = [{"name": "bad"}]  # neither → same xor error as both
    with pytest.raises(ValueError, match="exactly one"):
        C.validate(C.from_raw(raw))


def test_case_hash_drifts_on_facets_requires_judge():
    base = C.case_hash(C.from_raw(_raw()).cases[0])
    for field, value in [
        ("facets", {"difficulty": "hard"}),
        ("requires", []),
        ("judge", {"eval": {"ground_truth": "Lyon"}}),
    ]:
        raw = _raw()
        raw["cases"][0][field] = value
        assert C.case_hash(C.from_raw(raw).cases[0]) != base, field


def test_case_hash_ignores_nested_key_order():
    # json.dumps(sort_keys=True) sorts recursively: judge criteria with the same
    # content in a different insertion order must hash identically
    a, b = _raw(), _raw()
    a["cases"][0]["judge"] = {"eval": {"a": 1, "b": 2}}
    b["cases"][0]["judge"] = {"eval": {"b": 2, "a": 1}}
    assert C.case_hash(C.from_raw(a).cases[0]) == C.case_hash(C.from_raw(b).cases[0])


def test_source_key_uri_addressed():
    a = C.Source(name="x", uri="s3://bucket/doc")
    b = C.Source(name="y", uri="s3://bucket/doc")  # same uri, different name
    assert a.key() == b.key()
    assert C.Source(name="z", uri="s3://bucket/other").key() != a.key()


def test_facet_empty_values_rejected():
    with pytest.raises(ValueError, match="non-empty"):
        C.from_raw(_raw(facets={"difficulty": {"values": []}}))
