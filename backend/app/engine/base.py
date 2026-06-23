from abc import ABC, abstractmethod
from typing import Any


class BaseMiniGame(ABC):
    game_id: str
    tutorial_type: str  # "timed_text" | "video" | "interactive"
    tutorial_asset: str  # URI or i18n key

    @abstractmethod
    def get_initial_state(self, players: list[dict[str, Any]]) -> dict[str, Any]:
        """Returns the starting payload broadcast to all clients."""

    @abstractmethod
    def handle_ws_event(
        self,
        player_id: str,
        payload: dict[str, Any],
        current_state: dict[str, Any],
    ) -> tuple[dict[str, Any], bool, dict[str, dict[str, Any]]]:
        """
        Processes a client action.
        Returns: (updated_game_state, is_finished, outcomes_dict)
        When is_finished is True, FSM strips outcomes_dict and
        transitions the room to PERSONAL_SUMMARY.
        """

    def on_timeout(
        self, current_state: dict[str, Any]
    ) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
        """
        Called by the engine when the server-side tap window expires and the
        game hasn't already finished via handle_ws_event.
        Returns: (updated_game_state, outcomes_dict)
        Default: no-op — games without a timeout concept return empty outcomes.
        """
        return current_state, {}
