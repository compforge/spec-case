"""HTTP profile validation for canonical Case; target URLs remain execution data."""
from __future__ import annotations

import re
from spec_case.model import Case

_METHODS = {"GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"}
_HEADER = re.compile(r"^[!#$%&'*+.^_`|~0-9A-Za-z-]+$")


def validate_http_case(case: Case) -> None:
    """Validate the HTTP profile after canonical CaseSet validation."""
    stimulus = case.input
    if stimulus.get("protocol") != "http":
        raise ValueError("HTTP Case input.protocol must be http")
    if stimulus.get("method") not in _METHODS:
        raise ValueError("Invalid HTTP Case method")
    if set(stimulus) - {"protocol", "method", "path", "headers", "body"}:
        raise ValueError("Unknown HTTP Case input field; targets belong to execution")
    path = stimulus.get("path")
    if "path" in stimulus and (not isinstance(path, str) or not path.startswith("/") or path.startswith("//") or any(c in path for c in "\\\r\n")):
        raise ValueError("HTTP Case path must be origin-relative")
    if "body" in stimulus and not isinstance(stimulus["body"], str):
        raise ValueError("HTTP Case body must be a string")
    headers = stimulus.get("headers", {})
    if not isinstance(headers, dict):
        raise ValueError("Invalid HTTP Case headers")
    for key, value in headers.items():
        if not _HEADER.fullmatch(key) or not isinstance(value, str) or "\r" in value or "\n" in value:
            raise ValueError("Invalid HTTP Case header")
        if key.lower() in {"authorization", "proxy-authorization", "cookie", "host", "x-api-key"}:
            raise ValueError("HTTP Case credentials and host belong to execution target headers")
    criteria = case.judge.get("e2e", {})
    if "http" not in criteria:
        return
    expected = criteria["http"]
    if not isinstance(expected, dict) or set(expected) - {"status", "contentType"}:
        raise ValueError("Invalid HTTP Case expected status")
    statuses = expected.get("status")
    if not isinstance(statuses, list) or not statuses or any(type(status) not in (int, float) or status != int(status) or not 100 <= status <= 599 for status in statuses):
        raise ValueError("Invalid HTTP Case expected status")
    if "contentType" in expected and (not isinstance(expected["contentType"], str) or not expected["contentType"].strip()):
        raise ValueError("Invalid HTTP Case expected contentType")
