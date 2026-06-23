from app.engine.base import BaseMiniGame

# Full implementation in M4 (Issue #21)


class RedLightGreenLight(BaseMiniGame):
    game_id = "red_light_green_light"
    tutorial_type = "timed_text"
    tutorial_asset = "tutorial.red_light_green_light"

    def get_initial_state(self, players):  # type: ignore[override]
        raise NotImplementedError

    def handle_ws_event(self, player_id, payload, current_state):  # type: ignore[override]
        raise NotImplementedError
