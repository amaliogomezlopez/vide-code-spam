"""Local API authentication and browser-origin policy."""

from __future__ import annotations

import hmac
import ipaddress
from collections.abc import Awaitable, Callable

from fastapi import Request, WebSocket
from starlette.responses import JSONResponse, Response

from backend.app.config import get_settings

PUBLIC_HTTP_PATHS = frozenset({"/api/health"})


def _is_loopback(host: str | None) -> bool:
    if not host:
        return False
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return host.lower() == "localhost"


def _allowed_origins() -> frozenset[str]:
    settings = get_settings()
    return frozenset(
        {
            settings.frontend_url,
            "http://localhost:5173",
            "http://localhost:5174",
            "http://localhost:5175",
            "http://127.0.0.1:5173",
            "http://127.0.0.1:5174",
            "http://127.0.0.1:5175",
        }
    )


def _token_matches(candidate: str | None) -> bool:
    configured = get_settings().vibe_spam_api_token
    return bool(configured and candidate and hmac.compare_digest(candidate, configured))


def _bearer_token(authorization: str | None) -> str | None:
    if not authorization:
        return None
    scheme, _, value = authorization.partition(" ")
    return value if scheme.lower() == "bearer" and value else None


def _request_allowed(client_host: str | None, origin: str | None, token: str | None) -> bool:
    settings = get_settings()
    if settings.vibe_spam_api_token:
        return _token_matches(token)

    if settings.trusted_proxy_mode:
        return bool(origin and origin in _allowed_origins())

    if not _is_loopback(client_host):
        return False
    # Non-browser clients on loopback are supported. Browser clients must come
    # from the local development UI; a file:// origin ("null") is not trusted.
    return origin is None or origin in _allowed_origins()


async def local_api_auth_middleware(
    request: Request,
    call_next: Callable[[Request], Awaitable[Response]],
) -> Response:
    if request.url.path in PUBLIC_HTTP_PATHS:
        return await call_next(request)

    token = _bearer_token(request.headers.get("authorization"))
    client_host = request.client.host if request.client else None
    if not _request_allowed(client_host, request.headers.get("origin"), token):
        return JSONResponse({"detail": "Local API authorization required"}, status_code=403)
    return await call_next(request)


def websocket_token_protocol(websocket: WebSocket) -> str | None:
    return next(
        (
            item.strip()
            for item in websocket.headers.get("sec-websocket-protocol", "").split(",")
            if item.strip().startswith("vibe-spam-token.")
        ),
        None,
    )


def websocket_is_authorized(websocket: WebSocket) -> bool:
    header_token = _bearer_token(websocket.headers.get("authorization"))
    protocol = websocket_token_protocol(websocket)
    protocol_token = protocol.removeprefix("vibe-spam-token.") if protocol else None
    client_host = websocket.client.host if websocket.client else None
    return _request_allowed(
        client_host,
        websocket.headers.get("origin"),
        header_token or protocol_token,
    )
