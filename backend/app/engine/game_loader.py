from app.engine.base import BaseMiniGame
from app.games.reflex import ReflexGame

GAME_REGISTRY: dict[str, type[BaseMiniGame]] = {
    ReflexGame.game_id: ReflexGame,
}


def load_game(game_id: str) -> BaseMiniGame:
    cls = GAME_REGISTRY.get(game_id)
    if cls is None:
        raise ValueError(f"Unknown game_id: {game_id!r}")
    return cls()
