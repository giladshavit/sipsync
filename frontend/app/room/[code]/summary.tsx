import { useEffect, useRef, useState } from 'react';
import { View, Text } from 'react-native';
import { Stack, useLocalSearchParams, useNavigation, router } from 'expo-router';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { usePlayerIdentity } from '@/hooks/usePlayerIdentity';
import { useRoomSocket } from '@/hooks/useRoomSocket';
import { useWebPageBackground } from '@/hooks/useWebPageBackground';
import { RoundResultCard, roundResultBgColor } from '@/components/RoundResultCard';
import { PracticeExitButton } from '@/components/PracticeExitButton';
import type { PlayerOutcome } from '@/hooks/useRoomSocket';

const LOCK_MS = 6_000;

export default function SummaryScreen() {
  const { code, outcomeJson, allOutcomesJson } = useLocalSearchParams<{
    code: string;
    outcomeJson: string;
    allOutcomesJson: string;
  }>();

  const { playerId } = usePlayerIdentity();
  const { snapshot, isConnected, send, reconnect } = useRoomSocket(code);
  const navigation = useNavigation();
  // Set the moment any room-progression branch below actually fires — lets
  // the self-heal timer (further down) tell "still legitimately waiting"
  // apart from "stuck: nothing has arrived since the lock expired."
  const movedOnRef = useRef(false);

  const outcome: PlayerOutcome | null = (() => {
    try { return outcomeJson ? JSON.parse(outcomeJson) : null; } catch { return null; }
  })();

  useWebPageBackground(roundResultBgColor(outcome?.result));

  const allOutcomes: Record<string, PlayerOutcome> = (() => {
    try { return allOutcomesJson ? JSON.parse(allOutcomesJson) : {}; } catch { return {}; }
  })();

  const [lockExpired, setLockExpired] = useState(false);
  const lockExpiredRef = useRef(false);

  // Client-local move to the podium — fired by the automatic PODIUM branch
  // below. Purely this-client: it never signals the server, so it can't
  // move anyone else's screen.
  // The room-level PERSONAL_SUMMARY -> PODIUM signal has its own paths
  // (every client's automatic GOTO_PODIUM + the server's safety-net timer).
  function goToPodiumNow() {
    movedOnRef.current = true;
    router.replace({
      pathname: '/room/[code]/podium',
      params: {
        code,
        outcomeJson: outcomeJson ?? '',
        allOutcomesJson: allOutcomesJson ?? '',
      },
    });
  }

  const isPractice = !!snapshot?.isPractice;

  // Practice-room equivalent of goToPodiumNow — tells the server to tear the
  // room down (we're always admin_id in a practice room, so END_NIGHT is
  // always authorized) and sends this client back to the rules screen it
  // started from instead of the multiplayer podium.
  function exitToRulesNow() {
    movedOnRef.current = true;
    send({ type: 'END_NIGHT' });
    if (snapshot?.activeGameId) {
      router.replace({ pathname: '/games/[id]', params: { id: snapshot.activeGameId } });
    } else {
      router.replace('/');
    }
  }

  // Identity flash: both of this screen's identity sources are async and
  // resolve independently. usePlayerIdentity reads SecureStore (a real iOS
  // keychain read), and useRoomSocket opens a *brand-new* socket on every
  // router.replace, so `snapshot` stays null for a full connect + HANDSHAKE
  // + ROOM_STATE round-trip. The outcome itself arrives synchronously as a
  // route param, so the screen used to render completely — real verdict,
  // real scores — with a confident 'You' in the header that then snapped to
  // the player's actual name a beat later.
  //
  // null means "not known yet". RoundResultCard holds the line's footprint
  // rather than filling it with a guess: showing nothing briefly is a much
  // better failure mode than showing the wrong name confidently.
  const displayName =
    playerId != null ? snapshot?.players[playerId]?.display_name ?? null : null;

  // ── Reanimated countdown bar: 1 → 0 over LOCK_MS ──────────────────────────
  const progress = useSharedValue(1);
  const barStyle = useAnimatedStyle(() => ({
    width: `${progress.value * 100}%` as `${number}%`,
  }));

  // Own local mandatory-window timer — each client runs this the moment it
  // reaches this screen. It deliberately doesn't try to sync to a shared
  // server deadline: different mini-games hold players on their own
  // end-of-round reveal for very different lengths of time before anyone
  // even gets here (0-8s), so there's no single "round-finish" instant every
  // client's 6s should be measured from — each client's own 6s here is the
  // only thing that actually needs to be consistent. Once it expires, this
  // client tells the server it's ready to move on (see the effect below).
  useEffect(() => {
    progress.value = withTiming(0, { duration: LOCK_MS, easing: Easing.linear });

    const timer = setTimeout(() => {
      lockExpiredRef.current = true;
      setLockExpired(true);
    }, LOCK_MS);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Tell the server this client is ready to move on, once its own lock
  // expires. Deliberately not admin-gated — any player's signal is enough,
  // so a single stalled/backgrounded client (even the admin's) can't block
  // the whole room. Every client sends this; the first one to arrive wins,
  // the rest are harmless no-ops.
  //
  // Also re-sends on every reconnect (isConnected flipping back to true),
  // not just once when the lock first expires. The very first send can go
  // out over a connection that looks open from here but is actually already
  // dead (stale socket, no clean close) — in that case it never reaches the
  // server at all, and sending it again later on the SAME dead socket
  // wouldn't help either. Re-sending whenever a fresh connection actually
  // lands (including the one reconnect() below forces after the self-heal
  // timeout) is what actually gets it through. ──────────────────────────
  useEffect(() => {
    if (!lockExpired || !isConnected) return;
    if (isPractice) exitToRulesNow();
    else send({ type: 'GOTO_PODIUM' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lockExpired, isConnected, isPractice, send]);

  // ── Block all back navigation for the full 6 s ────────────────────────────
  // Practice rooms are exempt — the mandatory window is a real-game social
  // mechanic (see CLAUDE.md), not something a solo bot round needs, and the
  // PracticeExitButton below relies on being able to navigate away early.
  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (e: any) => {
      if (!isPractice && !lockExpiredRef.current) e.preventDefault();
    });
    return unsubscribe;
  }, [navigation, isPractice]);

  // ── Navigate on FSM transitions ───────────────────────────────────────────
  // Handles every state the room could actually be in when this client's
  // snapshot updates — not just PODIUM. A client stuck here can miss the
  // PODIUM broadcast specifically (dropped packet, momentarily stale socket)
  // while everyone else moves on; if the admin then starts the next round
  // before this client catches up, the next update this client sees is
  // TUTORIAL or PLAYING, never PODIUM. Only handling PODIUM meant that
  // client stayed stuck on this screen for an entire extra round, unable to
  // play, until the round-after's own PODIUM transition finally arrived.
  // Following whatever state actually shows up gets it there directly.
  useEffect(() => {
    const state = snapshot?.state;
    if (!state) return;
    // Practice rooms only ever exit via exitToRulesNow (which tears the room
    // down with END_NIGHT) — they never get a fresh LOBBY/PODIUM/TUTORIAL/
    // PLAYING transition to follow here.
    if (isPractice) return;

    if (state === 'LOBBY') {
      movedOnRef.current = true;
      router.replace({ pathname: '/room/[code]/lobby', params: { code } });
    } else if (state === 'PODIUM') {
      // Clients reach this screen at different times (each mini-game holds
      // players on its own end-of-round reveal for 0-8s first), so the
      // room-wide PODIUM broadcast — fired by whichever client's window
      // expires first — can land while THIS client's own 6s window is still
      // running. The window is un-skippable by design: hold here until it
      // expires (`lockExpired` is in the deps, so this re-fires then).
      if (!lockExpired) return;
      goToPodiumNow();
    } else if (state === 'TUTORIAL') {
      movedOnRef.current = true;
      router.replace({
        pathname: '/room/[code]/tutorial',
        params: {
          code,
          tutorialType: snapshot.tutorialType ?? '',
          tutorialAsset: snapshot.tutorialAsset ?? '',
        },
      });
    } else if (state === 'PLAYING') {
      movedOnRef.current = true;
      router.replace({ pathname: '/room/[code]/game', params: { code } });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot?.state, snapshot?.tutorialType, snapshot?.tutorialAsset, code, outcomeJson, allOutcomesJson, lockExpired, isPractice]);

  // ── Self-heal: if the lock has expired and GOTO_PODIUM was sent, but
  // nothing has moved this client on after a few seconds, the socket is
  // most likely stale (a clean drop already self-heals via the hook's own
  // reconnect timer — this covers the case where it goes quiet without ever
  // firing `onclose`). Forcing a fresh connection re-fetches ROOM_STATE,
  // which carries whatever the room's real current state already is.
  // An interval, not a one-shot: the forced reconnect can itself land on a
  // still-dead network path, so keep retrying until something moves us on
  // (each successful fresh connection also re-sends GOTO_PODIUM via the
  // effect above). ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!lockExpired) return;
    const timer = setInterval(() => {
      if (!movedOnRef.current) reconnect();
    }, 4000);
    return () => clearInterval(timer);
  }, [lockExpired, reconnect]);

  return (
    <>
      <Stack.Screen options={{ gestureEnabled: false }} />

      <View className="flex-1" style={{ backgroundColor: roundResultBgColor(outcome?.result) }}>
        {isPractice && <PracticeExitButton onPress={exitToRulesNow} />}
        <RoundResultCard
          outcome={outcome}
          allOutcomes={allOutcomes}
          players={snapshot?.players ?? {}}
          playerId={playerId}
          displayName={displayName}
        />

        {/* Un-skippable window — bordered track keeps it deliberate, not decorative */}
        <View className="px-6 pb-4" style={{ paddingTop: 14 }}>
          <View
            style={{
              height: 10,
              borderWidth: 1,
              borderColor: 'rgba(255,255,255,0.45)',
              padding: 2,
            }}
          >
            <Animated.View
              style={[{ height: '100%', backgroundColor: '#FFFFFF' }, barStyle]}
            />
          </View>

          <View className="mt-5 min-h-[52px] items-center justify-center">
            {lockExpired && (
              <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13 }}>
                {isPractice ? 'Returning to rules…' : 'Moving on…'}
              </Text>
            )}
          </View>
        </View>
      </View>
    </>
  );
}
