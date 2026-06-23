import pytest

from app.engine.base import BaseMiniGame
from app.engine.game_loader import GAME_REGISTRY, load_game


def test_load_known_game_returns_base_mini_game_instance():
    game = load_game("red_light_green_light")
    assert isinstance(game, BaseMiniGame)


def test_load_unknown_game_raises_value_error():
    with pytest.raises(ValueError, match="Unknown game_id"):
        load_game("not_a_real_game")


def test_registry_contains_red_light_green_light():
    assert "red_light_green_light" in GAME_REGISTRY


def test_incomplete_subclass_raises_type_error_on_instantiation():
    class MissingBothMethods(BaseMiniGame):
        game_id = "incomplete"
        tutorial_type = "timed_text"
        tutorial_asset = "some_asset"

    with pytest.raises(TypeError):
        MissingBothMethods()


def test_subclass_missing_one_method_raises_type_error():
    class MissingHandleWsEvent(BaseMiniGame):
        game_id = "partial"
        tutorial_type = "timed_text"
        tutorial_asset = "some_asset"

        def get_initial_state(self, players):  # type: ignore[override]
            return {}

    with pytest.raises(TypeError):
        MissingHandleWsEvent()
