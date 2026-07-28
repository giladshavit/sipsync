import React from 'react';
import { View, Text } from 'react-native';
import { AuctionGameUI } from './games/AuctionGameUI';
import { BlackBoxGameUI, blackBoxRevealEndAt } from './games/BlackBoxGameUI';
import { SPECTATOR_PRE_HOLD_MS, SPECTATOR_STAGGER_MS } from './games/SharedChaserDistributor';
import { ClosestAverageGameUI } from './games/ClosestAverageGameUI';
import { CoinFlipGameUI } from './games/CoinFlipGameUI';
import { DilemmaGameUI } from './games/DilemmaGameUI';
import { FlyingBombGameUI } from './games/FlyingBombGameUI';
import { HumanTimerGameUI } from './games/HumanTimerGameUI';
import { MajorityGameUI } from './games/MajorityGameUI';
import { ReflexGameUI } from './games/ReflexGameUI';
import { RouletteGameUI } from './games/RouletteGameUI';
import { SacrificeGameUI } from './games/SacrificeGameUI';
import { StrongPointGameUI } from './games/StrongPointGameUI';
import { TapRaceGameUI } from './games/TapRaceGameUI';
import { TwentyOneGameUI } from './games/TwentyOneGameUI';

export interface MiniGameProps {
  gameState: Record<string, unknown>;
  onAction: (action: string, payload?: Record<string, unknown>) => void;
  clockOffset: number;
}

const GAME_REGISTRY: Record<string, React.FC<MiniGameProps>> = {
  auction: AuctionGameUI,
  black_box: BlackBoxGameUI,
  reflex: ReflexGameUI,
  tap_race: TapRaceGameUI,
  human_timer: HumanTimerGameUI,
  roulette: RouletteGameUI,
  coin_flip: CoinFlipGameUI,
  closest_average: ClosestAverageGameUI,
  sacrifice: SacrificeGameUI,
  dilemma: DilemmaGameUI,
  majority: MajorityGameUI,
  // Against the Flow is mechanically identical to Go with the Flow (same
  // component, driven entirely by the `mode` the backend broadcasts) — no
  // separate UI file, just a second registry entry.
  minority: MajorityGameUI,
  strong_point: StrongPointGameUI,
  flying_bomb: FlyingBombGameUI,
  twenty_one: TwentyOneGameUI,
  // Drop future games here — no other file changes needed.
};

// How long game.tsx keeps the game screen mounted after the server finishes
// the round, so end-of-game animations (poison flip, shake, loss banner) can
// play before navigating to the summary. Games not listed navigate instantly.
export const END_HOLD_MS: Record<string, number> = {
  auction: 3_200,
  // black_box is deliberately absent — its hold is fully computed in
  // getEndHoldMs from the live reveal-choreography clock the game UI
  // publishes (blackBoxRevealEndAt), since the reveal's length varies per
  // viewer (intro deferral, bot decision timing).
  roulette: 2_600,
  coin_flip: 3_200,
  closest_average: 7_800,
  // 2s pre-reveal pause (SUCCESS_REVEAL_DELAY_MS in SacrificeGameUI, so the
  // last volunteer's pledge toast gets seen before "ROOM SAFE" takes over)
  // plus the same reveal-visible time the hold always gave the outcome banner.
  sacrifice: 4_400,
  dilemma: 3_200,
  majority: 4_800,
  minority: 4_800,
  flying_bomb: 2_800,
  twenty_one: 3_000,
};

// A majority/minority tie runs a much longer reveal than a normal win/lose
// round (columns, then a full coin-flip animation, then the personal
// verdict) — game.tsx swaps to this hold instead of END_HOLD_MS whenever
// gameState.tie is true, so the coin flip actually finishes before the room
// moves on without dragging out every ordinary (non-tie) round.
export const TIE_END_HOLD_MS = 12_000;

// How long black_box's skull banner stays up once this client's reveal
// choreography has finished — the total hold is revealMsLeft + this beat,
// identical on every screen regardless of how the reveal was deferred.
const DRINK_BANNER_HOLD_MS = 3_200;

// Once a bot distributor's last paced pick has landed (and the plaque has
// flipped to its green "pool fully placed" check — the visual stand-in for
// a human pressing CONFIRM), hold this long to let the room digest who's
// drinking before the summary takes over.
const DISTRIBUTE_DIGEST_MS = 2_000;
// The pick-pop animation itself, after the last stagger slot fires.
const PICK_POP_MS = 760;

/** Per-round navigation hold — some games need zero delay for certain outcomes. */
export function getEndHoldMs(
  gameId: string | null | undefined,
  gameState: Record<string, unknown> | undefined,
  isPractice = false,
  playerId: string | null = null,
): number {
  if (gameId === 'black_box') {
    const boxes = (gameState?.boxes as { type: string; chasers: number }[] | undefined) ?? [];
    const idx = gameState?.chosen_box_index as number | null | undefined;
    const box = idx != null ? boxes[idx] : undefined;
    if (box?.type === 'DRINK') {
      // The reveal's total length varies per VIEWER (the Holder's long
      // private-peek intro defers it several seconds when a bot decides
      // early; spectators barely defer at all) — so instead of a fixed
      // worst-case hold that leaves some screens lingering on the skull
      // banner for 6-7s, wait exactly for this client's own reveal clock
      // (published by BlackBoxGameUI) plus one uniform banner beat.
      const revealMsLeft = Math.max(0, blackBoxRevealEndAt.current - Date.now());
      return revealMsLeft + DRINK_BANNER_HOLD_MS;
    }
    // Distribute outcome. DONE lands the moment the distributor confirms.
    // If that distributor is THIS client, they just pressed CONFIRM — the
    // reveal and the pour both played live under their fingers, go straight
    // to the summary.
    const isSelfDistributor = playerId != null && gameState?.target_player_id === playerId;
    if (isSelfDistributor) return 0;

    // Everyone else: never cut to summary until (1) this client's reveal
    // choreography has finished, (2) the paced "bot pour" has landed every
    // pick on screen (needed when a fast bot finished before the distribute
    // UI even mounted — the plaque then replays from empty), and (3) a 2s
    // digest beat after the green "pool fully placed" check (the bot's
    // stand-in for pressing CONFIRM).
    const revealMsLeft = Math.max(0, blackBoxRevealEndAt.current - Date.now());
    const assignments = (gameState?.assignments as Record<string, number> | undefined) ?? {};
    const picks = Object.values(assignments).filter((n) => n > 0).length;
    // Only schedule the empty→full replay when the reveal is still running
    // at DONE (distribute UI hasn't mounted yet). If the reveal already
    // ended, the spectator watched the bot place live — just the digest.
    const paceMs =
      revealMsLeft > 0
        ? SPECTATOR_PRE_HOLD_MS + Math.max(0, picks - 1) * SPECTATOR_STAGGER_MS + PICK_POP_MS
        : 0;
    const computed = revealMsLeft + paceMs + DISTRIBUTE_DIGEST_MS;
    // Practice safety: if the reveal clock was never published (race / late
    // mount / effect skipped), don't let a ~2s digest alone skip the whole
    // reveal+pour — hold long enough that a full sequence can still play.
    if (isPractice && blackBoxRevealEndAt.current === 0) {
      return Math.max(computed, 12_000);
    }
    return computed;
  }
  return END_HOLD_MS[gameId ?? ''] ?? 0;
}

interface Props {
  gameId: string | null;
  gameState?: Record<string, unknown>;
  onAction?: MiniGameProps['onAction'];
  clockOffset?: number;
}

export function ActiveGameScreen({
  gameId,
  gameState = {},
  onAction = () => {},
  clockOffset = 0,
}: Props) {
  if (!gameId) {
    return (
      <View className="flex-1 items-center justify-center">
        <Text className="text-slate-500">No active game</Text>
      </View>
    );
  }

  const GameComponent = GAME_REGISTRY[gameId];
  if (!GameComponent) {
    return (
      <View className="flex-1 items-center justify-center">
        <Text className="text-red-400">Unknown game: {gameId}</Text>
      </View>
    );
  }

  return (
    <GameComponent gameState={gameState} onAction={onAction} clockOffset={clockOffset} />
  );
}
