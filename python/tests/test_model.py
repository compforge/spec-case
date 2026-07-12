"""canonical case model: load / validate / case_hash / Source.key."""

from __future__ import annotations

import pytest

from spec_case import model as C


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
