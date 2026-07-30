"""Tests for Minimum Players enforcement's dynamic playlist sync —
room_service._sync_eligible_games, triggered from handle_handshake (join)
and _finalize_departure (permanent leave/grace-period expiry). A game
requiring more players than are currently present is pruned from the room's
broadcast game_ids, and comes back on its own once enough players return —
without the admin having to reselect it. A game the admin explicitly
removes, by contrast, must stay removed regardless of headcount.

Strategy mirrors test_set_games.py/test_late_join.py: patch module-level
`redis` in room_service + the deck singleton's own client with a shared
fakeredis, replace `room_service.broadcast` with a list-capturing stub."""
import fakeredis
import pytest

import app.engine.room_service as rs_module
from app.engine.deck import deck as deck_singleton
from app.engine.fsm import RoomState

CODE = "MINCD"
ADMIN = "admin-uuid"

_svc = rs_module.room_service


@pytest.fixture(autouse=True)
def patch_redis_and_broadcast(monkeypatch):
    r = fakeredis.FakeAsyncRedis(decode_responses=True)
    monkeypatch.setattr(rs_module, "redis", r)
    monkeypatch.setattr(deck_singleton, "_redis", r)
    monkeypatch.setattr(_svc, "_room_locks", {})
    monkeypatch.setattr(_svc, "_connections", {})

    captured: list[dict] = []

    async def _mock_broadcast(code: str, message: dict) -> None:
        captured.append(message)

    monkeypatch.setattr(_svc, "broadcast", _mock_broadcast)
    return r, captured


class _FakeWebSocket:
    async def send_text(self, _text: str) -> None:
        pass


async def _join(player_id: str) -> None:
    await _svc.handle_handshake(CODE, _FakeWebSocket(), {
        "player_id": player_id,
        "display_name": player_id,
        "local_ts": 0,
    })


@pytest.mark.asyncio
async def test_game_pruned_when_room_is_below_its_floor(patch_redis_and_broadcast):
    r, captured = patch_redis_and_broadcast
    await r.hset(f"room:{CODE}", mapping={"state": RoomState.LOBBY, "admin_id": ADMIN})
    await _join(ADMIN)  # only 1 player present

    await _svc.handle_set_games(CODE, ADMIN, ["reflex", "auction"])  # auction needs 5

    assert await deck_singleton.get_game_ids(CODE) == ["reflex"]
    msgs = [m for m in captured if m["type"] == "GAME_IDS_UPDATED"]
    assert msgs[-1]["game_ids"] == ["reflex"]


@pytest.mark.asyncio
async def test_game_auto_added_back_once_room_grows_past_its_floor(patch_redis_and_broadcast):
    r, captured = patch_redis_and_broadcast
    await r.hset(f"room:{CODE}", mapping={"state": RoomState.LOBBY, "admin_id": ADMIN})
    await _join(ADMIN)
    await _svc.handle_set_games(CODE, ADMIN, ["reflex", "auction"])
    assert await deck_singleton.get_game_ids(CODE) == ["reflex"]

    for i in range(4):  # brings the room from 1 to 5 players
        await _join(f"player-{i}")

    assert await deck_singleton.get_game_ids(CODE) == ["reflex", "auction"]
    msgs = [m for m in captured if m["type"] == "GAME_IDS_UPDATED"]
    assert msgs[-1]["game_ids"] == ["reflex", "auction"]


@pytest.mark.asyncio
async def test_game_pruned_again_once_players_leave(patch_redis_and_broadcast):
    r, captured = patch_redis_and_broadcast
    await r.hset(f"room:{CODE}", mapping={"state": RoomState.LOBBY, "admin_id": ADMIN})
    await _join(ADMIN)
    for i in range(4):
        await _join(f"player-{i}")
    await _svc.handle_set_games(CODE, ADMIN, ["reflex", "auction"])
    assert await deck_singleton.get_game_ids(CODE) == ["reflex", "auction"]

    await _svc.handle_leave(CODE, "player-0")
    await _svc.handle_leave(CODE, "player-1")  # down to 3 — below auction's floor

    assert await deck_singleton.get_game_ids(CODE) == ["reflex"]


@pytest.mark.asyncio
async def test_manually_deselected_game_is_not_resurrected_by_auto_add_back(patch_redis_and_broadcast):
    """A game the sync itself pruned should come back automatically (see
    test_game_auto_added_back_once_room_grows_past_its_floor above) — but a
    game the admin explicitly removed via SET_GAMES must not, even once the
    room later has enough players for it again."""
    r, captured = patch_redis_and_broadcast
    await r.hset(f"room:{CODE}", mapping={"state": RoomState.LOBBY, "admin_id": ADMIN})
    await _join(ADMIN)
    for i in range(4):
        await _join(f"player-{i}")
    await _svc.handle_set_games(CODE, ADMIN, ["reflex", "auction"])
    assert await deck_singleton.get_game_ids(CODE) == ["reflex", "auction"]

    await _svc.handle_set_games(CODE, ADMIN, ["reflex"])  # admin's own explicit edit
    assert await deck_singleton.get_game_ids(CODE) == ["reflex"]

    await _join("player-4")
    await _join("player-5")

    assert await deck_singleton.get_game_ids(CODE) == ["reflex"]
