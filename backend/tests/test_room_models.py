import pytest
from pydantic import ValidationError

from app.engine.game_loader import GAME_REGISTRY
from app.models.room import CreateRoomRequest


def test_defaults_to_full_registry():
    req = CreateRoomRequest(admin_id="p1")
    assert req.game_ids == list(GAME_REGISTRY.keys())


def test_accepts_subset_of_registry():
    req = CreateRoomRequest(admin_id="p1", game_ids=["roulette", "reflex"])
    assert req.game_ids == ["roulette", "reflex"]


def test_rejects_unknown_game_id():
    with pytest.raises(ValidationError, match="Unknown game_ids"):
        CreateRoomRequest(admin_id="p1", game_ids=["reflex", "beer_pong"])


def test_rejects_empty_selection():
    with pytest.raises(ValidationError, match="at least one enabled game"):
        CreateRoomRequest(admin_id="p1", game_ids=[])


def test_dedupes_preserving_order():
    req = CreateRoomRequest(
        admin_id="p1", game_ids=["roulette", "reflex", "roulette"]
    )
    assert req.game_ids == ["roulette", "reflex"]


def test_practice_defaults_to_false():
    req = CreateRoomRequest(admin_id="p1", game_ids=["reflex"])
    assert req.practice is False


def test_practice_can_be_enabled():
    req = CreateRoomRequest(admin_id="p1", game_ids=["reflex"], practice=True)
    assert req.practice is True


def test_practice_role_defaults_to_none():
    req = CreateRoomRequest(admin_id="p1", game_ids=["black_box"], practice=True)
    assert req.practice_role is None


def test_practice_role_accepts_each_valid_value():
    for role in ("player_1", "player_2", "spectator"):
        req = CreateRoomRequest(admin_id="p1", game_ids=["black_box"], practice=True, practice_role=role)
        assert req.practice_role == role


def test_practice_role_rejects_unknown_value():
    with pytest.raises(ValidationError):
        CreateRoomRequest(admin_id="p1", game_ids=["black_box"], practice=True, practice_role="player_3")
