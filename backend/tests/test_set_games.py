"""Tests for the in-room SET_GAMES action (room_service.handle_set_games) —
lets the admin change a room's game selection after creation, live."""
import asyncio

import fakeredis
import pytest

import app.engine.room_service as rs_module
from app.engine.deck import deck as deck_singleton
from app.engine.fsm import RoomState

CODE = "SETCD"
ADMIN = "admin-uuid"
PLAYER = "player-uuid"

_svc = rs_module.room_service


@pytest.fixture(autouse=True)
def patch_redis_and_broadcast(monkeypatch):
    r = fakeredis.FakeAsyncRedis(decode_responses=True)
    monkeypatch.setattr(rs_module, "redis", r)
    monkeypatch.setattr(deck_singleton, "_redis", r)
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


@pytest.fixture
async def lobby_room(patch_redis_and_broadcast):
    r, _ = patch_redis_and_broadcast
    await r.hset(f"room:{CODE}", mapping={"state": RoomState.LOBBY, "admin_id": ADMIN})
    await deck_singleton.initialize(CODE, ["reflex", "tap_race", "roulette"])
    return r


@pytest.mark.asyncio
async def test_admin_can_update_selection(lobby_room, patch_redis_and_broadcast):
    _, captured = patch_redis_and_broadcast

    await _svc.handle_set_games(CODE, ADMIN, ["roulette", "reflex"])

    assert await deck_singleton.get_game_ids(CODE) == ["roulette", "reflex"]
    msgs = [m for m in captured if m["type"] == "GAME_IDS_UPDATED"]
    assert len(msgs) == 1
    assert msgs[0]["game_ids"] == ["roulette", "reflex"]


@pytest.mark.asyncio
async def test_non_admin_cannot_update_selection(lobby_room, patch_redis_and_broadcast):
    _, captured = patch_redis_and_broadcast

    await _svc.handle_set_games(CODE, PLAYER, ["roulette"])

    assert await deck_singleton.get_game_ids(CODE) == ["reflex", "tap_race", "roulette"]
    assert not any(m["type"] == "GAME_IDS_UPDATED" for m in captured)


@pytest.mark.asyncio
async def test_ignored_outside_lobby(patch_redis_and_broadcast):
    r, captured = patch_redis_and_broadcast
    await r.hset(f"room:{CODE}", mapping={"state": RoomState.PLAYING, "admin_id": ADMIN})
    await deck_singleton.initialize(CODE, ["reflex"])

    await _svc.handle_set_games(CODE, ADMIN, ["roulette"])

    assert await deck_singleton.get_game_ids(CODE) == ["reflex"]
    assert not any(m["type"] == "GAME_IDS_UPDATED" for m in captured)


@pytest.mark.asyncio
async def test_ignored_during_tutorial_or_personal_summary(patch_redis_and_broadcast):
    """Mid-Session Game Editing is deliberately narrow: only LOBBY (before
    the night starts) and PODIUM (between rounds) allow it — not while a
    round is actually being set up or resolved."""
    r, captured = patch_redis_and_broadcast
    for state in (RoomState.TUTORIAL, RoomState.PERSONAL_SUMMARY):
        await r.hset(f"room:{CODE}", mapping={"state": state, "admin_id": ADMIN})
        await deck_singleton.initialize(CODE, ["reflex"])

        await _svc.handle_set_games(CODE, ADMIN, ["roulette"])

        assert await deck_singleton.get_game_ids(CODE) == ["reflex"]
    assert not any(m["type"] == "GAME_IDS_UPDATED" for m in captured)


@pytest.mark.asyncio
async def test_admin_can_update_selection_from_podium(patch_redis_and_broadcast):
    """Mid-Session Game Editing: the admin can adjust the lineup between
    rounds from the podium, not just before the night starts."""
    r, captured = patch_redis_and_broadcast
    await r.hset(f"room:{CODE}", mapping={"state": RoomState.PODIUM, "admin_id": ADMIN})
    await deck_singleton.initialize(CODE, ["reflex", "tap_race"])

    await _svc.handle_set_games(CODE, ADMIN, ["roulette", "reflex"])

    assert await deck_singleton.get_game_ids(CODE) == ["roulette", "reflex"]
    msgs = [m for m in captured if m["type"] == "GAME_IDS_UPDATED"]
    assert len(msgs) == 1
    assert msgs[0]["game_ids"] == ["roulette", "reflex"]


@pytest.mark.asyncio
async def test_rejects_unknown_game_id(lobby_room, patch_redis_and_broadcast):
    _, captured = patch_redis_and_broadcast

    await _svc.handle_set_games(CODE, ADMIN, ["not_a_real_game"])

    assert await deck_singleton.get_game_ids(CODE) == ["reflex", "tap_race", "roulette"]
    assert not any(m["type"] == "GAME_IDS_UPDATED" for m in captured)


@pytest.mark.asyncio
async def test_rejects_empty_selection(lobby_room, patch_redis_and_broadcast):
    _, captured = patch_redis_and_broadcast

    await _svc.handle_set_games(CODE, ADMIN, [])

    assert await deck_singleton.get_game_ids(CODE) == ["reflex", "tap_race", "roulette"]
    assert not any(m["type"] == "GAME_IDS_UPDATED" for m in captured)


@pytest.mark.asyncio
async def test_dedupes_preserving_order(lobby_room, patch_redis_and_broadcast):
    await _svc.handle_set_games(CODE, ADMIN, ["roulette", "reflex", "roulette"])

    assert await deck_singleton.get_game_ids(CODE) == ["roulette", "reflex"]


@pytest.mark.asyncio
async def test_admin_edit_and_concurrent_join_sync_never_interleave(
    patch_redis_and_broadcast, monkeypatch
):
    """Regression test for issue #69 (Phase 2): handle_set_games's writes
    now run under the room lock, same as _sync_eligible_games (triggered
    here by a concurrent join). Before this fix, an admin editing the
    lineup and another player joining at the same instant could interleave
    their deck.initialize calls — whichever one read admin_game_ids before
    the other's write committed, but wrote after it, would silently
    resurrect a game the admin had just removed."""
    r, captured = patch_redis_and_broadcast
    await r.hset(f"room:{CODE}", mapping={"state": RoomState.LOBBY, "admin_id": ADMIN})
    for i in range(4):
        await _join(f"existing-{i}")  # 4 players present
    await _svc.handle_set_games(CODE, ADMIN, ["reflex", "auction"])  # auction needs 5
    assert await deck_singleton.get_game_ids(CODE) == ["reflex"]  # auction pruned

    in_critical_section = 0
    max_observed_overlap = 0
    real_initialize = deck_singleton.initialize

    async def _spying_initialize(room_code, game_ids):
        nonlocal in_critical_section, max_observed_overlap
        in_critical_section += 1
        max_observed_overlap = max(max_observed_overlap, in_critical_section)
        await asyncio.sleep(0.01)  # widen the window so a real overlap would show up
        try:
            await real_initialize(room_code, game_ids)
        finally:
            in_critical_section -= 1

    monkeypatch.setattr(deck_singleton, "initialize", _spying_initialize)

    await asyncio.gather(
        _svc.handle_set_games(CODE, ADMIN, ["reflex", "tap_race"]),  # admin removes auction
        _join("existing-4"),  # 5th player — would make auction eligible again
    )

    assert max_observed_overlap == 1
    # The admin's explicit removal of "auction" must win outright — the
    # concurrent join's sync must never silently resurrect it based on a
    # stale pre-edit admin_game_ids read.
    assert await deck_singleton.get_game_ids(CODE) == ["reflex", "tap_race"]
