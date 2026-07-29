import type { FC } from 'react';
import { AuctionTutorial } from '@/components/tutorials/AuctionTutorial';
import { BlackBoxTutorial } from '@/components/tutorials/BlackBoxTutorial';
import { ClosestAverageTutorial } from '@/components/tutorials/ClosestAverageTutorial';
import { CoinFlipTutorial } from '@/components/tutorials/CoinFlipTutorial';
import { DilemmaTutorial } from '@/components/tutorials/DilemmaTutorial';
import { FlyingBombTutorial } from '@/components/tutorials/FlyingBombTutorial';
import { HumanTimerTutorial } from '@/components/tutorials/HumanTimerTutorial';
import { MajorityTutorial } from '@/components/tutorials/MajorityTutorial';
import { MinorityTutorial } from '@/components/tutorials/MinorityTutorial';
import { ReflexTutorial } from '@/components/tutorials/ReflexTutorial';
import { RouletteTutorial } from '@/components/tutorials/RouletteTutorial';
import { SacrificeTutorial } from '@/components/tutorials/SacrificeTutorial';
import { StrongPointTutorial } from '@/components/tutorials/StrongPointTutorial';
import { TapRaceTutorial } from '@/components/tutorials/TapRaceTutorial';
import { TwentyOneTutorial } from '@/components/tutorials/TwentyOneTutorial';

// Keyed by the backend's `tutorial_asset` string (see each game class in
// backend/app/games/*.py) — shared by the in-room tutorial screen
// (app/room/[code]/tutorial.tsx) and the standalone preview reachable from
// a game's rules screen (app/games/[id]/tutorial.tsx), so the mapping only
// lives in one place.
export const TUTORIAL_COMPONENTS: Record<string, FC> = {
  'tutorial.auction': AuctionTutorial,
  'tutorial.black_box': BlackBoxTutorial,
  'tutorial.reflex': ReflexTutorial,
  'tutorial.tap_race': TapRaceTutorial,
  'tutorial.human_timer': HumanTimerTutorial,
  'tutorial.roulette': RouletteTutorial,
  'tutorial.coin_flip': CoinFlipTutorial,
  'tutorial.closest_average': ClosestAverageTutorial,
  'tutorial.sacrifice': SacrificeTutorial,
  'tutorial.dilemma': DilemmaTutorial,
  'tutorial.majority': MajorityTutorial,
  'tutorial.minority': MinorityTutorial,
  'tutorial.strong_point': StrongPointTutorial,
  'tutorial.flying_bomb': FlyingBombTutorial,
  'tutorial.twenty_one': TwentyOneTutorial,
};

export function getTutorialComponent(gameId: string): FC | null {
  return TUTORIAL_COMPONENTS[`tutorial.${gameId}`] ?? null;
}
