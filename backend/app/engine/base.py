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
