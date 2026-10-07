"""D4 — canlıda (ENVIRONMENT=production) /docs, /redoc ve /openapi.json kapalı; geliştirmede açık."""
from __future__ import annotations

from fastapi.testclient import TestClient

from homunculus.api.app import create_app

TOKENS = {"sentetik-test-anahtari-0123456789": "HOSP1"}
PATHS = ("/docs", "/redoc", "/openapi.json")


def _statuses(app):
    c = TestClient(app)
    return [c.get(p).status_code for p in PATHS]


def test_docs_are_closed_in_production(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    app = create_app(TOKENS, run_escalation_loop=False)
    assert app.docs_url is None and app.redoc_url is None and app.openapi_url is None
    assert _statuses(app) == [404, 404, 404]


def test_docs_remain_available_in_development(monkeypatch):
    monkeypatch.delenv("ENVIRONMENT", raising=False)
    app = create_app(TOKENS, run_escalation_loop=False)
    assert _statuses(app) == [200, 200, 200]
