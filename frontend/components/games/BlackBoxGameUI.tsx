import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  useSharedValue,
  useDerivedValue,
  useAnimatedStyle,
  withTiming,
  withSequence,
  withDelay,
  withRepeat,
  interpolate,
  interpolateColor,
  Easing,
  type SharedValue,
} from 'react-native-reanimated';
import {
  Check,
  Eye,
  GlassWater,
  Hand,
  Package,
  PackageOpen,
  Scale,
  Skull,
  X,
  type LucideIcon,
} from 'lucide-react-native';
import type { MiniGameProps } from '../ActiveGameScreen';
import { usePlayerIdentity } from '@/hooks/usePlayerIdentity';
import { colors, typography } from '@/constants/design';
import { AvatarCircle, Kicker, SharedChaserDistributor } from './SharedChaserDistributor';
import { CountdownRing } from './CountdownRing';

// Send EXPIRE a beat after the corrected deadline so the server (whose clock
// is authoritative) never sees it early; retry until the round resolves.
const EXPIRE_SLACK_MS = 400;
const EXPIRE_RETRY_MS = 1_000;

// ── Vault palette ─────────────────────────────────────────────────────────
const VAULT = '#1E2530';
const VAULT_DEEP = '#12161D';
const VAULT_LIGHT = '#39465A';
const VAULT_VIOLET = '#241F35'; // backdrop gradient top stop
const SLATE = '#475569'; // approved accent — borders, rings, secondary text
const SLATE_GLOW = '#94A3B8'; // brighter accent — active headline text, lamp glow

const PLAYER_A_TINT = colors.tapped;
const PLAYER_B_TINT = colors.orange;

// Everything felt too fast on first pass — every duration in this file
// (and, deliberately, in SharedChaserDistributor's own bot-assignment pop)
// is scaled up from its "natural" value through this single knob so the
// whole choreography can be paced as one decision.
const TIME_SCALE = 2.4;
const T = (ms: number): number => Math.round(ms * TIME_SCALE);

// ── Single-canvas stage geometry ─────────────────────────────────────────
// Everything below is a fixed constant, never a runtime `.measure()` — every
// element's position is either static or a pure transform between two known
// points, so a card's mid-flight coordinate is always knowable in advance
// (needed to make the grid→duel travel originate from the exact tapped
// tile).
const STAGE_W = 320;

const AVATAR_BLOCK_W = 78;
const AVATAR_BLOCK_H = 116;

const CARD_W = 92; // grid-tile size — no oversized "hero" card
const CARD_H = 122;
const TILE_GAP = 14;
const GRID_COLS = 3;
const GRID_ROWS = 2;
const GRID_W = GRID_COLS * CARD_W + (GRID_COLS - 1) * TILE_GAP;
const GRID_H = GRID_ROWS * CARD_H + (GRID_ROWS - 1) * TILE_GAP;
const GRID_LEFT = (STAGE_W - GRID_W) / 2;

// Grid + duel vertical insets — top player breathes below the header; bottom
// player + buttons anchor flush to the stage's lower edge (safe area handled
// on the outer screen container).
const DUEL_TOP_PAD = 28;
const DUEL_BOTTOM_PAD = 0;

interface StageLayout {
  gridP1Top: number;
  statusTextTop: number;
  gridTop: number;
  p1Y: number;
  p2Y: number;
  cardRestY: number;
  buttonsY: number;
}

function computeStageLayout(
  inverted: boolean,
  stageH: number,
  topPad: number,
  bottomPad: number,
): StageLayout {
  const gridP1Top = topPad;
  const statusTextTop = gridP1Top + AVATAR_BLOCK_H + 6;
  const gridTop = statusTextTop + 28;

  if (!inverted) {
    const labelBottom = stageH - bottomPad;
    const buttonsY = labelBottom - LABEL_H - 6 - BUTTONS_H;
    const p2Y = buttonsY - GAP_P2_BUTTONS - AVATAR_BLOCK_H;
    const p1Y = topPad;
    const cardRestY = p1Y + AVATAR_BLOCK_H + GAP_P1_CARD;
    return { gridP1Top, statusTextTop, gridTop, p1Y, p2Y, cardRestY, buttonsY };
  }

  // Inverted (the Holder's own view): Player 1 anchors at the BOTTOM and the
  // card sits tight against THEM — it's their box — mirroring the
  // non-inverted case where it hugs Player 1 at the top. The open duel lane
  // is whatever stretch remains between the card and Player 2 above.
  const buttonsY = topPad;
  const p2Y = buttonsY + BUTTONS_H + GAP_P2_BUTTONS;
  const p1Y = stageH - bottomPad - AVATAR_BLOCK_H;
  const cardRestY = p1Y - GAP_P1_CARD - CARD_H;
  return { gridP1Top, statusTextTop, gridTop, p1Y, p2Y, cardRestY, buttonsY };
}

// Duel phase (BLUFFING onward) — a band stack. The card always sits next to
// Player 1 (it starts in their hands, so the gap there is deliberately
// tight — unmistakably still theirs). The decision buttons are Player 2's
// own controls, so they sit on the FAR side of Player 2 — beyond their
// avatar, at the outer edge of the stack, never between the card and
// Player 2 — with a short status label beyond the buttons in the same
// outward direction ("Player 2 is deciding…" above the buttons when
// Player 1 is looking up at them; below when Player 2 is at the bottom).
//
// The stack itself mirrors vertically by viewer: the Holder (Player 1) sees
// themselves anchored at the BOTTOM of their own screen — standard
// dueling-game convention — while the Guesser and any spectators see the
// fixed Player-1-top / Player-2-bottom arrangement.
// Layout reserve for the decision row. Must cover the REAL rendered height
// of the full-size buttons (paddingVertical 15×2 + icon 24 + gap 6 + label
// ≈ 79px with borders) — a smaller reserve let the "is deciding" status
// label, placed at buttonsY + BUTTONS_H, land inside the buttons themselves.
const BUTTONS_H = 82;
const GAP_P1_CARD = 26; // Player 1's avatar → the card — tight, unmistakably theirs
const GAP_CARD_P2 = 108; // card ↔ Player 2's avatar — the open "duel lane" between them
const GAP_P2_BUTTONS = 18; // Player 2's avatar → the buttons — tight, they're P2's own controls
const LABEL_H = 26; // "Player 2 is deciding…" reserve, beyond the buttons
const CARD_PEEK_GAP = 10; // Holder-only private peek stop, even tighter than the rest band
const CARD_NEAR_OTHER_GAP = 26; // post-decision "arrives near the other player" stop
const SECRET_LABEL_H = 24; // Holder's own secret, beyond Player 1

const TIMER_SIZE = 72;
// Countdown lives in the screen's top-right corner (outside the duel lane)
// for every phase — never in the central avatar/card/button column.

function peekY(p1Y: number): number {
  return p1Y - CARD_PEEK_GAP - CARD_H;
}
function nearOtherY(p2Y: number, inverted: boolean): number {
  return inverted ? p2Y + AVATAR_BLOCK_H + CARD_NEAR_OTHER_GAP : p2Y - CARD_H - CARD_NEAR_OTHER_GAP;
}

function tileLeft(index: number): number {
  return GRID_LEFT + (index % GRID_COLS) * (CARD_W + TILE_GAP);
}
function tileTop(index: number, gridTop: number): number {
  return gridTop + Math.floor(index / GRID_COLS) * (CARD_H + TILE_GAP);
}

// ── Choreography timing ──────────────────────────────────────────────────
const HIGHLIGHT_MS = T(160); // tapped card's quick pulse before anything else moves
const VANISH_MS = T(240); // the 5 unselected cards popping away
const TRAVEL_MS = T(440); // grid slot → duel lane (or → the private-peek stop, for A)
const PEEK_FLIP_MS = T(260); // each half of A's private open/close flap
const PEEK_HOLD_MS = 2_000; // how long A sees the real content before it re-seals —
// a deliberate absolute 2s (not TIME_SCALE-derived): this is reading time
// for the round's one secret, not choreography pacing
const SETTLE_MS = T(380); // A only: peek stop → final duel lane, after re-sealing
const ENTER_DELAY_MS = T(100);
const ENTER_MS = T(320); // Player 2's avatar + the decision buttons fading/scaling in

// Post-decision: the chosen button pops and holds so everyone registers
// what B picked BEFORE anything else on stage moves.
const DECISION_HOLD_MS = T(700);
const BUTTON_FADE_MS = T(280); // the decision row fades out (opacity only — never unmounts) so it never
// visually collides with the card once it starts traveling; timed to finish exactly as DECISION_HOLD_MS ends
const PRE_FLIP_GAP_MS = T(200); // a beat between "arrived at the holder" and starting the center-stage move
const RESOLVE_SLIDE_MS = T(420); // box changing hands, if it does (Take It)

// The cinematic climax: once the box has settled with its holder, it ZOOMS
// up to the true center of the screen, growing large while everything else
// goes dark; the holder's avatar + name fade in ABOVE the enlarged card,
// then — after a long, deliberate tension hold — it flips open. The whole
// approach-and-flip runs ~5 real seconds by design.
const REVEAL_SCALE = 1.9; // how large the centered card grows during the reveal
const CENTER_TRAVEL_MS = T(650); // ≈1.6s — the zoom to center
const DIM_MS = T(650); // darkness settles in step with the zoom
const IDENTITY_DELAY_MS = T(400); // holder identity arrives late in the zoom
const IDENTITY_MS = T(380);
const PRE_FLIP_GAP2_MS = T(950); // ≈2.3s of held tension once centered, before the flip
const RESOLVE_FLIP_MS = T(400); // ≈1s flip
// The DRINK outcome has nowhere else to go, so it's fine to linger on the
// reveal. DISTRIBUTE hands off to the live distributor phase — it used to
// cut away the instant the flip finished, which read as "wait, what did
// the card even say?": now the opened green card holds on screen for a
// real beat before the distributor UI takes over. Bot assignments that
// land during this hold are still shown one-by-one by the distributor's
// own spectator pacing (SharedChaserDistributor's pre-hold).
const RESOLVE_HOLD_MS = T(750);
const RESOLVE_HOLD_MS_DISTRIBUTE = T(800);

// Wall-clock timestamp of when the current reveal choreography ends, published
// for getEndHoldMs (ActiveGameScreen): the skull-banner navigation hold is
// computed from THIS instead of a fixed worst-case constant, so the banner
// gets the same short beat on screen no matter how much the reveal was
// deferred on this particular viewer's screen (intro length and bot decision
// timing both vary per client). 0 = no reveal scheduled (fresh round, late
// joiner) — callers fall back to a plain banner-length hold.
export const blackBoxRevealEndAt = { current: 0 };

interface BoxContent {
  type: 'DRINK' | 'DISTRIBUTE';
  chasers: number;
}

// ── Vault backdrop ────────────────────────────────────────────────────────

const LAMP_RINGS = [
  { size: 560, top: -220, opacity: 0.045 },
  { size: 360, top: -110, opacity: 0.07 },
  { size: 200, top: -20, opacity: 0.1 },
];

function VaultBackdrop(): React.ReactElement {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <LinearGradient
        colors={[VAULT_VIOLET, VAULT_DEEP, colors.ink]}
        locations={[0, 0.45, 1]}
        style={StyleSheet.absoluteFill}
      />
      {LAMP_RINGS.map(({ size, top, opacity }) => (
        <View
          key={size}
          style={{
            position: 'absolute',
            top,
            left: '50%',
            width: size,
            height: size,
            marginLeft: -size / 2,
            borderRadius: size / 2,
            backgroundColor: SLATE_GLOW,
            opacity,
          }}
        />
      ))}
    </View>
  );
}

// ── Card chrome ───────────────────────────────────────────────────────────

function CardChrome({
  width,
  height,
  borderColor,
  glow,
  gradient,
  children,
}: {
  width: number;
  height: number;
  borderColor: string;
  glow: boolean;
  gradient: [string, string, string];
  children?: React.ReactNode;
}): React.ReactElement {
  return (
    <View
      style={{
        width,
        height,
        borderRadius: 18,
        overflow: 'hidden',
        borderWidth: 2.5,
        borderColor,
        shadowColor: glow ? borderColor : '#000000',
        shadowOpacity: glow ? 0.55 : 0.4,
        shadowRadius: glow ? 16 : 9,
        shadowOffset: { width: 0, height: glow ? 0 : 7 },
        elevation: glow ? 10 : 6,
      }}
    >
      <LinearGradient colors={gradient} locations={[0, 0.55, 1]} style={StyleSheet.absoluteFill} />
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: 5,
          left: 5,
          right: 5,
          bottom: 5,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: 'rgba(148,163,184,0.28)',
        }}
      />
      {children}
    </View>
  );
}

// ── Card back — the sealed content (drink/distribute, which color) never
// leaks through, so the Holder has no visual "tell" to worry about the
// Guesser reading. Its BORDER is a separate signal — whose hands it's
// currently in — tinted Player 1's blue by default and crossfading to
// Player 2's orange exactly as the card slides to them, driven by the same
// `ownership` progress that drives the slide itself. That's public
// information (everyone can see who's holding the box) so it doesn't
// compete with the actual secret. ─────────────────────────────────────────

function CardBack({
  width,
  height,
  ownership,
}: {
  width: number;
  height: number;
  ownership: SharedValue<number>;
}): React.ReactElement {
  const pulse = useSharedValue(1);
  useEffect(() => {
    pulse.value = withRepeat(
      withSequence(
        withTiming(1.08, { duration: T(900), easing: Easing.inOut(Easing.sin) }),
        withTiming(1, { duration: T(900), easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
    );
  }, [pulse]);
  const pulseStyle = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }));
  const ownerBorderStyle = useAnimatedStyle(() => {
    const c = interpolateColor(ownership.value, [0, 1], [PLAYER_A_TINT, PLAYER_B_TINT]);
    return { borderColor: c, shadowColor: c };
  });

  const seal = width * 0.42;
  return (
    <View style={{ width, height }}>
      <CardChrome width={width} height={height} borderColor="transparent" glow={false} gradient={[VAULT_LIGHT, VAULT, VAULT_DEEP]}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Animated.View style={[{ opacity: 0.6 }, pulseStyle]}>
            <View
              style={{
                width: seal,
                height: seal,
                borderRadius: 8,
                borderWidth: 1.5,
                borderColor: SLATE_GLOW,
                transform: [{ rotate: '45deg' }],
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <View style={{ transform: [{ rotate: '-45deg' }] }}>
                <Package size={seal * 0.5} color={SLATE_GLOW} strokeWidth={2} />
              </View>
            </View>
          </Animated.View>
        </View>
      </CardChrome>
      <Animated.View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          {
            borderRadius: 18,
            borderWidth: 2.5,
            shadowOpacity: 0.4,
            shadowRadius: 14,
            shadowOffset: { width: 0, height: 0 },
            elevation: 7,
          },
          ownerBorderStyle,
        ]}
      />
    </View>
  );
}

// Grid tiles use a picked/unpicked variant of the same chrome — kept
// separate from the duel card's CardBack (which is always neutral) since a
// tile's own "picked" glow is a legitimate, momentary selection cue, not a
// content hint.
function GridTileBack({ picked }: { picked: boolean }): React.ReactElement {
  const pulse = useSharedValue(1);
  useEffect(() => {
    pulse.value = withRepeat(
      withSequence(
        withTiming(1.08, { duration: T(900), easing: Easing.inOut(Easing.sin) }),
        withTiming(1, { duration: T(900), easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
    );
  }, [pulse]);
  const pulseStyle = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }));
  const seal = CARD_W * 0.42;
  return (
    <CardChrome
      width={CARD_W}
      height={CARD_H}
      borderColor={picked ? SLATE_GLOW : SLATE}
      glow={picked}
      gradient={[VAULT_LIGHT, VAULT, VAULT_DEEP]}
    >
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Animated.View style={[{ opacity: picked ? 1 : 0.55 }, pulseStyle]}>
          <View
            style={{
              width: seal,
              height: seal,
              borderRadius: 8,
              borderWidth: 1.5,
              borderColor: picked ? SLATE_GLOW : colors.fog,
              transform: [{ rotate: '45deg' }],
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <View style={{ transform: [{ rotate: '-45deg' }] }}>
              <Package size={seal * 0.5} color={picked ? SLATE_GLOW : colors.fog} strokeWidth={2} />
            </View>
          </View>
        </Animated.View>
      </View>
    </CardChrome>
  );
}

// ── Card front — icons only, no verb text. The number of GlassWater icons
// IS the message. The face is a SOLID red/green plate with white icons —
// the same declarative color language the drink banner uses — rather than
// a dark card with a tinted wash, so the outcome reads instantly from
// across the table. ───────────────────────────────────────────────────────

function CardFront({
  width,
  height,
  box,
  contentOpacity,
}: {
  width: number;
  height: number;
  box: BoxContent;
  contentOpacity: SharedValue<number>;
}): React.ReactElement {
  const tint = box.type === 'DRINK' ? colors.stop : colors.go;
  const contentStyle = useAnimatedStyle(() => ({ opacity: contentOpacity.value }));

  return (
    <CardChrome width={width} height={height} borderColor={tint} glow gradient={[tint, tint, tint]}>
      <Animated.View style={[{ flex: 1, alignItems: 'center', justifyContent: 'center' }, contentStyle]}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 6, maxWidth: width - 20 }}>
          {Array.from({ length: box.chasers }, (_, i) => (
            <GlassWater key={i} size={22} color={colors.chalk} strokeWidth={2.5} />
          ))}
        </View>
      </Animated.View>
    </CardChrome>
  );
}

// ── Sealed grid tile ──────────────────────────────────────────────────────

function SealedCardTile({
  index,
  picked,
  interactive,
  onPress,
}: {
  index: number;
  picked: boolean;
  interactive: boolean;
  onPress: (index: number) => void;
}): React.ReactElement {
  const lift = useSharedValue(0);
  useEffect(() => {
    lift.value = withTiming(picked ? 1 : 0, { duration: T(180), easing: Easing.out(Easing.quad) });
  }, [picked, lift]);
  const liftStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -lift.value * 6 }, { scale: 1 + lift.value * 0.05 }],
  }));

  // A soft breathing border + shadow glow — never a scale/size change, which
  // at this tight 14px grid gap previously read as adjacent tiles visually
  // colliding as they each grew independently. Fixed footprint throughout;
  // only while this specific tile is both interactive and unpicked — "you
  // need to choose one of these" — so it never appears for the
  // Guesser/spectators, who have nothing to pick.
  const hint = useSharedValue(0);
  const hinting = interactive && !picked;
  useEffect(() => {
    if (hinting) {
      hint.value = withRepeat(
        withSequence(
          withTiming(1, { duration: T(700), easing: Easing.inOut(Easing.sin) }),
          withTiming(0, { duration: T(700), easing: Easing.inOut(Easing.sin) }),
        ),
        -1,
      );
    } else {
      hint.value = withTiming(0, { duration: T(200) });
    }
  }, [hinting, hint]);
  const hintBorderStyle = useAnimatedStyle(() => ({
    opacity: 0.25 + hint.value * 0.55,
    shadowOpacity: 0.15 + hint.value * 0.45,
  }));

  return (
    <Pressable onPress={() => interactive && onPress(index)} disabled={!interactive}>
      {({ pressed }) => (
        <Animated.View style={[{ transform: pressed && interactive ? [{ scale: 0.95 }] : [] }, liftStyle]}>
          <View style={{ width: CARD_W, height: CARD_H }}>
            <GridTileBack picked={picked} />
            {hinting && (
              <Animated.View
                pointerEvents="none"
                style={[
                  StyleSheet.absoluteFill,
                  {
                    borderRadius: 18,
                    borderWidth: 2,
                    borderColor: PLAYER_A_TINT,
                    shadowColor: PLAYER_A_TINT,
                    shadowRadius: 10,
                    shadowOffset: { width: 0, height: 0 },
                    elevation: 5,
                  },
                  hintBorderStyle,
                ]}
              />
            )}
          </View>
        </Animated.View>
      )}
    </Pressable>
  );
}

// ── Flippable card — a strict 2D flip (no perspective/rotateY): the face
// squashes to edge-on via scaleY and swaps at the midpoint, exactly the
// technique CoinFlipGameUI's FlippingCoin uses. `spin` is a plain counter of
// half-turns: 0 = sealed, 1 = showing front, 2 = sealed again — so both the
// brief private peek (0→1→2, a there-and-back flap) and the permanent
// resolution reveal (0→1, stays open) are just different target values on
// the same shared value. ──────────────────────────────────────────────────

function FlippableCard({
  box,
  spin,
  ownership,
}: {
  box: BoxContent;
  spin: SharedValue<number>;
  ownership: SharedValue<number>;
}): React.ReactElement {
  const squashStyle = useAnimatedStyle(() => ({
    transform: [{ scaleY: Math.abs(Math.cos(spin.value * Math.PI)) }],
  }));
  const backFaceStyle = useAnimatedStyle(() => ({ opacity: Math.round(spin.value) % 2 === 0 ? 1 : 0 }));
  const frontFaceStyle = useAnimatedStyle(() => ({ opacity: Math.round(spin.value) % 2 === 1 ? 1 : 0 }));
  // Content fades with the squash itself so it never appears to hang in
  // mid-flip edge-on, without a separate scheduled timeline.
  const contentOpacity = useDerivedValue(() =>
    Math.round(spin.value) % 2 === 1 ? Math.abs(Math.cos(spin.value * Math.PI)) : 0,
  );

  return (
    <Animated.View style={[{ width: CARD_W, height: CARD_H }, squashStyle]}>
      <Animated.View style={[StyleSheet.absoluteFill, backFaceStyle]}>
        <CardBack width={CARD_W} height={CARD_H} ownership={ownership} />
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, frontFaceStyle]}>
        <CardFront width={CARD_W} height={CARD_H} box={box} contentOpacity={contentOpacity} />
      </Animated.View>
    </Animated.View>
  );
}

// ── Duel avatar — fixed footprint; only its pulse/role state changes across
// phases. Position is driven by the caller (it now animates for the Holder,
// whose slot relocates top↔bottom). ───────────────────────────────────────

function DuelAvatar({
  name,
  avatar,
  roleLabel,
  RoleIcon,
  tint,
  active,
  isSelf,
}: {
  name: string;
  avatar: string | null | undefined;
  roleLabel: string;
  RoleIcon: LucideIcon;
  tint: string;
  active: boolean;
  isSelf: boolean;
}): React.ReactElement {
  const pulse = useSharedValue(1);
  useEffect(() => {
    if (active) {
      pulse.value = withRepeat(
        withSequence(
          withTiming(1.08, { duration: T(480), easing: Easing.inOut(Easing.quad) }),
          withTiming(1, { duration: T(480), easing: Easing.inOut(Easing.quad) }),
        ),
        -1,
      );
    } else {
      pulse.value = withTiming(1, { duration: T(200) });
    }
  }, [active, pulse]);
  const pulseStyle = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }));

  return (
    <View style={{ width: AVATAR_BLOCK_W, height: AVATAR_BLOCK_H, alignItems: 'center', gap: 6 }}>
      <Animated.View style={pulseStyle}>
        <AvatarCircle name={name} avatar={avatar} size={64} ringColor={tint} />
      </Animated.View>
      <Text
        numberOfLines={1}
        style={{ color: colors.chalk, fontSize: 13, fontWeight: '800', maxWidth: AVATAR_BLOCK_W, textAlign: 'center' }}
      >
        {isSelf ? 'You' : name}
      </Text>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 4,
          paddingHorizontal: 8,
          paddingVertical: 3,
          borderRadius: 8,
          backgroundColor: VAULT,
          borderWidth: 1,
          borderColor: tint,
        }}
      >
        <RoleIcon size={10} color={tint} strokeWidth={2.5} />
        <Text style={{ ...typography.label, color: tint, fontSize: 9 }}>{roleLabel}</Text>
      </View>
    </View>
  );
}

// ── Decision button — always visible; its visual state tells the whole
// story: muted (not B's turn), awaiting (B's live decision — breathes softly
// to invite the tap), chosen (this is what B picked — pops and holds), or
// faded (the option B didn't take). ───────────────────────────────────────

type ButtonVisualState = 'muted' | 'awaiting' | 'chosen' | 'faded';

const BUTTON_PALETTE: Record<
  ButtonVisualState,
  { bg: string; border: string; iconColor: string; textColor: string; opacity: number }
> = {
  muted: { bg: VAULT, border: SLATE, iconColor: SLATE_GLOW, textColor: colors.chalk, opacity: 0.4 },
  awaiting: { bg: VAULT, border: PLAYER_B_TINT, iconColor: PLAYER_B_TINT, textColor: colors.chalk, opacity: 1 },
  chosen: { bg: PLAYER_B_TINT, border: PLAYER_B_TINT, iconColor: VAULT_DEEP, textColor: VAULT_DEEP, opacity: 1 },
  faded: { bg: VAULT, border: SLATE, iconColor: SLATE, textColor: colors.fog, opacity: 0.25 },
};

function DecisionButton({
  label,
  Icon,
  state,
  compact,
  onPress,
}: {
  label: string;
  Icon: LucideIcon;
  state: ButtonVisualState;
  /** The Holder's own view — purely informational (they never press these),
   * so rendered smaller/subtler than Player 2's real, tappable controls. */
  compact?: boolean;
  onPress: () => void;
}): React.ReactElement {
  const pulse = useSharedValue(1);
  useEffect(() => {
    if (state === 'awaiting') {
      pulse.value = withRepeat(
        withSequence(
          withTiming(1.045, { duration: T(520), easing: Easing.inOut(Easing.quad) }),
          withTiming(1, { duration: T(520), easing: Easing.inOut(Easing.quad) }),
        ),
        -1,
        true,
      );
    } else if (state === 'chosen') {
      pulse.value = withSequence(
        withTiming(1.14, { duration: T(160), easing: Easing.out(Easing.back(2)) }),
        withTiming(1, { duration: T(160) }),
      );
    } else {
      pulse.value = withTiming(1, { duration: T(150) });
    }
  }, [state, pulse]);
  const pulseStyle = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }));

  const palette = BUTTON_PALETTE[state];
  const disabled = state !== 'awaiting';
  const ShownIcon = state === 'chosen' ? Check : Icon;

  return (
    <Pressable onPress={onPress} disabled={disabled} style={{ flex: 1, pointerEvents: disabled ? 'none' : 'auto' }}>
      {({ pressed }) => (
        <Animated.View
          style={[
            {
              alignItems: 'center',
              justifyContent: 'center',
              gap: compact ? 4 : 6,
              paddingVertical: compact ? 9 : 15,
              borderRadius: compact ? 12 : 16,
              backgroundColor: palette.bg,
              borderWidth: compact ? 1.5 : 2,
              borderColor: palette.border,
              opacity: palette.opacity,
              shadowColor: state === 'awaiting' ? PLAYER_B_TINT : '#000000',
              shadowOpacity: state === 'awaiting' ? 0.5 : 0,
              shadowRadius: 12,
              shadowOffset: { width: 0, height: 0 },
              elevation: state === 'awaiting' ? 6 : 0,
              transform: pressed && !disabled ? [{ scale: 0.96 }] : [],
            },
            pulseStyle,
          ]}
        >
          <ShownIcon size={compact ? 16 : 24} color={palette.iconColor} strokeWidth={2.5} />
          <Text style={{ ...typography.label, color: palette.textColor, fontSize: compact ? 10 : 12 }}>{label}</Text>
        </Animated.View>
      )}
    </Pressable>
  );
}

// ── DONE — Drink box. Same "loss banner" language RouletteGameUI uses for
// its poison hit: full-screen dim, a solid red plaque with a white border
// slamming in, white skull, the loser's name in big uppercase, a drink-icon
// row and the chasers/points line. ────────────────────────────────────────

function DrinkDoneBanner({
  box,
  targetName,
  isTarget,
}: {
  box: BoxContent;
  targetName: string;
  isTarget: boolean;
}): React.ReactElement {
  const bannerScale = useSharedValue(0);
  const bannerOpacity = useSharedValue(0);
  useEffect(() => {
    bannerOpacity.value = withTiming(1, { duration: 180 });
    bannerScale.value = withSequence(
      withTiming(1.08, { duration: 200, easing: Easing.out(Easing.back(2)) }),
      withTiming(1, { duration: 120 }),
    );
  }, [bannerOpacity, bannerScale]);
  const bannerStyle = useAnimatedStyle(() => ({
    opacity: bannerOpacity.value,
    transform: [{ scale: bannerScale.value }],
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'rgba(10,10,15,0.7)',
        },
        bannerStyle,
      ]}
    >
      <View
        style={{
          alignItems: 'center',
          paddingVertical: 28,
          paddingHorizontal: 32,
          backgroundColor: colors.stop,
          borderWidth: 3,
          borderColor: colors.chalk,
          borderRadius: 12,
          maxWidth: 320,
        }}
      >
        <Skull size={56} color={colors.chalk} strokeWidth={2} />
        <Text
          style={{
            color: colors.chalk,
            fontSize: 26,
            fontWeight: '900',
            letterSpacing: 1,
            marginTop: 12,
            textAlign: 'center',
          }}
        >
          {isTarget ? 'YOU' : targetName.toUpperCase()}
        </Text>
        <Text style={{ ...typography.label, color: colors.chalk, fontSize: 12, marginTop: 2, opacity: 0.9 }}>
          {isTarget ? 'You drink the box' : 'Drinks the box'}
        </Text>
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
          {Array.from({ length: box.chasers }, (_, i) => (
            <GlassWater key={i} size={26} color={colors.chalk} strokeWidth={2} />
          ))}
        </View>
        <Text style={{ ...typography.label, color: colors.chalk, fontSize: 12, marginTop: 10 }}>
          {box.chasers} {box.chasers === 1 ? 'chaser' : 'chasers'} · −{box.chasers * 5} pts
        </Text>
      </View>
    </Animated.View>
  );
}

// ── Screen ──────────────────────────────────────────────────────────────────

export const BlackBoxGameUI: React.FC<MiniGameProps> = ({ gameState, onAction, clockOffset }) => {
  const { playerId } = usePlayerIdentity();
  const insets = useSafeAreaInsets();
  const [stageH, setStageH] = useState(520);

  const status = (gameState.status as string) ?? 'BOX_SELECTION';
  const playerAId = (gameState.player_a_id as string | null) ?? null;
  const playerBId = (gameState.player_b_id as string | null) ?? null;
  const boxes = (gameState.boxes as BoxContent[]) ?? [];
  const chosenBoxIndex = (gameState.chosen_box_index as number | null) ?? null;
  const selectMs = (gameState.select_ms as number) ?? 15_000;
  const selectDeadlineAt = (gameState.select_deadline_at as number) ?? 0;
  const bluffMs = (gameState.bluff_ms as number) ?? 30_000;
  const bluffDeadlineAt = (gameState.bluff_deadline_at as number | null) ?? 0;
  const targetPlayerId = (gameState.target_player_id as string | null) ?? null;
  const distributeMs = (gameState.distribute_ms as number) ?? 20_000;
  const distributeDeadlineAt = (gameState.distribute_deadline_at as number | null) ?? null;
  const assignments = (gameState.assignments as Record<string, number>) ?? {};
  const displayNames = (gameState.display_names as Record<string, string>) ?? {};
  const avatars = (gameState.avatars as Record<string, string | null>) ?? {};

  const boxSelection = status === 'BOX_SELECTION';
  const bluffing = status === 'BLUFFING';
  const distributing = status === 'DISTRIBUTING';
  const done = status === 'DONE';

  const isA = !!playerId && playerId === playerAId;
  const isB = !!playerId && playerId === playerBId;
  const aName = displayNames[playerAId ?? ''] ?? '?';
  const bName = displayNames[playerBId ?? ''] ?? '?';

  // The Holder sees themselves anchored at the bottom of their own screen;
  // everyone else sees the fixed Player-1-top / Player-2-bottom layout.
  const inverted = isA;
  const layout = computeStageLayout(inverted, stageH, DUEL_TOP_PAD, DUEL_BOTTOM_PAD);
  const bands = layout;

  const chosenBox = chosenBoxIndex !== null ? (boxes[chosenBoxIndex] ?? null) : null;
  const isTarget = !!playerId && playerId === targetPlayerId;

  const onActionRef = useRef(onAction);
  onActionRef.current = onAction;

  // Optimistic tap feedback while A's SELECT_BOX round-trips.
  const [locallyPicked, setLocallyPicked] = useState<number | null>(null);
  useEffect(() => {
    if (!boxSelection) setLocallyPicked(null);
  }, [boxSelection]);

  function pickBox(index: number) {
    if (!isA || locallyPicked !== null) return;
    setLocallyPicked(index);
    onAction('SELECT_BOX', { box_index: index });
  }

  // EXPIRE_SELECT watchdog
  useEffect(() => {
    if (!boxSelection || !selectDeadlineAt) return;
    let retry: ReturnType<typeof setInterval> | undefined;
    const wait = Math.max(0, selectDeadlineAt - clockOffset - Date.now()) + EXPIRE_SLACK_MS;
    const timer = setTimeout(() => {
      onActionRef.current('EXPIRE_SELECT');
      retry = setInterval(() => onActionRef.current('EXPIRE_SELECT'), EXPIRE_RETRY_MS);
    }, wait);
    return () => {
      clearTimeout(timer);
      if (retry) clearInterval(retry);
    };
  }, [boxSelection, selectDeadlineAt, clockOffset]);

  // EXPIRE_BLUFF watchdog
  useEffect(() => {
    if (!bluffing || !bluffDeadlineAt) return;
    let retry: ReturnType<typeof setInterval> | undefined;
    const wait = Math.max(0, bluffDeadlineAt - clockOffset - Date.now()) + EXPIRE_SLACK_MS;
    const timer = setTimeout(() => {
      onActionRef.current('EXPIRE_BLUFF');
      retry = setInterval(() => onActionRef.current('EXPIRE_BLUFF'), EXPIRE_RETRY_MS);
    }, wait);
    return () => {
      clearTimeout(timer);
      if (retry) clearInterval(retry);
    };
  }, [bluffing, bluffDeadlineAt, clockOffset]);

  // Reset the decision highlight at the start of every fresh round.
  const [chosenDecision, setChosenDecision] = useState<'TAKE' | 'LEAVE' | null>(null);
  // False until the resolution choreography ACTUALLY begins (after any
  // intro deferral below). The card's flip driver hands off from A's
  // private peekSpin to resolveSpin only on this flag — switching on raw
  // status (as an earlier version did) snapped A's peek shut mid-flip
  // whenever a fast Guesser decided while the intro was still playing.
  const [resolveTakeover, setResolveTakeover] = useState(false);
  useEffect(() => {
    if (status === 'BOX_SELECTION') {
      setChosenDecision(null);
      setResolveTakeover(false);
      blackBoxRevealEndAt.current = 0;
    }
  }, [status]);

  // ── Grid → duel choreography ─────────────────────────────────────────────
  // Fires once, the moment the server confirms A's pick (status flips
  // BOX_SELECTION → BLUFFING). Everything here is shared values driving a
  // single, always-mounted tree — never a conditional remount — so
  // Reanimated can carry the card's own coordinate continuously from its
  // grid slot into the duel lane instead of cutting between two screens.
  const chosenIndex = chosenBoxIndex ?? locallyPicked;
  const chosenHighlight = useSharedValue(0);
  const gridVisible = useSharedValue(1);
  const travel = useSharedValue(0); // 0 = grid slot, 1 = peek/final stop, 2 = final (A only)
  const peekSpin = useSharedValue(0); // 0 = sealed, 1 = open, 2 = re-sealed (A's private flap)
  const p1RelocateT = useSharedValue(0); // 0 = grid slot, 1 = duel slot (no-op unless inverted)
  const enterProgress = useSharedValue(0); // Player 2 avatar + decision buttons
  const peekWait = useSharedValue(0); // non-Holders' "{A} is checking the card…" line during A's private peek
  const buttonsFadeOut = useSharedValue(1); // 1 = visible, fades to 0 once B decides — opacity only, never unmounted
  // Declared here (rather than down by the rest of the resolution-phase
  // shared values) so a fresh round can reset it below — it also drives the
  // card's blue→orange ownership tint (see CardBack), which needs to be
  // back at 0/blue the moment a new card is chosen, not left over orange
  // from a previous round's Take It.
  const resolveSlide = useSharedValue(0);
  const [transitioning, setTransitioning] = useState(false);
  // Gates ONLY the corner countdown ring — true for just the SHARED part of
  // the grid→duel intro (highlight + travel + enter, ~2.4s), not the full
  // per-viewer intro like `transitioning`. The Holder's intro runs ~6.7s
  // (private peek included); gating the ring on that meant Player 1 — and
  // with a fast bot, sometimes nobody but the Guesser — ever saw the
  // decision timer. The ring is a corner element, so showing it while A's
  // peek is still playing collides with nothing.
  const [timerHold, setTimerHold] = useState(false);

  // The ring's DISPLAY only — never the actual deadline the EXPIRE_BLUFF
  // watchdog above enforces. The true `bluffDeadlineAt` is set the instant
  // BLUFFING starts server-side, but the client's own grid→duel transition
  // (the peek/settle choreography, several real seconds for the Holder)
  // keeps the ring inactive/frozen for that whole stretch; once it finally
  // reactivates it was jumping straight to whatever time had already
  // elapsed underneath (25s, 26s…) instead of visibly starting from a full
  // bluffMs. So the ring is shown a LOCAL deadline computed the moment the
  // transition actually finishes, giving it a clean full-duration start —
  // purely cosmetic, the watchdog's own true deadline is untouched.
  const [visualBluffStart, setVisualBluffStart] = useState<number | null>(null);
  // `timerHold` is set to `true` inside the grid→duel effect below, which
  // hasn't run yet the very first render where `bluffing` flips true — so
  // `bluffing && !timerHold` is briefly (and misleadingly) true on that
  // first render, before the transition has even started. Without this
  // guard that fires immediately and commits a start time before any of the
  // grid→duel choreography has played, defeating the whole point. Wait
  // for `timerHold` to have gone genuinely true at least once this
  // bluffing phase before trusting a `false` reading. (Keyed on `timerHold`,
  // not `transitioning`: the ring goes live after the SHARED intro length so
  // Player 1 and spectators see the decision countdown too, instead of it
  // hiding behind the Holder's much longer private-peek intro.)
  const sawTimerHoldRef = useRef(false);
  useEffect(() => {
    if (!bluffing) {
      sawTimerHoldRef.current = false;
      setVisualBluffStart(null);
      // A fast decision can end BLUFFING before the shared-intro timeout
      // fires (the grid→duel effect's cleanup cancels it) — clear the hold
      // here so the ring isn't stuck inactive through DISTRIBUTING.
      setTimerHold(false);
      return;
    }
    if (timerHold) {
      sawTimerHoldRef.current = true;
      return;
    }
    if (sawTimerHoldRef.current) {
      setVisualBluffStart((prev) => prev ?? Date.now() + clockOffset);
    }
  }, [bluffing, timerHold, clockOffset]);
  const visualBluffDeadlineAt = visualBluffStart !== null ? visualBluffStart + bluffMs : bluffDeadlineAt;

  // `prevStatusRef` is read by both this effect and the resolution-reveal
  // effect below, each comparing against the status as of the PREVIOUS
  // render. Its write lives in its own effect, declared last, so that both
  // readers see the pre-transition value in the same commit — writing it
  // inline here (as an earlier version did) let this effect's own write
  // race ahead of the resolution effect's read, since React runs effects in
  // declaration order: the resolution effect would see 'DONE' as "prev"
  // instead of 'BLUFFING' and never fire, silently skipping the whole
  // post-decision choreography.
  const prevStatusRef = useRef(status);
  // Wall-clock timestamp of when the grid→duel intro finishes — 0 when no
  // intro has run (late joiners). The resolution effect defers its whole
  // choreography past this point, so a Guesser deciding mid-intro (a 3s
  // bot, or a snap human tap) never resolves a duel nobody has seen yet.
  const introEndsAtRef = useRef(0);
  useEffect(() => {
    const prev = prevStatusRef.current;
    if (prev !== 'BOX_SELECTION' || status !== 'BLUFFING') return;

    setTransitioning(true);
    setTimerHold(true);
    buttonsFadeOut.value = 1; // fresh round — undo any fade from a previous one
    peekWait.value = 0;
    resolveSlide.value = 0; // fresh round — card starts back with Player 1 (blue), not stale orange
    chosenHighlight.value = withSequence(
      withTiming(1, { duration: HIGHLIGHT_MS / 2 }),
      withTiming(0, { duration: HIGHLIGHT_MS / 2 }),
    );
    gridVisible.value = withDelay(HIGHLIGHT_MS, withTiming(0, { duration: VANISH_MS }));
    p1RelocateT.value = withDelay(HIGHLIGHT_MS, withTiming(1, { duration: TRAVEL_MS, easing: Easing.out(Easing.cubic) }));

    // The intro is the SAME length on every screen by construction: the
    // Holder's private peek (flip open → 2s read → flip back → settle) is
    // the pacing for everyone. Non-Holders spend that same stretch on a
    // "{Holder} is checking the card…" status (peekWait below), so Player
    // 2's entrance — and everything after it, decision timer included —
    // lands at the same wall-clock moment on all screens instead of the
    // Guesser's UI running ~4s ahead of the Holder's.
    const arriveMs = HIGHLIGHT_MS + TRAVEL_MS;
    const flipStart = arriveMs + 60;
    const settleStart = flipStart + PEEK_FLIP_MS + PEEK_HOLD_MS + PEEK_FLIP_MS;
    let totalMs = settleStart + SETTLE_MS;
    // `travel` gets exactly ONE assignment per role below — reassigning a
    // shared value a second time cancels whatever `withDelay` is still
    // pending on the first assignment, so the two legs of A's journey (grid
    // → peek, then peek → final) have to live in a single `withSequence`
    // rather than two separate `.value = withDelay(...)` calls.
    if (isA) {
      travel.value = withSequence(
        withDelay(HIGHLIGHT_MS, withTiming(1, { duration: TRAVEL_MS, easing: Easing.out(Easing.cubic) })),
        withDelay(
          settleStart - arriveMs,
          withTiming(2, { duration: SETTLE_MS, easing: Easing.out(Easing.cubic) }),
        ),
      );
      peekSpin.value = withDelay(
        flipStart,
        withSequence(
          withTiming(1, { duration: PEEK_FLIP_MS, easing: Easing.inOut(Easing.cubic) }),
          withDelay(PEEK_HOLD_MS, withTiming(2, { duration: PEEK_FLIP_MS, easing: Easing.inOut(Easing.cubic) })),
        ),
      );
    } else {
      travel.value = withDelay(
        HIGHLIGHT_MS,
        withTiming(1, { duration: TRAVEL_MS, easing: Easing.out(Easing.cubic) }),
      );
      // While A privately peeks, everyone else sees the status line — fades
      // in once the card lands in the lane, fades out just before Player 2
      // enters.
      const labelIn = arriveMs + T(120);
      peekWait.value = withDelay(
        labelIn,
        withSequence(
          withTiming(1, { duration: T(180) }),
          withDelay(
            Math.max(0, totalMs - labelIn - T(180) * 2),
            withTiming(0, { duration: T(180) }),
          ),
        ),
      );
    }
    enterProgress.value = withDelay(totalMs + ENTER_DELAY_MS, withTiming(1, { duration: ENTER_MS }));
    totalMs += ENTER_DELAY_MS + ENTER_MS;

    // Read by the resolution effect below: a fast Guesser (a 3s bot, or a
    // snap human decision) can resolve the round while this intro is still
    // playing — the reveal choreography defers itself past this timestamp
    // so the duel is always SEEN before it resolves.
    introEndsAtRef.current = Date.now() + totalMs;

    // The ring frees up the moment the (now equal-length) intro ends — the
    // same wall-clock instant on every screen, right as Player 2's buttons
    // finish entering, so every viewer's decision countdown starts together.
    const timerT = setTimeout(() => setTimerHold(false), totalMs);
    const t = setTimeout(() => setTransitioning(false), totalMs);
    return () => {
      clearTimeout(t);
      clearTimeout(timerT);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  // Late-joining/reconnecting clients mount straight into BLUFFING (or
  // later) — snap every shared value to its resting state instead of
  // replaying the intro from a grid that no longer exists for them.
  useEffect(() => {
    if (status === 'BOX_SELECTION') return;
    gridVisible.value = 0;
    travel.value = isA ? 2 : 1;
    p1RelocateT.value = 1;
    enterProgress.value = 1;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Resolution reveal — BLUFFING → DONE/DISTRIBUTING ─────────────────────
  // Sequenced: (1) highlight the button B actually pressed and hold, then
  // fade the whole decision row out (opacity only, never unmounted) so it
  // can never visually collide with the card once it starts moving; (2) if
  // the box changed hands, slide it to whoever now holds it; (3) the
  // cinematic climax — the card takes center stage, the rest of the scene
  // dims, the current holder's own identity fades in beside it; (4) THEN it
  // flips open — a single half-turn (spin 0→1, stays open), since this is
  // the permanent truth reveal shown to the whole room, not the Holder's
  // private peek.
  const [revealing, setRevealing] = useState(false);
  const resolveCenterT = useSharedValue(0); // 0 = at the holder's slot, 1 = centered on screen
  const dimOverlay = useSharedValue(0);
  const identityReveal = useSharedValue(0);
  const resolveSpin = useSharedValue(0);
  // Wall-clock anchors for the two JS-side timers of the reveal (the
  // deferred choreography start, and the reveal's end). A DISTRIBUTING →
  // DONE status flip (a bot distributor finishing in ~2s) re-runs this
  // effect and its cleanup cancels the pending setTimeouts — an earlier
  // version lost them there, leaving `revealing` stuck true forever, which
  // is exactly why spectators never saw the distribution screen. These
  // refs let the DONE branch below RE-schedule whatever is still pending.
  const resolveStartAtRef = useRef(0);
  const revealEndsAtRef = useRef(0);
  useEffect(() => {
    const prev = prevStatusRef.current;

    // A bot distributor can finish (DISTRIBUTING → DONE) while the reveal
    // choreography from the branch below is still mid-flight. The shared
    // values keep animating on their own, but the JS timers were cancelled
    // by this effect's cleanup — re-arm them for their remaining time so
    // the reveal still completes and hands the screen to the distribution
    // summary exactly as if the status hadn't flipped underneath it.
    if (prev === 'DISTRIBUTING' && status === 'DONE' && revealEndsAtRef.current > 0) {
      const timers: ReturnType<typeof setTimeout>[] = [];
      const startRemaining = resolveStartAtRef.current - Date.now();
      if (startRemaining > 0) {
        timers.push(
          setTimeout(() => {
            setChosenDecision(targetPlayerId === playerAId ? 'LEAVE' : 'TAKE');
            setResolveTakeover(true);
          }, startRemaining),
        );
      }
      const endRemaining = Math.max(0, revealEndsAtRef.current - Date.now());
      timers.push(setTimeout(() => setRevealing(false), endRemaining));
      return () => timers.forEach(clearTimeout);
    }

    if (prev === 'BLUFFING' && (status === 'DONE' || status === 'DISTRIBUTING')) {
      const boxStaysWithHolder = targetPlayerId === playerAId;
      resolveSlide.value = 0;
      resolveCenterT.value = 0;
      dimOverlay.value = 0;
      identityReveal.value = 0;
      resolveSpin.value = 0;

      // If the Guesser decided while the grid→duel intro was still playing,
      // hold the ENTIRE resolution back until the intro lands (plus a short
      // beat of the live duel), then run the exact same choreography every
      // other flow gets: chosen-button pop → card handoff → zoom → flip.
      const startDelay = Math.max(0, introEndsAtRef.current + T(400) - Date.now());
      resolveStartAtRef.current = Date.now() + startDelay;
      const decisionTimer = setTimeout(() => {
        setChosenDecision(boxStaysWithHolder ? 'LEAVE' : 'TAKE');
        // Only NOW does the card's flip driver switch from A's private
        // peekSpin to resolveSpin — the intro (peek included) has landed.
        setResolveTakeover(true);
      }, startDelay);

      // Reveal pacing is identical for DONE and DISTRIBUTING — the bot's
      // first ASSIGN is deliberately delayed (~8–9s) so the distribute UI
      // mounts onto an empty board AFTER this sequence finishes, instead of
      // racing it. Compressing DISTRIBUTING used to be a band-aid for that
      // race; with the bot wait it's no longer needed and just made the
      // green-card flip feel rushed relative to the drink reveal.
      const decisionHoldMs = DECISION_HOLD_MS;
      const buttonFadeMs = BUTTON_FADE_MS;
      const resolveSlideMs = RESOLVE_SLIDE_MS;
      const preFlipGapMs = PRE_FLIP_GAP_MS;
      const centerTravelMs = CENTER_TRAVEL_MS;
      const dimMs = DIM_MS;
      const identityDelayMs = IDENTITY_DELAY_MS;
      const identityMs = IDENTITY_MS;
      const preFlipGap2Ms = PRE_FLIP_GAP2_MS;
      const resolveFlipMs = RESOLVE_FLIP_MS;

      const fadeStart = startDelay + Math.max(0, decisionHoldMs - buttonFadeMs);
      buttonsFadeOut.value = withDelay(fadeStart, withTiming(0, { duration: buttonFadeMs }));

      let afterSlide = startDelay + decisionHoldMs;
      if (!boxStaysWithHolder) {
        resolveSlide.value = withDelay(
          startDelay + decisionHoldMs,
          withTiming(1, { duration: resolveSlideMs, easing: Easing.out(Easing.cubic) }),
        );
        afterSlide = startDelay + decisionHoldMs + resolveSlideMs;
      }

      const centerStart = afterSlide + preFlipGapMs;
      resolveCenterT.value = withDelay(
        centerStart,
        withTiming(1, { duration: centerTravelMs, easing: Easing.out(Easing.cubic) }),
      );
      dimOverlay.value = withDelay(centerStart, withTiming(1, { duration: dimMs }));
      identityReveal.value = withDelay(
        centerStart + identityDelayMs,
        withTiming(1, { duration: identityMs }),
      );

      const flipDelay = centerStart + centerTravelMs + preFlipGap2Ms;
      resolveSpin.value = withDelay(flipDelay, withTiming(1, { duration: resolveFlipMs, easing: Easing.inOut(Easing.cubic) }));
      setRevealing(true);
      const hold = status === 'DISTRIBUTING' ? RESOLVE_HOLD_MS_DISTRIBUTE : RESOLVE_HOLD_MS;
      const totalMs = flipDelay + resolveFlipMs + hold;
      revealEndsAtRef.current = Date.now() + totalMs;
      blackBoxRevealEndAt.current = revealEndsAtRef.current;
      const t = setTimeout(() => setRevealing(false), totalMs);
      return () => {
        clearTimeout(t);
        clearTimeout(decisionTimer);
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  // The single place `prevStatusRef` is written — after both effects above
  // have already read it for this commit.
  useEffect(() => {
    prevStatusRef.current = status;
  }, [status]);

  // `revealing` only becomes true once the resolution effect above runs —
  // which is one render AFTER `status` first flips to DONE/DISTRIBUTING.
  // Gating `showStage` on `revealing` alone left a one-render gap where the
  // whole stage (every avatar, the card) unmounted and then immediately
  // remounted, and on web a freshly-remounted Animated.View can paint one
  // frame at its pre-worklet default position before Reanimated catches up
  // — visible here as Player 1 briefly flashing into Player 2's slot.
  // `prevStatusRef.current` still holds the pre-transition value at this
  // point in render (its own write effect hasn't run yet this commit), so
  // this inline check covers exactly that gap without waiting on state.
  const justLeftBluffing = prevStatusRef.current === 'BLUFFING' && (status === 'DONE' || status === 'DISTRIBUTING');
  const showStage = boxSelection || bluffing || revealing || justLeftBluffing;

  // ── Animated styles ───────────────────────────────────────────────────────

  const gridContainerStyle = useAnimatedStyle(() => ({
    opacity: gridVisible.value,
    transform: [{ scale: 0.85 + gridVisible.value * 0.15 }],
  }));

  const gridStatusTextStyle = useAnimatedStyle(() => ({ opacity: gridVisible.value }));

  const p1DuelTop = bands.p1Y;
  const p1WrapStyle = useAnimatedStyle(() => ({
    position: 'absolute',
    left: (STAGE_W - AVATAR_BLOCK_W) / 2,
    top: interpolate(p1RelocateT.value, [0, 1], [layout.gridP1Top, p1DuelTop]),
  }));

  const peekYForA = peekY(bands.p1Y);
  const travelDxReal = chosenIndex === null ? 0 : (STAGE_W - CARD_W) / 2 - tileLeft(chosenIndex);
  const travelDyToPeek = chosenIndex === null ? 0 : peekYForA - tileTop(chosenIndex, layout.gridTop);
  const travelDyToFinalDirect = chosenIndex === null ? 0 : bands.cardRestY - tileTop(chosenIndex, layout.gridTop);
  const travelDyPeekToFinal = bands.cardRestY - peekYForA;

  const travelingCardBaseStyle = {
    position: 'absolute' as const,
    left: chosenIndex === null ? (STAGE_W - CARD_W) / 2 : tileLeft(chosenIndex),
    top: chosenIndex === null ? bands.cardRestY : tileTop(chosenIndex, layout.gridTop),
  };
  const travelingCardStyle = useAnimatedStyle(() => {
    const leg1 = Math.min(travel.value, 1);
    const leg2 = Math.max(0, travel.value - 1);
    const dx = isA ? travelDxReal * leg1 : interpolate(leg1, [0, 1], [0, travelDxReal]);
    const dy1 = isA ? travelDyToPeek * leg1 : interpolate(leg1, [0, 1], [0, travelDyToFinalDirect]);
    const dy2 = isA ? travelDyPeekToFinal * leg2 : 0;
    return {
      opacity: chosenIndex === null ? 0 : 1,
      transform: [
        { translateX: dx },
        { translateY: dy1 + dy2 },
        { scale: 1 + chosenHighlight.value * 0.08 },
      ],
    };
  });

  const enterStyle = useAnimatedStyle(() => ({
    opacity: enterProgress.value,
    transform: [{ scale: 0.88 + enterProgress.value * 0.12 }],
  }));

  // Driven purely by its shared value (never by `status`): a fast Guesser
  // can flip the round to DONE while the Holder is still mid-peek, and this
  // line must keep covering the wait until the (deferred) choreography
  // takes over — the shared value's own timeline already fades it out at
  // exactly the right moment.
  const peekWaitStyle = useAnimatedStyle(() => ({ opacity: peekWait.value }));

  // Same fade-in as `enterStyle`, but also fades back OUT (opacity only —
  // never unmounted, so the flex row never reflows) the instant B decides,
  // finishing before the card starts traveling so the two can never
  // visually collide.
  const buttonsRowStyle = useAnimatedStyle(() => ({
    opacity: enterProgress.value * buttonsFadeOut.value,
    transform: [{ scale: 0.88 + enterProgress.value * 0.12 }],
  }));

  // Post-decision card position: first (if the box changed hands) slide to
  // whoever now holds it, then — the cinematic climax — ZOOM to the true
  // center of the screen, growing to REVEAL_SCALE as everything else goes
  // dark. Scale is applied around the card's own center, so anchoring its
  // unscaled top at (stageH - CARD_H) / 2 keeps the ENLARGED card dead
  // center too.
  const nearOtherPlayerY = nearOtherY(bands.p2Y, inverted);
  const boxStaysWithHolder = targetPlayerId === playerAId;
  const postSlideY = boxStaysWithHolder ? bands.cardRestY : nearOtherPlayerY;
  const centerCardTop = (stageH - CARD_H) / 2;
  // The identity block sits above the SCALED card's top edge, not the
  // unscaled one — the card visually grows past its layout box.
  const scaledCardTop = stageH / 2 - (CARD_H * REVEAL_SCALE) / 2;
  const identityH = 48 + 6 + 20; // avatar + gap + one name line
  const identityTop = scaledCardTop - identityH - 18;
  const resolveCardStyle = useAnimatedStyle(() => {
    const slideDelta = interpolate(resolveSlide.value, [0, 1], [0, nearOtherPlayerY - bands.cardRestY]);
    const centerDelta = interpolate(resolveCenterT.value, [0, 1], [0, centerCardTop - postSlideY]);
    return {
      transform: [
        { translateY: slideDelta + centerDelta },
        { scale: 1 + resolveCenterT.value * (REVEAL_SCALE - 1) },
      ],
    };
  });

  const dimOverlayStyle = useAnimatedStyle(() => ({ opacity: dimOverlay.value * 0.9 }));
  // Settles upward into place as it fades in, landing with firm clearance
  // above the centered card rather than fading in flat where it used to
  // graze the card's own top edge.
  const identityStyle = useAnimatedStyle(() => ({
    opacity: identityReveal.value,
    transform: [
      { translateY: interpolate(identityReveal.value, [0, 1], [18, 0]) },
      { scale: 0.9 + identityReveal.value * 0.1 },
    ],
  }));

  function buttonState(which: 'TAKE' | 'LEAVE'): ButtonVisualState {
    if (chosenDecision) return chosenDecision === which ? 'chosen' : 'faded';
    if (isB && bluffing && !transitioning && !revealing) return 'awaiting';
    return 'muted';
  }

  const secretLabel = chosenBox
    ? `Secret: ${chosenBox.type === 'DRINK' ? 'Drink' : 'Distribute'} ${chosenBox.chasers} ${chosenBox.chasers === 1 ? 'chaser' : 'chasers'}`
    : '';

  // The "is deciding" status label sits on the far side of the buttons from
  // Player 2 — above them when Player 1 is looking up at a top-anchored
  // Player 2 (inverted), below them when Player 2 is at the bottom.
  const labelY = inverted ? Math.max(0, bands.buttonsY - LABEL_H - 4) : bands.buttonsY + BUTTONS_H + 6;

  // Whoever currently holds the box, for the centered reveal's identity
  // card — same target_player_id the DONE/DISTRIBUTING banners key off.
  const holderIsA = targetPlayerId === playerAId;
  const holderName = holderIsA ? aName : bName;
  const holderAvatar = avatars[targetPlayerId ?? ''];
  const holderTint = holderIsA ? PLAYER_A_TINT : PLAYER_B_TINT;
  const holderIsSelf = !!playerId && playerId === targetPlayerId;

  return (
    <View style={{ flex: 1, backgroundColor: colors.ink }}>
      <VaultBackdrop />

      {/* Countdown — screen top-right, inset-aware. Also runs through
          DISTRIBUTING so the distributor can see how long they have left
          to hand out the pool. */}
      {(boxSelection || bluffing || distributing) && !revealing && (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: insets.top + 8,
            right: insets.right + 20,
            width: TIMER_SIZE,
            height: TIMER_SIZE,
            zIndex: 30,
          }}
        >
          <CountdownRing
            deadlineAt={
              boxSelection
                ? selectDeadlineAt
                : bluffing
                  ? (visualBluffDeadlineAt ?? 0)
                  : (distributeDeadlineAt ?? 0)
            }
            clockOffset={clockOffset}
            totalMs={boxSelection ? selectMs : bluffing ? bluffMs : distributeMs}
            active={(boxSelection || bluffing || distributing) && !timerHold && !revealing}
            size={TIMER_SIZE}
            strokeWidth={6}
            precision="seconds"
            lowTimeThresholdMs={5_000}
            highTimeColor={SLATE_GLOW}
            lowTimeColor={colors.stop}
          />
        </View>
      )}

      <View
        style={{
          flex: 1,
          width: '100%',
          maxWidth: 420,
          alignSelf: 'center',
          paddingHorizontal: 20,
          paddingTop: insets.top + 44,
          paddingBottom: insets.bottom + 4,
        }}
      >
        {/* Header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'center' }}>
          <Package size={14} color={SLATE_GLOW} strokeWidth={2.5} />
          <Kicker tint={SLATE_GLOW} style={{ fontSize: 11 }}>
            BLACK BOX
          </Kicker>
        </View>

        {/* ── Single fluid canvas: BOX_SELECTION → BLUFFING → reveal ──────── */}
        {showStage && (
          <View
            style={{ flex: 1, alignItems: 'center' }}
            onLayout={(e) => {
              const h = e.nativeEvent.layout.height;
              if (h > 0) setStageH(h);
            }}
          >
            <View style={{ width: STAGE_W, height: stageH }}>
              {/* Player 1 (Holder) — grid-phase slot fixed at the top; once
                  the duel begins its slot animates to the bottom for the
                  Holder's own screen only (a no-op move for everyone else,
                  since their duel slot is the same physical spot). */}
              <Animated.View style={p1WrapStyle}>
                <DuelAvatar
                  name={aName}
                  avatar={avatars[playerAId ?? '']}
                  roleLabel="Holder"
                  RoleIcon={Eye}
                  tint={PLAYER_A_TINT}
                  active={boxSelection && !transitioning}
                  isSelf={isA}
                />
              </Animated.View>

              {/* Grid-phase status line */}
              <Animated.View
                style={[{ position: 'absolute', left: 0, right: 0, top: layout.statusTextTop }, gridStatusTextStyle]}
                pointerEvents="none"
              >
                <Text style={{ ...typography.label, color: PLAYER_A_TINT, fontSize: 11, textAlign: 'center' }}>
                  {isA ? 'Choose a card' : `${aName} is choosing`}
                </Text>
              </Animated.View>

              {/* Sealed 6-card grid */}
              <Animated.View
                style={[{ position: 'absolute', left: GRID_LEFT, top: layout.gridTop, width: GRID_W, height: GRID_H }, gridContainerStyle]}
                pointerEvents={boxSelection ? 'auto' : 'none'}
              >
                {boxes.map((_, i) => (
                  <View key={i} style={{ position: 'absolute', left: (i % GRID_COLS) * (CARD_W + TILE_GAP), top: Math.floor(i / GRID_COLS) * (CARD_H + TILE_GAP) }}>
                    <SealedCardTile
                      index={i}
                      picked={locallyPicked === i}
                      interactive={isA && boxSelection && locallyPicked === null}
                      onPress={pickBox}
                    />
                  </View>
                ))}
              </Animated.View>

              {/* Cinematic dim — once resolved, darkens the ENTIRE screen
                  (avatars, buttons, header, backdrop) so the card reads as
                  the sole focus while it takes center stage. Oversized far
                  past the stage bounds (RN doesn't clip children by
                  default) so it reaches every screen edge; sits above
                  everything declared so far but below the card/identity via
                  explicit zIndex. */}
              {revealing && (
                <Animated.View
                  pointerEvents="none"
                  style={[
                    {
                      position: 'absolute',
                      left: -400,
                      top: -400,
                      width: STAGE_W + 800,
                      height: stageH + 800,
                      backgroundColor: colors.ink,
                      zIndex: 5,
                    },
                    dimOverlayStyle,
                  ]}
                />
              )}

              {/* The traveling duel card — one instance, its coordinate
                  carried continuously from the tapped grid tile through to
                  the duel lane (and, for A, through a private peek stop),
                  then to dead center for the cinematic reveal. */}
              {chosenBox && (
                <Animated.View style={[travelingCardBaseStyle, travelingCardStyle, { zIndex: 10 }]}>
                  <Animated.View style={revealing ? resolveCardStyle : undefined}>
                    <FlippableCard
                      box={chosenBox}
                      spin={resolveTakeover ? resolveSpin : peekSpin}
                      ownership={resolveSlide}
                    />
                  </Animated.View>
                </Animated.View>
              )}

              {/* The current holder's identity — avatar + name fading in
                  ABOVE the enlarged, centered card while the tension hold
                  runs, right before the flip. Positioned off the SCALED
                  card top (see `scaledCardTop`), never off Player 2's
                  slot. */}
              {revealing && (
                <Animated.View
                  pointerEvents="none"
                  style={[
                    { position: 'absolute', left: 0, right: 0, top: identityTop, alignItems: 'center', gap: 6, zIndex: 11 },
                    identityStyle,
                  ]}
                >
                  <AvatarCircle name={holderName} avatar={holderAvatar} size={48} ringColor={holderTint} />
                  <Text style={{ color: colors.chalk, fontSize: 15, fontWeight: '800' }}>
                    {holderIsSelf ? 'You' : holderName}
                  </Text>
                </Animated.View>
              )}

              {/* Player 2 (Guesser) — fades/scales in once the card lands in
                  the duel lane, at whichever end of the stack Player 1 isn't
                  occupying. */}
              <Animated.View
                style={[{ position: 'absolute', left: (STAGE_W - AVATAR_BLOCK_W) / 2, top: bands.p2Y }, enterStyle]}
                pointerEvents="none"
              >
                <DuelAvatar
                  name={bName}
                  avatar={avatars[playerBId ?? '']}
                  roleLabel="Guesser"
                  RoleIcon={Scale}
                  tint={PLAYER_B_TINT}
                  active={false}
                  isSelf={isB}
                />
              </Animated.View>

              {/* Decision buttons — always present (opacity-only fade,
                  never unmounted, so the flex row can never reflow), on the
                  far side of Player 2 from the card — these are B's own
                  controls, never between the card and Player 2. Once B
                  decides, the row fades to fully transparent before the
                  card starts traveling — see `buttonsFadeOut` — so it can
                  never visually collide with the card sliding/centering
                  through its old spot. In the Holder's inverted layout this
                  row's band can also spatially overlap the grid, so it must
                  let touches pass through to whatever's underneath except
                  onto its own buttons — otherwise it silently swallows grid
                  taps even while fully transparent. Rendered smaller in the
                  Holder's own (inverted) view — it's purely informational
                  there, never theirs to press. */}
              <Animated.View
                style={[{ position: 'absolute', left: 0, right: 0, top: bands.buttonsY, flexDirection: 'row', gap: 12 }, buttonsRowStyle]}
                pointerEvents="box-none"
              >
                <DecisionButton label="Take it" Icon={Hand} state={buttonState('TAKE')} compact={inverted} onPress={() => onAction('TAKE_BOX')} />
                <DecisionButton label="Leave it" Icon={X} state={buttonState('LEAVE')} compact={inverted} onPress={() => onAction('LEAVE_BOX')} />
              </Animated.View>

              {/* "{Holder} is checking the card" — everyone but the Holder,
                  centered in the open duel lane while A's private peek runs.
                  Always mounted (opacity-only via peekWait) for the same
                  reason as the decision row: its timeline must survive a
                  mid-peek status flip. */}
              {!isA && (
                <Animated.View
                  style={[
                    { position: 'absolute', left: 0, right: 0, top: bands.cardRestY + CARD_H + 44 },
                    peekWaitStyle,
                  ]}
                  pointerEvents="none"
                >
                  <Text style={{ ...typography.label, color: PLAYER_A_TINT, fontSize: 12, textAlign: 'center' }}>
                    {aName} is checking the card
                  </Text>
                </Animated.View>
              )}

              {/* "Player 2 is deciding…" — shown to everyone but B, on the
                  far side of the buttons from Player 2 (see `labelY`). */}
              {bluffing && !transitioning && !revealing && !isB && (
                <Animated.View
                  style={[{ position: 'absolute', left: 0, right: 0, top: labelY }, enterStyle]}
                  pointerEvents="none"
                >
                  <Text style={{ ...typography.label, color: PLAYER_B_TINT, fontSize: 12, textAlign: 'center' }}>
                    {bName} is deciding
                  </Text>
                </Animated.View>
              )}

              {/* The Holder's own secret — replaces any color hint on the
                  card itself, sitting right under their own avatar. */}
              {isA && bluffing && !transitioning && !revealing && (
                <View
                  style={{ position: 'absolute', left: 0, right: 0, top: bands.p1Y + AVATAR_BLOCK_H + 6 }}
                  pointerEvents="none"
                >
                  <Text style={{ ...typography.label, color: SLATE_GLOW, fontSize: 11, textAlign: 'center' }}>
                    {secretLabel}
                  </Text>
                </View>
              )}
            </View>
          </View>
        )}

        {/* ── DISTRIBUTING ─────────────────────────────────────────────── */}
        {/* Gated on `!showStage`, not `!revealing`: those two flags aren't
            equivalent for one render — `justLeftBluffing` can hold
            `showStage` true for a tick after `revealing` has already gone
            false the OTHER way too (status moved on before the resolution
            effect's own state settles). Gating on `revealing` alone let
            this block and the stage's fixed-size View mount SIMULTANEOUSLY
            for that one render, doubling the flex container's content
            height for a frame — the actual "entire screen jumps" bug,
            not the (already opacity-only, never-unmounted) buttons. */}
        {/* Stays mounted through DONE for Distribute outcomes so the final
            allocation remains visible during game.tsx's navigation hold
            (bot distributors can finish while the reveal is still playing)
            instead of cutting to a blank stage. Interaction and the expire
            watchdog only run while genuinely DISTRIBUTING. */}
        {(distributing || (done && chosenBox?.type === 'DISTRIBUTE')) && !showStage && (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 18 }}>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                paddingHorizontal: 10,
                paddingVertical: 5,
                borderRadius: 10,
                backgroundColor: VAULT,
                borderWidth: 1.5,
                borderColor: colors.go,
              }}
            >
              <PackageOpen size={13} color={colors.go} strokeWidth={2.5} />
              <Text style={{ ...typography.label, color: colors.go, fontSize: 10 }}>Distribute card opened</Text>
            </View>
            <SharedChaserDistributor
              poolSize={chosenBox?.chasers ?? 0}
              assignments={assignments}
              displayNames={displayNames}
              avatars={avatars}
              selfId={playerId}
              isDistributor={isTarget && distributing}
              distributorId={targetPlayerId}
              deadlineAt={distributing ? distributeDeadlineAt : null}
              windowMs={distributeMs}
              clockOffset={clockOffset}
              onAssign={(pid) => onAction('ASSIGN', { recipient_player_id: pid })}
              onSubmit={() => onAction('SUBMIT')}
              onExpire={() => onAction('EXPIRE_DISTRIBUTE')}
              accent={{ tint: SLATE_GLOW, tintGlow: SLATE, surface: VAULT }}
            />
          </View>
        )}

        {/* ── DONE — only a direct Drink card gets a local banner; Distribute
            and safe outcomes skip straight to the room summary. ───────── */}
        {done && !showStage && chosenBox?.type === 'DRINK' && (
          <DrinkDoneBanner
            box={chosenBox}
            targetName={displayNames[targetPlayerId ?? ''] ?? '?'}
            isTarget={isTarget}
          />
        )}
      </View>
    </View>
  );
};
