"""
Regression tests for Total Drinks (cumulative chasers).

_enrich_scores_and_broadcast already accumulates `score` across rounds via
a full player-record read-modify-write; `total_chasers` needs the same
treatment, and — since that write in handle_handshake fully replaces the
player record — needs to be explicitly carried forward on every reconnect,
or it would silently reset to 0 the next time a player's own screen
transition (or any reconnect) triggers a fresh HANDSHAKE.

Strategy mirrors test_ws_game.py / test_late_join.py: patch module-level
`redis` with fakeredis, replace `room_service.broadcast` with a
list-capturing stub, and patch the `deck` singleton's own real Redis client
(handle_handshake's ROOM_STATE snapshot reads it directly).
"""
import json

import fakeredis
import pytest

import app.engine.fsm as fsm_module
import app.engine.room_service as rs_module
from app.engine.base import BaseMiniGame
from app.engine.deck import deck
from app.engine.fsm import RoomState

CODE = "TSTCD"
ADMIN = "admin-uuid"
PLAYER = "player-uuid"

_svc = rs_module.room_service


class _ChaserGame(BaseMiniGame):
    """Every finish awards the acting player 5 score and 2 chasers, and a
    second player 0 score / 1 chaser — enough to distinguish score
    accumulation from chasers accumulation in assertions."""
    game_id = "test_chaser"
    tutorial_type = "timed_text"
    tutorial_asset = "test"

    def get_initial_state(self, players: list) -> dict:
        return {}

    def handle_ws_event(self, player_id: str, payload: dict, current_state: dict) -> tuple:
        outcomes = {
            player_id: {"score_delta": 5, "chasers": 2},
            "bystander": {"score_delta": 0, "chasers": 1},
        }
        return current_state, True, outcomes


@pytest.fixture(autouse=True)
def patch_redis_and_broadcast(monkeypatch):
    r = fakeredis.FakeAsyncRedis(decode_responses=True)
    monkeypatch.setattr(rs_module, "redis", r)
    monkeypatch.setattr(fsm_module, "redis", r)
    monkeypatch.setattr(deck, "_redis", r)
    monkeypatch.setattr(rs_module, "load_game", lambda _: _ChaserGame())

    captured: list[dict] = []

    async def _mock_broadcast(code: str, message: dict) -> None:
        captured.append(message)

    monkeypatch.setattr(_svc, "broadcast", _mock_broadcast)
    monkeypatch.setattr(_svc, "_connections", {})

    return r, captured


def _player_json(**overrides) -> str:
    base = {"display_name": "P", "score": 0, "clock_offset": 0, "avatar": None}
    base.update(overrides)
    return json.dumps(base)


class _FakeWebSocket:
    async def send_text(self, _text: str) -> None:
        pass


async def test_enrich_scores_accumulates_total_chasers_across_rounds(patch_redis_and_broadcast):
    r, captured = patch_redis_and_broadcast
    await r.hset(f"room:{CODE}", mapping={"state": RoomState.PLAYING, "admin_id": ADMIN, "active_game": "test_chaser"})
    await r.hset(f"room:{CODE}:players", mapping={
        PLAYER: _player_json(score=10, total_chasers=3),
        "bystander": _player_json(score=0, total_chasers=1),
    })
    await r.set(f"room:{CODE}:game", json.dumps({}))

    await _svc.handle_game_action(CODE, PLAYER, {})

    player = json.loads(await r.hget(f"room:{CODE}:players", PLAYER))
    bystander = json.loads(await r.hget(f"room:{CODE}:players", "bystander"))
    assert player["score"] == 15  # 10 base + 5 delta, unaffected by this change
    assert player["total_chasers"] == 5  # 3 base + 2 this round
    assert bystander["total_chasers"] == 2  # 1 base + 1 this round

    outcomes_msg = next(m for m in captured if m["type"] == "OUTCOMES")
    assert outcomes_msg["outcomes"][PLAYER]["total_score"] == 15


async def test_handshake_reconnect_preserves_total_chasers(patch_redis_and_broadcast):
    r, captured = patch_redis_and_broadcast
    await r.hset(f"room:{CODE}", mapping={"state": RoomState.LOBBY, "admin_id": ADMIN})
    await r.hset(f"room:{CODE}:players", PLAYER, _player_json(total_chasers=7))

    await _svc.handle_handshake(CODE, _FakeWebSocket(), {
        "player_id": PLAYER,
        "display_name": "Reconnecting",
        "local_ts": 0,
    })

    player = json.loads(await r.hget(f"room:{CODE}:players", PLAYER))
    assert player["total_chasers"] == 7

    joined_msg = next(m for m in captured if m["type"] == "PLAYER_JOINED")
    assert joined_msg["total_chasers"] == 7


async def test_new_player_starts_with_zero_total_chasers(patch_redis_and_broadcast):
    r, captured = patch_redis_and_broadcast
    await r.hset(f"room:{CODE}", mapping={"state": RoomState.LOBBY, "admin_id": ADMIN})

    await _svc.handle_handshake(CODE, _FakeWebSocket(), {
        "player_id": PLAYER,
        "display_name": "New",
        "local_ts": 0,
    })

    player = json.loads(await r.hget(f"room:{CODE}:players", PLAYER))
    assert player["total_chasers"] == 0
