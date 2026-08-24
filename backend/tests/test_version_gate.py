"""Client compatibility gate: X-Client-Version on REST, ?cv= on WS.
Uses FastAPI's TestClient against the real app with the router-level
dependency; redis calls in the touched endpoints are patched with
fakeredis per test_room_gc.py's strategy.
"""
import fakeredis
import pytest
from fastapi.testclient import TestClient

import app.routers.rooms as rooms_module
import app.version_gate as vg
from app.main import app


@pytest.fixture(autouse=True)
def patch_redis(monkeypatch):
    r = fakeredis.FakeAsyncRedis(decode_responses=True)
    monkeypatch.setattr(rooms_module, "redis", r)
    return r


@pytest.fixture
def strict_gate(monkeypatch):
    monkeypatch.setattr(vg, "MIN_CLIENT_VERSION", 1)


client = TestClient(app)


def test_get_room_allows_current_version(strict_gate):
    res = client.get("/rooms/NOPE42", headers={"X-Client-Version": "1"})
    assert res.status_code == 200          # gate passed; room simply doesn't exist
    assert res.json()["exists"] is False


def test_missing_header_is_version_zero_and_gated(strict_gate):
    res = client.get("/rooms/NOPE42")
    assert res.status_code == 426
    assert res.json()["detail"]["min_client_version"] == 1


def test_garbage_header_is_gated(strict_gate):
    res = client.get("/rooms/NOPE42", headers={"X-Client-Version": "banana"})
    assert res.status_code == 426


def test_post_rooms_gated(strict_gate):
    res = client.post("/rooms", json={"admin_id": "a"}, headers={"X-Client-Version": "0"})
    assert res.status_code == 426


def test_default_min_is_permissive():
    assert vg.MIN_CLIENT_VERSION == 0
    res = client.get("/rooms/NOPE42")     # no header at all
    assert res.status_code == 200


def test_ws_low_version_closed_with_4426(strict_gate):
    with client.websocket_connect("/ws/ANYCODE?cv=0") as ws:
        # Starlette surfaces the server close on the next receive
        with pytest.raises(Exception) as exc:
            ws.receive_text()
    assert "4426" in str(exc.value) or getattr(exc.value, "code", None) == 4426


def test_ws_current_version_stays_open(strict_gate):
    with client.websocket_connect("/ws/ANYCODE?cv=1") as ws:
        ws.send_text('{"type": "PING"}')   # unknown type: server ignores, connection lives
