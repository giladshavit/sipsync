"""Client compatibility gate (spec 1.6): an integer compatibility number,
independent of marketing versions. Raise MIN_CLIENT_VERSION together with
the frontend's CLIENT_VERSION in the same PR whenever a change would break
older clients (e.g. a new mini-game their bundle can't render).
"""
import sys

from fastapi import HTTPException, Request, WebSocket

MIN_CLIENT_VERSION = 0
WS_CLOSE_UPGRADE_REQUIRED = 4426


def _parse(raw: str | None) -> int:
    try:
        return int(raw or 0)
    except ValueError:
        return 0


async def require_client_version(request: Request) -> None:
    module = sys.modules[__name__]  # read via module so tests can monkeypatch
    if _parse(request.headers.get("X-Client-Version")) < module.MIN_CLIENT_VERSION:
        raise HTTPException(
            status_code=426,
            detail={"detail": "upgrade_required", "min_client_version": module.MIN_CLIENT_VERSION},
        )


def ws_client_version_ok(websocket: WebSocket) -> bool:
    module = sys.modules[__name__]
    return _parse(websocket.query_params.get("cv")) >= module.MIN_CLIENT_VERSION
