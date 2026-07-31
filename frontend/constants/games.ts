import type { ComponentType } from 'react';
import { Bomb, CircleSlash, Coins, Crosshair, Gavel, Hand, HandHeart, Package, Skull, Swords, Target, Timer, UserMinus, Users, Zap, type LucideIcon } from 'lucide-react-native';
import { BlackBoxCardStrip } from '@/components/rules/BlackBoxCardStrip';

// Frontend mirror of the backend GAME_REGISTRY — REST is limited to room
// create/join, so the catalog lives here. Keep in sync when adding a game.

export type GameCategory = 'speed' | 'luck' | 'strategy';

export const CATEGORY_LABELS: Record<GameCategory, string> = {
  speed: 'Speed',
  luck: 'Luck',
  strategy: 'Strategy',
};

export interface DrinkingRule {
  // Plain string, or RuleSegment[] to color/bold specific words (e.g. tint
  // "Drink"/"Distribute" red/green so the row reads at a glance).
  description: RuleLine;
  chasers: number;
  // One-or-two-word form for the tutorial preview's condensed chip row,
  // where `description` (written for the full-sentence rules screen) reads
  // as too long. Falls back to `description` when omitted.
  shortLabel?: string;
}

// A "how to play" line is usually a plain string, but a few call out a
// specific word (e.g. "red"/"green" in reflex) that should render in that
// color instead of the default ink — an array of segments does that inline.
// A segment's `text` may contain literal "\n" to force a line break within
// a single rule step (e.g. listing out two choices on their own lines).
export interface RuleSegment {
  text: string;
  // red/green/amber are the app-wide semantic trio (bad/good/caution).
  // blue/orange are a separate, non-semantic pair for tagging player
  // identity in a 2-role game (e.g. black_box's Player 1/Player 2) — pick
  // whichever category actually fits the word, don't force an identity tag
  // into red/green/amber just because those already exist.
  color?: 'red' | 'green' | 'amber' | 'blue' | 'orange';
  // Emphasize a segment without tinting it — for words that need to stand
  // out but aren't inherently "good"/"bad"/"caution" (which is what the
  // red/green/amber colors are for). Renders in the line's normal ink color
  // at a heavier weight instead.
  bold?: boolean;
}
export type RuleLine = string | RuleSegment[];

export interface ScoringEntry {
  // Plain string, or RuleSegment[] to color/bold specific words — same as
  // DrinkingRule.description.
  description: RuleLine;
  // Display-ready signed value, e.g. '+10', '-5', '0', or a range like
  // 'Between +10 and -10' for rank-scaled outcomes.
  points: string;
}

// A single "you chose X, they chose Y" outcome in a 2-player payoff matrix
// (e.g. Prisoner's Dilemma). Carries both the drink and point outcome so the
// same matrix can back both the "Who drinks" and "Scoring" sections.
export interface PairwiseCell {
  description: string;
  points: string;
  chasers: number;
}

export interface PairwiseMatrix {
  yourLabel: string;
  theirLabel: string;
  options: [string, string];
  // Optional per-option color for the header labels (e.g. Help=green, Betray=red) —
  // same red/green convention as RuleSegment, reused so the choice itself reads as
  // safe/risky at a glance without extra prose.
  optionColors?: [('red' | 'green')?, ('red' | 'green')?];
  // cells[yourChoiceIndex][theirChoiceIndex]
  cells: [[PairwiseCell, PairwiseCell], [PairwiseCell, PairwiseCell]];
}

export interface GameMeta {
  id: string;
  title: string;
  tagline: string;
  Icon: LucideIcon;
  // A game can span more than one bucket (e.g. closest_average is both a
  // guess against randomness and a read on the room's psychology).
  categories: GameCategory[];
  // Signature accent color for this game's cell/banner — swapped out once
  // real artwork lands, kept as the background behind the placeholder icon.
  accentColor: string;
  // Below this room size the game degrades badly (e.g. auction's pool/
  // distribution math wants a real crowd) — not enforced by the engine
  // (no mini-game gates on player count there), just a hint for whichever
  // screen lets the admin pick the room's games.
  minPlayers?: number;
  rules: RuleLine[];
  // A single short trigger→action line for the tutorial preview screen,
  // e.g. "When it turns green - tap fast!" — authored separately from
  // `rules` so it can be picked/phrased for maximum brevity while keeping
  // the same red/green word-coloring convention. Falls back to `tagline`
  // when omitted.
  tutorialCue?: RuleLine;
  // Short clarifying aside shown under the "How to play" steps — for a detail
  // that doesn't belong in the numbered flow (e.g. dilemma: the odd player
  // out sitting a round).
  rulesNote?: string;
  // Small illustrative visual rendered under the numbered "How to play"
  // steps, above rulesNote — for a mechanic that reads faster as a picture
  // than another numbered sentence (e.g. black_box: a strip of the actual
  // card faces instead of a line of text describing them).
  RulesIllustration?: ComponentType;
  drinkingRules: DrinkingRule[];
  // Short clarifying aside shown under the "Who drinks" list — for games
  // where two drinkingRules rows can both apply to the same player at once
  // (e.g. sacrifice: pledged AND the room still fell short).
  whoDrinksNote?: string;
  scoring: ScoringEntry[];
  // Only set for 2-player payoff-matrix games (currently just dilemma) —
  // when present, both "Who drinks" and "Scoring" render this grid instead
  // of the flat drinkingRules/scoring lists.
  pairwiseMatrix?: PairwiseMatrix;
}

// Shared shape for every free-for-all game scored by app.games.scoring.uniform_scores:
// 1st place always +10, last place always -10, everyone else scaled between by rank.
function rankedScoring(best: string, worst: string): ScoringEntry[] {
  return [
    { description: best, points: '+10' },
    { description: worst, points: '-10' },
    { description: 'Others: depends on the result (-10 to 10)', points: 'Between -10 and 10' },
  ];
}

export const GAME_CATALOG: GameMeta[] = [
  {
    id: 'reflex',
    title: 'Green Light',
    tagline: 'Tap the instant it flips green',
    Icon: Zap,
    categories: ['speed'],
    accentColor: '#16A34A',
    rules: [
      [{ text: 'A light on screen starts ' }, { text: 'red', color: 'red' }, { text: '. Wait for it.' }],
      [{ text: 'When it turns ' }, { text: 'green', color: 'green' }, { text: ', tap as fast as you can!' }],
      'Whoever reacts slowest, drinks.',
    ],
    tutorialCue: [{ text: 'When it turns ' }, { text: 'green', color: 'green' }, { text: ' - tap fast!' }],
    drinkingRules: [
      { description: 'Slowest', chasers: 1 },
      { description: 'Tapped during the red light', chasers: 1, shortLabel: 'Too early' },
      { description: 'Didn’t tap at all', chasers: 1, shortLabel: 'Didn’t tap' },
    ],
    scoring: rankedScoring('Fastest valid tap', 'Slowest tap, tapped early, or never tapped'),
  },
  {
    id: 'tap_race',
    title: 'Tap Race',
    tagline: 'Most taps in 10 seconds wins',
    Icon: Hand,
    categories: ['speed'],
    accentColor: '#2563EB',
    rules: [
      'A 10-second window opens.',
      'Tap as many times as you can!',
      'Whoever tapped the least, drinks.',
    ],
    tutorialCue: 'Tap as many times as you can!',
    drinkingRules: [
      { description: 'Fewest taps', chasers: 1 },
    ],
    scoring: rankedScoring('Most taps', 'Fewest taps'),
  },
  {
    id: 'human_timer',
    title: 'Human Timer',
    tagline: 'Count the seconds in your head',
    Icon: Timer,
    categories: ['speed'],
    accentColor: '#F59E0B',
    rules: [
      'A target number of seconds appears on screen.',
      'When you think that many seconds have passed, tap.',
      'Whoever’s furthest from the target, drinks.',
    ],
    tutorialCue: 'When you think the exact time shown has passed - tap!',
    drinkingRules: [
      { description: 'Farthest from the target time', chasers: 1, shortLabel: 'Farthest off' },
      { description: 'Never tapped', chasers: 1 },
    ],
    scoring: rankedScoring('Closest to the target time', 'Farthest off or never tapped'),
  },
  {
    id: 'roulette',
    title: 'Russian Roulette',
    tagline: 'Flip cards, dodge the poison',
    Icon: Skull,
    categories: ['luck'],
    accentColor: '#DC2626',
    rules: [
      [{ text: '6 face-down cards. One is ' }, { text: 'poison', color: 'red' }, { text: '.' }],
      'On your turn, flip a card or skip (once per game).',
      [
        { text: 'Whoever flips the ' },
        { text: 'poison', color: 'red' },
        { text: ' card, drinks.' },
      ],
    ],
    tutorialCue: [{ text: 'Flip a card - avoid the ' }, { text: 'poison', color: 'red' }, { text: '!' }],
    drinkingRules: [
      { description: 'Flipped the poison card', chasers: 3, shortLabel: 'Poison' },
      { description: 'Skipped your turn', chasers: 1, shortLabel: 'Skipped' },
    ],
    scoring: [
      { description: 'Safe reveal', points: '+3 to +7' },
      { description: 'Skipped your turn', points: '-5' },
      { description: 'Flipped the poison card', points: '-15' },
    ],
  },
  {
    id: 'coin_flip',
    title: "Liar's Coin",
    tagline: 'Heads or tails - the flipper may lie',
    Icon: Coins,
    categories: ['luck'],
    accentColor: '#EAB308',
    rules: [
      'One player is picked at random and flips a coin.',
      'They announce what came up - they’re allowed to lie.',
      'Everyone else guesses heads or tails. Wrong guess? You drink.',
      'If more guessed right than wrong, the flipper drinks double.',
    ],
    tutorialCue: 'Guess the flipper’s result!\nFlipper: try to fool the majority.',
    drinkingRules: [
      { description: 'Wrong guess', chasers: 1 },
      { description: 'Didn’t vote', chasers: 1, shortLabel: 'No vote' },
      { description: 'Flipper, more than half guessed right', chasers: 2, shortLabel: 'Flipper: majority right' },
    ],
    scoring: [
      { description: 'Correct guess', points: '+3' },
      { description: 'Wrong guess or no vote', points: '-3' },
      { description: 'Flipper, per wrong guesser', points: '+1' },
      { description: 'Flipper, per correct guesser', points: '-1' },
    ],
  },
  {
    id: 'closest_average',
    title: 'Closest Average',
    tagline: "Land nearest the room's average",
    Icon: Target,
    categories: ['luck', 'strategy'], // guessing the room's psychology against an unknown average
    accentColor: '#0EA5E9',
    minPlayers: 3, // 2 players are both the average, always equidistant from it
    rules: [
      'Everyone secretly picks a number from 0 to 99.',
      'The average of all picks is calculated.',
      'Whoever’s farthest from the average, drinks.',
    ],
    tutorialCue: 'Guess the number closest to the room’s average!',
    drinkingRules: [
      { description: 'Farthest from the room average', chasers: 1, shortLabel: 'Farthest off' },
    ],
    scoring: rankedScoring('Closest to the room average', 'Farthest from the room average'),
  },
  {
    id: 'sacrifice',
    title: 'The Sacrifice',
    tagline: 'Volunteer chasers before the clock runs out',
    Icon: HandHeart,
    categories: ['strategy'],
    accentColor: '#7C3AED',
    rules: [
      'The room gets a target number of chasers that need to be drunk.',
      'A 30-second timer starts.',
      'Tap the button to sacrifice a chaser - the target drops by 1 each time.',
      'If time runs out before the target hits 0, everyone drinks.',
      'If the target hits 0 in time, volunteers drink what they pledged.',
    ],
    tutorialCue: [
      { text: 'Tap ' },
      { text: '"I\'m in"', color: 'amber' },
      { text: ' to take a chaser - hit ' },
      { text: '0' },
      { text: ', room’s ' },
      { text: 'safe', color: 'green' },
      { text: '!' },
    ],
    drinkingRules: [
      { description: 'Room falls short', chasers: 1, shortLabel: 'Fell short' },
      { description: 'Per chaser you pledged', chasers: 1, shortLabel: 'Per pledge' },
    ],
    whoDrinksNote: 'The room fell short and you volunteered? Sorry - you drink both.',
    scoring: [
      { description: 'Room saved, per chaser pledged', points: '+10' },
      { description: 'Room falls short, per chaser owed', points: '-5' },
      { description: 'Didn’t volunteer', points: '0' },
    ],
  },
  {
    id: 'dilemma',
    title: "Prisoner's Dilemma",
    tagline: 'Help your partner or betray them - in secret',
    Icon: Swords,
    categories: ['strategy'],
    accentColor: '#DB2777',
    minPlayers: 2,
    rules: [
      'Players are randomly paired up.',
      [
        { text: 'Each half of the pair privately chooses ' },
        { text: 'Help', color: 'green' },
        { text: ' or ' },
        { text: 'Betray', color: 'red' },
        { text: '.' },
      ],
      'Outcomes depend on both choices - see the grid below.',
    ],
    rulesNote: 'If the room has an odd number of players, one sits out and doesn’t play this round.',
    tutorialCue: [
      { text: 'Pick ' },
      { text: 'Help', color: 'green' },
      { text: ' or ' },
      { text: 'Betray', color: 'red' },
      { text: ' - in secret.' },
    ],
    drinkingRules: [
      { description: 'Odd player out - immune', chasers: 0, shortLabel: 'Sits out' },
    ],
    scoring: [],
    pairwiseMatrix: {
      yourLabel: 'You',
      theirLabel: 'Them',
      options: ['Help', 'Betray'],
      optionColors: ['green', 'red'],
      cells: [
        [
          { description: 'Mutual help', points: '+5', chasers: 0 },
          { description: 'You helped, they betrayed you', points: '-10', chasers: 2 },
        ],
        [
          { description: 'You betrayed them and walked free', points: '+10', chasers: 0 },
          { description: 'Mutual betrayal', points: '-5', chasers: 1 },
        ],
      ],
    },
  },
  {
    id: 'majority',
    title: 'Go with the Flow',
    tagline: 'Land with the crowd and win',
    Icon: Users,
    categories: ['strategy'],
    accentColor: '#059669',
    rules: [
      'A question is shown on screen with two possible answers.',
      [
        { text: 'Choose an answer - your goal is to land with the ' },
        { text: 'majority', color: 'green' },
        { text: '.' },
      ],
      [
        { text: 'Land with the ' },
        { text: 'minority', color: 'red' },
        { text: ', you drink.' },
      ],
    ],
    rulesNote: 'Tie? A coin flip picks one answer - everyone who chose it drinks.',
    tutorialCue: [{ text: 'Land with the ' }, { text: 'majority', color: 'green' }, { text: ' to win.' }],
    drinkingRules: [
      { description: 'Picked the minority', chasers: 1, shortLabel: 'Minority' },
      { description: 'Tie, and the coin landed on your answer', chasers: 1, shortLabel: 'Lost the tie' },
    ],
    scoring: [
      { description: 'Landed with the majority', points: '+5' },
      { description: 'Landed with the minority', points: '-5' },
      { description: 'Exact tie', points: '0' },
    ],
  },
  {
    id: 'minority',
    title: 'Against the Flow',
    tagline: 'Guess what the minority wants',
    Icon: UserMinus,
    categories: ['strategy'],
    accentColor: '#EA580C',
    rules: [
      'A question is shown on screen with two possible answers.',
      [
        { text: 'Choose an answer - your goal is to land with the ' },
        { text: 'minority', color: 'green' },
        { text: '.' },
      ],
      [
        { text: 'Land with the ' },
        { text: 'majority', color: 'red' },
        { text: ', you drink.' },
      ],
    ],
    rulesNote: 'Tie? A coin flip picks one answer - everyone who chose it drinks.',
    tutorialCue: [{ text: 'Land with the ' }, { text: 'minority', color: 'green' }, { text: ' to win.' }],
    drinkingRules: [
      { description: 'Picked the majority', chasers: 1, shortLabel: 'Majority' },
      { description: 'Tie, and the coin landed on your answer', chasers: 1, shortLabel: 'Lost the tie' },
    ],
    scoring: [
      { description: 'Landed with the minority', points: '+5' },
      { description: 'Landed with the majority', points: '-5' },
      { description: 'Exact tie', points: '0' },
    ],
  },
  {
    id: 'strong_point',
    title: 'Strong Point',
    tagline: 'Hit the zone the instant it appears',
    Icon: Crosshair,
    categories: ['speed'],
    accentColor: '#00D4FF',
    rules: [
      'A random point is chosen on the screen.',
      'It grows into a circle - slowly.',
      'Tap it as fast as you can.',
    ],
    tutorialCue: 'Tap the zone as fast as you can!',
    drinkingRules: [
      { description: 'Slowest to hit it', chasers: 1, shortLabel: 'Slowest' },
      { description: 'Tapped outside the circle', chasers: 1, shortLabel: 'Missed' },
      { description: 'Didn’t tap at all', chasers: 1, shortLabel: 'Didn’t tap' },
    ],
    scoring: [
      { description: 'Slowest, missed, or never tapped', points: '-10' },
      { description: 'Fastest hit inside the circle', points: '+10' },
      { description: 'Others: depends on the result', points: 'Between -10 and 10' },
    ],
  },
  {
    id: 'flying_bomb',
    title: 'Flying Bomb',
    tagline: 'Swipe it away before the clock runs out',
    Icon: Bomb,
    categories: ['speed'],
    accentColor: '#B91C1C',
    minPlayers: 3,
    rules: [
      'A timer is running.',
      'Swipe any bomb on your screen - the goal is to pass it off to other players.',
      'Be bomb-free on your screen when the timer runs out.',
    ],
    rulesNote: 'Your left and right always send to the same two neighbors all round.',
    tutorialCue: 'Swipe left or right to pass it!',
    drinkingRules: [
      { description: 'Per bomb you’re holding when time runs out', chasers: 1, shortLabel: 'Per bomb' },
    ],
    scoring: [
      { description: 'Per bomb held when time runs out', points: '-7' },
    ],
  },
  {
    id: 'twenty_one',
    title: '21',
    tagline: 'Push the counter up - don’t be the one who hits 21',
    Icon: CircleSlash,
    categories: ['strategy'],
    accentColor: '#D946EF',
    rules: [
      'A shared counter starts at 0.',
      [{ text: 'On your turn, raise the counter by ' }, { text: '+1, +2, or +3', bold: true }, { text: '.' }],
      [{ text: 'Whoever lands on exactly ' }, { text: '21', color: 'red' }, { text: ', drinks.' }],
    ],
    tutorialCue: [{ text: 'Push it up - don’t be the one who hits ' }, { text: '21', color: 'red' }, { text: '.' }],
    drinkingRules: [
      { description: 'Landed on 21', chasers: 2, shortLabel: 'Hit 21' },
    ],
    scoring: [
      { description: 'Landed on 21', points: '-8' },
      { description: 'Everyone else', points: '+2' },
    ],
  },
  {
    id: 'auction',
    title: 'Auction',
    tagline: 'Bid chasers and points to run the table',
    Icon: Gavel,
    categories: ['strategy'],
    accentColor: '#0F7938',
    minPlayers: 5,
    rules: [
      'A prize goes up for auction - a set number of chasers to divide among the room.',
      'The auction opens - bidding is in chasers (that you’d drink) and points at once.',
      'Raise the bid with the quick buttons or a custom amount - each new bid must beat the last.',
      'Every raise resets a 15-second clock.',
      'When the clock runs out, the highest bidder wins the prize and pays what they bid.',
      'The winner divides the chasers among everyone else.',
    ],
    rulesNote: 'Nobody bids before the clock runs out? The round is a wash - nobody drinks.',
    tutorialCue: [{ text: 'Outbid the room - then make ' }, { text: 'them', color: 'red' }, { text: ' drink.' }],
    drinkingRules: [
      { description: 'Auction winner, per chaser they bid', chasers: 1, shortLabel: 'Winner’s bid' },
      { description: 'Whoever the winner picked', chasers: 1, shortLabel: 'Picked' },
    ],
    whoDrinksNote: 'Nobody can be handed more than 2 chasers from the pool.',
    scoring: [
      { description: 'Auction winner, per point they bid', points: '?' },
    ],
  },
  {
    id: 'black_box',
    title: 'Black Box',
    tagline: 'Choose a card - then convince them what’s inside',
    Icon: Package,
    categories: ['luck', 'strategy'], // sealed pick is chance; the bluff is strategy
    accentColor: '#475569',
    minPlayers: 2,
    rules: [
      'Two players are picked at random.',
      [
        { text: 'Player 1', color: 'blue' },
        { text: ' picks 1 of 6 cards shown below and flips it - only they can see it.' },
      ],
      [
        { text: 'A timer starts. ' },
        { text: 'Player 2', color: 'orange' },
        { text: ' has two choices:\n' },
        { text: 'Take the card from ' },
        { text: 'Player 1', color: 'blue' },
        { text: '.\nOr leave it with them.' },
      ],
      [
        { text: 'Player 1', color: 'blue' },
        { text: ' can talk to ' },
        { text: 'Player 2', color: 'orange' },
        { text: ' the whole time - and try to mislead them.' },
      ],
      'When the timer ends, whoever is holding the card reveals it and does what it says.',
      'Every card in the deck:',
    ],
    RulesIllustration: BlackBoxCardStrip,
    rulesNote: 'Not picked this round? Sit back and enjoy the show.',
    tutorialCue: [
      { text: 'Bluff what’s inside - ' },
      { text: 'Drink', color: 'red' },
      { text: ' or ' },
      { text: 'Distribute', color: 'green' },
      { text: '? They won’t know.' },
    ],
    drinkingRules: [
      {
        description: [
          { text: 'Ends up holding a ' },
          { text: 'Drink card', color: 'red' },
          { text: ', per chaser shown' },
        ],
        chasers: 1,
        shortLabel: 'Drink card',
      },
      {
        description: [
          { text: 'Chosen to drink by whoever holds a ' },
          { text: 'Distribute card', color: 'green' },
        ],
        chasers: 1,
        shortLabel: 'Handed chasers',
      },
    ],
    scoring: [
      {
        description: [
          { text: 'Ends up with a ' },
          { text: 'Drink card', color: 'red' },
          { text: ', per chaser' },
        ],
        points: '-5',
      },
      {
        description: [
          { text: 'Ends up with a ' },
          { text: 'Distribute card', color: 'green' },
          { text: ', per chaser' },
        ],
        points: '+5',
      },
    ],
  },
];

export function getGameById(id: string): GameMeta | undefined {
  return GAME_CATALOG.find((g) => g.id === id);
}
