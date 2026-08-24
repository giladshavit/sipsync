"""Game kill switch: DISABLED_GAME_IDS silently drops disabled games at the
two entry points that accept game lists, without touching engine files.
Strategy mirrors test_room_gc.py: no engine, pure model/loader tests plus
monkeypatched DISABLED_GAME_IDS.
"""
import pytest

import app.engine.game_loader as loader
import app.models.room as room_models
from app.models.room import CreateRoomRequest, normalize_game_ids


@pytest.fixture
def disable_reflex(monkeypatch):
    monkeypatch.setattr(loader, "DISABLED_GAME_IDS", frozenset({"reflex"}))


def test_normalize_drops_disabled_silently(disable_reflex):
    assert normalize_game_ids(["reflex", "tap_race"]) == ["tap_race"]


def test_normalize_still_raises_on_unknown(disable_reflex):
    with pytest.raises(ValueError, match="Unknown game_ids"):
        normalize_game_ids(["definitely_not_a_game"])


def test_normalize_raises_when_nothing_playable_remains(disable_reflex):
    with pytest.raises(ValueError, match="at least one enabled game"):
        normalize_game_ids(["reflex"])


def test_create_room_default_excludes_disabled(disable_reflex):
    req = CreateRoomRequest(admin_id="a")
    assert "reflex" not in req.game_ids
    assert "tap_race" in req.game_ids


def test_all_games_enabled_by_default():
    assert loader.DISABLED_GAME_IDS == frozenset()
    assert normalize_game_ids(["reflex"]) == ["reflex"]
