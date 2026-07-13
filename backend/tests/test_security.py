"""Regression tests for the local API trust boundary."""

from __future__ import annotations

from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.app import security


def _settings(token: str = "", trusted_proxy: bool = False) -> SimpleNamespace:
    return SimpleNamespace(
        vibe_spam_api_token=token,
        trusted_proxy_mode=trusted_proxy,
        frontend_url="http://localhost:5173",
    )


def test_loopback_browser_requires_trusted_origin_without_token(monkeypatch) -> None:
    monkeypatch.setattr(security, "get_settings", lambda: _settings())

    assert security._request_allowed("127.0.0.1", "http://localhost:5173", None)
    assert security._request_allowed("127.0.0.1", None, None)
    assert not security._request_allowed("127.0.0.1", "null", None)
    assert not security._request_allowed("192.168.1.20", "http://localhost:5173", None)


def test_token_closes_null_origin_boundary(monkeypatch) -> None:
    monkeypatch.setattr(security, "get_settings", lambda: _settings("secret-token"))
    app = FastAPI()
    app.middleware("http")(security.local_api_auth_middleware)

    @app.get("/protected")
    async def protected() -> dict[str, bool]:
        return {"ok": True}

    client = TestClient(app)
    assert client.get("/protected", headers={"Origin": "null"}).status_code == 403
    response = client.get(
        "/protected",
        headers={"Origin": "null", "Authorization": "Bearer secret-token"},
    )
    assert response.status_code == 200
    assert response.json() == {"ok": True}


def test_trusted_proxy_still_requires_known_browser_origin(monkeypatch) -> None:
    monkeypatch.setattr(security, "get_settings", lambda: _settings(trusted_proxy=True))

    assert security._request_allowed("172.20.0.3", "http://localhost:5173", None)
    assert not security._request_allowed("172.20.0.3", None, None)
    assert not security._request_allowed("172.20.0.3", "https://attacker.invalid", None)


def test_websocket_token_is_read_from_subprotocol(monkeypatch) -> None:
    monkeypatch.setattr(security, "get_settings", lambda: _settings("secret-token"))
    websocket = SimpleNamespace(
        headers={"sec-websocket-protocol": "vibe-spam-token.secret-token"},
        client=SimpleNamespace(host="127.0.0.1"),
    )

    assert security.websocket_is_authorized(websocket)
    assert security.websocket_token_protocol(websocket) == "vibe-spam-token.secret-token"
