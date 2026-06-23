from app.engine.base import BaseMiniGame
from app.games.red_light_green_light import RedLightGreenLight

GAME_REGISTRY: dict[str, type[BaseMiniGame]] = {
    RedLightGreenLight.game_id: RedLightGreenLight,
}


def load_game(game_id: str) -> BaseMiniGame:
    cls = GAME_REGISTRY.get(game_id)
    if cls is None:
        raise ValueError(f"Unknown game_id: {game_id!r}")
    return cls()
