import json
from pathlib import Path
import pytest
from spec_case.model import Case
from spec_case.http import validate_http_case

FIXTURES = json.loads((Path(__file__).parents[3] / "conformance/case/http.json").read_text())

@pytest.mark.parametrize("raw", FIXTURES["valid"])
def test_http_profile_valid(raw):
    validate_http_case(Case(**raw))

@pytest.mark.parametrize("raw", FIXTURES["invalid"])
def test_http_profile_invalid(raw):
    with pytest.raises(ValueError):
        validate_http_case(Case(**raw))
