"""Server-side Minimum Players gate on ADMIN_START.

The lobby's Start button is disabled below 2 connected players, but that
check lives client-side and trusts the client's picture of the room. iOS
Safari can kill a departing player's socket without a close frame, leaving
the server (and everyone's UI) believing they're still connected until the
websocket ping timeout fires — a window in which the admin could start a
"2-player" game that really has one human in it. handle_admin_start must
therefore enforce the floor server-side against count_active_players,
which ignores mid-grace disconnected seats.

Practice rooms are exempt: solo-vs-bots is the whole point there.

Strategy mirrors test_min_players_sync.py: patch module-level `redis` with
fakeredis, stub broadcast, and spy on _trigger_next_game_tutorial so these
stay pure gate tests with no deck/game setup.
"""
import fakeredis
import pytest

import app.engine.room_service as rs_module
from app.engine.deck import deck as deck_singleton
from app.engine.fsm import RoomState

CODE = "GATE1"
ADMIN = "admin-uuid"
GUEST = "guest-uuid"

_svc = rs_module.room_service


@pytest.fixture(autouse=True)
def patch_redis_and_spy(monkeypatch):
    r = fakeredis.FakeAsyncRedis(decode_responses=True)
    monkeypatch.setattr(rs_module, "redis", r)
    monkeypatch.setattr(deck_singleton, "_redis", r)
    monkeypatch.setattr(_svc, "_connections", {})
    # handle_disconnect fire-and-forgets a 60s grace-timeout task that would
    # leak past the test's event loop. Stubbing it out (rather than zeroing
    # the grace period) also freezes the roster in exactly the state under
    # test: seat held, connected=False, mid-grace.
    async def _noop_grace_timeout(code: str, player_id: str, disconnected_at: int) -> None:
        pass

    monkeypatch.setattr(_svc, "_disconnect_grace_timeout", _noop_grace_timeout)

    # handle_handshake fire-and-forgets an infinite _pubsub_listener per
    # room the first time it sees it — another cross-test loop leak.
    async def _noop_pubsub(code: str) -> None:
        pass

    monkeypatch.setattr(_svc, "_pubsub_listener", _noop_pubsub)

    async def _mock_broadcast(code: str, message: dict) -> None:
        pass

    monkeypatch.setattr(_svc, "broadcast", _mock_broadcast)

    triggered: list[str] = []

    async def _spy_trigger(code: str) -> None:
        triggered.append(code)

    monkeypatch.setattr(_svc, "_trigger_next_game_tutorial", _spy_trigger)
    return r, triggered


class _FakeWebSocket:
    async def send_text(self, _text: str) -> None:
        pass


async def _join(player_id: str) -> None:
    await _svc.handle_handshake(CODE, _FakeWebSocket(), {
        "player_id": player_id,
        "display_name": player_id,
        "local_ts": 0,
    })


async def _setup_room(r, *, practice: bool = False) -> None:
    mapping = {"state": RoomState.LOBBY, "admin_id": ADMIN}
    if practice:
        mapping["practice"] = "1"
    await r.hset(f"room:{CODE}", mapping=mapping)


@pytest.mark.asyncio
async def test_start_allowed_with_two_connected_players(patch_redis_and_spy):
    r, triggered = patch_redis_and_spy
    await _setup_room(r)
    await _join(ADMIN)
    await _join(GUEST)

    await _svc.handle_admin_start(CODE, ADMIN)

    assert triggered == [CODE]


@pytest.mark.asyncio
async def test_start_blocked_when_second_player_is_disconnected(patch_redis_and_spy):
    r, triggered = patch_redis_and_spy
    await _setup_room(r)
    await _join(ADMIN)
    await _join(GUEST)
    # Simulate the ghost: guest's socket died; grace period marks the seat
    # disconnected but keeps it in the roster.
    ws = _svc._connections[CODE][GUEST]
    await _svc.handle_disconnect(CODE, GUEST, ws)

    await _svc.handle_admin_start(CODE, ADMIN)

    assert triggered == []


@pytest.mark.asyncio
async def test_start_blocked_with_single_player(patch_redis_and_spy):
    r, triggered = patch_redis_and_spy
    await _setup_room(r)
    await _join(ADMIN)

    await _svc.handle_admin_start(CODE, ADMIN)

    assert triggered == []


@pytest.mark.asyncio
async def test_practice_room_starts_solo(patch_redis_and_spy):
    r, triggered = patch_redis_and_spy
    await _setup_room(r, practice=True)
    await _join(ADMIN)

    await _svc.handle_admin_start(CODE, ADMIN)

    assert triggered == [CODE]


@pytest.mark.asyncio
async def test_non_admin_cannot_start(patch_redis_and_spy):
    r, triggered = patch_redis_and_spy
    await _setup_room(r)
    await _join(ADMIN)
    await _join(GUEST)

    await _svc.handle_admin_start(CODE, GUEST)

    assert triggered == []
