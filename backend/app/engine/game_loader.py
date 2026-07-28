from app.engine.base import BaseMiniGame
from app.games.auction import AuctionGame
from app.games.black_box import BlackBoxGame
from app.games.closest_average import ClosestAverageGame
from app.games.coin_flip import CoinFlipGame
from app.games.dilemma import DilemmaGame
from app.games.flying_bomb import FlyingBombGame
from app.games.human_timer import HumanTimerGame
from app.games.majority import MajorityGame, MinorityGame
from app.games.reflex import ReflexGame
from app.games.roulette import RouletteGame
from app.games.sacrifice import SacrificeGame
from app.games.strong_point import StrongPointGame
from app.games.tap_race import TapRaceGame
from app.games.twenty_one import TwentyOneGame

GAME_REGISTRY: dict[str, type[BaseMiniGame]] = {
    AuctionGame.game_id: AuctionGame,
    BlackBoxGame.game_id: BlackBoxGame,
    ReflexGame.game_id: ReflexGame,
    TapRaceGame.game_id: TapRaceGame,
    HumanTimerGame.game_id: HumanTimerGame,
    RouletteGame.game_id: RouletteGame,
    CoinFlipGame.game_id: CoinFlipGame,
    ClosestAverageGame.game_id: ClosestAverageGame,
    SacrificeGame.game_id: SacrificeGame,
    DilemmaGame.game_id: DilemmaGame,
    MajorityGame.game_id: MajorityGame,
    MinorityGame.game_id: MinorityGame,
    StrongPointGame.game_id: StrongPointGame,
    FlyingBombGame.game_id: FlyingBombGame,
    TwentyOneGame.game_id: TwentyOneGame,
}


def load_game(game_id: str) -> BaseMiniGame:
    cls = GAME_REGISTRY.get(game_id)
    if cls is None:
        raise ValueError(f"Unknown game_id: {game_id!r}")
    return cls()
