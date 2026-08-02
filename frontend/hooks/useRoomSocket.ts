import { useEffect, useRef, useState, useCallback, MutableRefObject } from 'react';
import { Platform } from 'react-native';
import { usePlayerIdentity } from './usePlayerIdentity';
import { API_BASE } from '@/constants/api';

const WS_BASE = API_BASE.replace(/^http/, 'ws');

export interface Player {
  display_name: string;
  score: number;
  clock_offset: number;
  /** Key into VIBE_ICONS — the icon the player picked at onboarding. */
  vibe?: string | null;
  /** This room's visual identifier for the player — a key into
   * AVATAR_IMAGES, server-assigned, unique per room, swappable by the
   * player themself. */
  avatar?: string | null;
  /** False while the player's socket is dropped but they're still within
   * the server's reconnection grace period — their seat, score, and avatar
   * stay reserved. Absent/true means fully present. Only PLAYER_LEFT (after
   * the grace period expires, or an explicit LEAVE_ROOM) removes them. */
  connected?: boolean;
  /** Server epoch-ms timestamp of the disconnect that produced the current
   * `connected: false`, null once reconnected. */
  disconnected_at?: number | null;
  /** Late Join: true while this player joined mid-round (TUTORIAL or
   * PLAYING) and hasn't been part of a round's own setup yet — the server
   * excludes them from the game in progress and clears this once it ends.
   * Drives whether *this* player's own client shows the Waiting Room
   * instead of the live tutorial/board (see app/room/[code]/waiting.tsx). */
  waiting_for_next_game?: boolean;
  /** Total Drinks: cumulative chasers owed across every round played so
   * far tonight, not just the most recent one — accumulated server-side in
   * _enrich_scores_and_broadcast alongside score. Drives the "TOTAL" tab in
   * the Who's Drinking popup on podium.tsx. */
  total_chasers?: number;
}

export interface RoomSnapshot {
  state: string | null;
  admin_id: string | null;
  players: Record<string, Player>;
  tutorialType?: string;
  tutorialAsset?: string;
  activeGameId?: string | null;
  gameState?: Record<string, unknown>;
  /** Ordered selection of game ids this room's deck is drawing from. */
  gameIds: string[];
  /** Solo practice-vs-bots room (see games/[id]/index.tsx's Simulate button) —
   * changes summary.tsx's post-round destination from the podium back to the
   * rules screen this room was started from. */
  isPractice: boolean;
  /** Host Migration: true once this hook instance has observed *this*
   * player's own admin_id newly become theirs (a promotion, not just being
   * the room's original creator) and nothing has dismissed it yet — see
   * dismissPromotion(). Detected locally per mount (see previousAdminId in
   * useRoomSocket); a promotion that happens while this player is on a
   * different screen (a different mount) won't retroactively flag here —
   * only podium.tsx renders a toast for it, so that's the one screen where
   * it matters, and it's simplest to compute directly from what a single
   * mount has itself observed rather than tracking it across screens. */
  justPromoted?: boolean;
  /** Up Next preview (podium.tsx): the game id the deck will hand out next,
   * peeked (not popped) server-side so it can be shown before the round
   * that draws it actually starts. Null once the deck itself is empty (no
   * games selected). */
  nextGameId?: string | null;
  /** Custom Question (majority/minority only): the player_id currently
   * writing the room's own question, present whenever `state` is
   * 'CUSTOM_QUESTION_INPUT' — see app/room/[code]/custom-question.tsx. */
  writerId?: string | null;
}

export interface PlayerOutcome {
  result: 'WIN' | 'LOSE' | 'SAFE';
  chasers: number;
  score_delta: number;
  total_score: number;
  reason?: string;
  /** Reflex: server-judged reaction time (ms) for valid green taps. */
  reaction_ms?: number;
  /** Tap race: final tap count. */
  taps?: number;
  /** Human timer: when the player tapped and how far off the target (ms). */
  elapsed_ms?: number;
  error_ms?: number;
  target_ms?: number;
  /** Closest Average: the player's pick and its distance from the room average. */
  number?: number;
  distance?: number;
  /** Sacrifice: how many chasers this player pledged, and the room's tally. */
  pledges?: number;
  pledged_total?: number;
  target_chasers?: number;
  /** Dilemma: this player's own pick and their paired opponent's. Null for
   * the round's immune player (no pairing, no pick). */
  choice?: 'HELP' | 'BETRAY' | 'A' | 'B' | null;
  opponent_id?: string | null;
  opponent_choice?: 'HELP' | 'BETRAY' | null;
  /** Majority: the round's mode/tie state and whether this player's pick was
   * auto-assigned by an EXPIRE default rather than chosen. */
  mode?: 'FLOW' | 'AGAINST';
  tie?: boolean;
  coin_flip?: boolean | null;
  auto_voted?: boolean;
}

export interface UseRoomSocket {
  snapshot: RoomSnapshot | null;
  isConnected: boolean;
  send: (msg: object) => void;
  outcomesRef: MutableRefObject<Record<string, PlayerOutcome>>;
  dissolved: boolean;
  /**
   * Forces a fresh socket + a fresh ROOM_STATE snapshot right now, instead of
   * waiting on whatever this connection does next. Ordinary drops already
   * self-heal via `onclose` -> the reconnect timer, but a connection can go
   * quietly stale (esp. on mobile: backgrounding, network handoff) without
   * ever firing `onclose` — nothing arrives, but nothing tells us to stop
   * waiting either. Screens that gate a room-wide transition on a message
   * that might never come (see summary.tsx) call this as a self-heal.
   */
  reconnect: () => void;
  /** Acknowledges a shown Host Migration promotion toast so `justPromoted`
   * doesn't re-fire on the next screen. See `justPromoted` on RoomSnapshot. */
  dismissPromotion: () => void;
}

const RECONNECT_DELAY_MS = 1500;

export function useRoomSocket(code: string): UseRoomSocket {
  const { playerId, displayName, vibe, preferredAvatar } = usePlayerIdentity();
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmountedRef = useRef(false);
  const connectRef = useRef<() => void>(() => {});
  // Bumped on every connect() call; each socket's callbacks capture the
  // generation they were opened under and no-op if a newer one has since
  // taken over. A stale/half-dead socket (dead network path, no clean
  // disconnect — common on mobile) can go quiet for a long time without ever
  // firing onclose, so reconnect() below can't afford to wait for it: it
  // opens a fresh socket immediately and this token stops the old one's
  // eventual (possibly very late) onclose from stomping the new connection's
  // state or scheduling a redundant reconnect on top of it.
  const generationRef = useRef(0);

  const [isConnected, setIsConnected] = useState(false);
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  // Ref so consumers can read outcomes synchronously at FSM-transition time
  // without waiting for a React re-render (avoids a setSnapshot race).
  const outcomesRef = useRef<Record<string, PlayerOutcome>>({});
  const [dissolved, setDissolved] = useState(false);
  // Host Migration: last admin_id this hook instance has itself observed —
  // null until the first ROOM_STATE lands, then compared on every
  // subsequent one to detect *this* player being newly promoted. Local to
  // this mount (not module scope) — a promotion that happens while this
  // player is on a different screen won't be back-filled here when a later
  // screen mounts fresh; only podium.tsx renders the toast, so that's fine.
  const previousAdminId = useRef<string | null>(null);

  // Keep stable refs to identity so the connect function always uses latest values
  const playerIdRef = useRef(playerId);
  const displayNameRef = useRef(displayName);
  const vibeRef = useRef(vibe);
  const preferredAvatarRef = useRef(preferredAvatar);
  playerIdRef.current = playerId;
  displayNameRef.current = displayName;
  vibeRef.current = vibe;
  preferredAvatarRef.current = preferredAvatar;

  useEffect(() => {
    if (!playerId || !displayName) return;
    unmountedRef.current = false;

    function connect() {
      if (unmountedRef.current) return;

      const myGeneration = ++generationRef.current;
      const ws = new WebSocket(`${WS_BASE}/ws/${code}`);
      wsRef.current = ws;

      ws.onopen = () => {
        if (unmountedRef.current || generationRef.current !== myGeneration) { ws.close(); return; }
        setIsConnected(true);
        ws.send(
          JSON.stringify({
            type: 'HANDSHAKE',
            player_id: playerIdRef.current,
            display_name: displayNameRef.current,
            vibe: vibeRef.current,
            preferred_avatar: preferredAvatarRef.current,
            local_ts: Date.now(),
          }),
        );
      };

      ws.onmessage = (event: MessageEvent<string>) => {
        if (generationRef.current !== myGeneration) return; // superseded socket — ignore
        const msg = JSON.parse(event.data);

        switch (msg.type) {
          case 'ROOM_STATE': {
            // Host Migration: flag a promotion only when this hook instance
            // has already seen a *different* admin_id before (so the very
            // first ROOM_STATE this mount ever receives — the room
            // creator's own initial snapshot, or simply arriving on a
            // screen where the promotion already happened earlier — never
            // flags a promotion) and the new one is this player's own id.
            const justPromoted =
              !!previousAdminId.current &&
              previousAdminId.current !== playerIdRef.current &&
              msg.admin_id === playerIdRef.current;
            previousAdminId.current = msg.admin_id ?? null;

            setSnapshot({
              state: msg.state,
              admin_id: msg.admin_id,
              players: msg.players ?? {},
              gameIds: msg.game_ids ?? [],
              isPractice: !!msg.practice,
              // Present whenever a game has been picked for this room, even
              // outside PLAYING (e.g. reconnecting during PERSONAL_SUMMARY) —
              // practice mode's exit-to-rules-screen needs this regardless of
              // whether a GAME_STATE broadcast happened to land on this
              // particular connection.
              activeGameId: msg.active_game ?? undefined,
              // Present when reconnecting into a room that's mid-TUTORIAL —
              // the transition broadcast that normally carries these was
              // missed, so the handshake snapshot supplies them instead.
              ...(msg.tutorial_type
                ? { tutorialType: msg.tutorial_type, tutorialAsset: msg.tutorial_asset }
                : {}),
              ...(msg.writer_id !== undefined ? { writerId: msg.writer_id } : {}),
              justPromoted,
              nextGameId: msg.next_game_id ?? null,
            });
            break;
          }

          case 'GAME_IDS_UPDATED':
            setSnapshot((prev) =>
              prev ? { ...prev, gameIds: msg.game_ids ?? [] } : prev,
            );
            break;

          case 'PLAYER_JOINED':
            setSnapshot((prev) =>
              prev
                ? {
                    ...prev,
                    players: {
                      ...prev.players,
                      [msg.player_id]: {
                        display_name: msg.display_name,
                        score: msg.score ?? 0,
                        clock_offset: msg.clock_offset ?? 0,
                        vibe: msg.vibe ?? null,
                        avatar: msg.avatar ?? null,
                        connected: true,
                        disconnected_at: null,
                        waiting_for_next_game: msg.waiting_for_next_game ?? false,
                        total_chasers: msg.total_chasers ?? 0,
                      },
                    },
                  }
                : prev,
            );
            break;

          // Soft departure: the player's socket dropped but the server is
          // holding their seat/score/avatar for a grace period in case they
          // reconnect. Unlike PLAYER_LEFT, they stay in the roster.
          case 'PLAYER_DISCONNECTED':
            setSnapshot((prev) => {
              if (!prev || !prev.players[msg.player_id]) return prev;
              return {
                ...prev,
                players: {
                  ...prev.players,
                  [msg.player_id]: {
                    ...prev.players[msg.player_id],
                    connected: false,
                    disconnected_at: Date.now(),
                  },
                },
              };
            });
            break;

          case 'PLAYER_AVATAR_CHANGED':
            setSnapshot((prev) => {
              if (!prev || !prev.players[msg.player_id]) return prev;
              return {
                ...prev,
                players: {
                  ...prev.players,
                  [msg.player_id]: { ...prev.players[msg.player_id], avatar: msg.avatar },
                },
              };
            });
            break;

          case 'PLAYER_LEFT': {
            setSnapshot((prev) => {
              if (!prev) return prev;
              const { [msg.player_id]: _removed, ...rest } = prev.players;
              return { ...prev, players: rest };
            });
            break;
          }

          case 'OUTCOMES':
            // Store in ref only — game.tsx reads it synchronously on FSM transition
            outcomesRef.current = msg.outcomes ?? {};
            break;

          case 'ROOM_DISSOLVED':
            setDissolved(true);
            break;

          case 'GAME_STATE':
            setSnapshot((prev) =>
              prev
                ? { ...prev, activeGameId: msg.game_id, gameState: msg.state as Record<string, unknown> }
                : prev,
            );
            break;

          case 'FSM_TRANSITION':
            setSnapshot((prev) =>
              prev
                ? {
                    ...prev,
                    state: msg.new_state,
                    ...(msg.tutorial_type
                      ? { tutorialType: msg.tutorial_type, tutorialAsset: msg.tutorial_asset }
                      : {}),
                    // Only handle_start_custom_question's transition into
                    // CUSTOM_QUESTION_INPUT carries this.
                    ...(msg.writer_id !== undefined ? { writerId: msg.writer_id } : {}),
                    // Only the PODIUM transition carries this — see
                    // room_service's handle_goto_podium / _summary_timeout.
                    ...(msg.next_game_id !== undefined ? { nextGameId: msg.next_game_id } : {}),
                  }
                : prev,
            );
            break;

          // Up Next preview: admin skipped the queued game — server already
          // burned it (deck.pop_next_game) and peeked the new one.
          case 'NEXT_GAME_UPDATED':
            setSnapshot((prev) =>
              prev ? { ...prev, nextGameId: msg.next_game_id ?? null } : prev,
            );
            break;
        }
      };

      ws.onclose = () => {
        if (generationRef.current !== myGeneration) return; // superseded socket — a newer connect() already owns wsRef/reconnectTimer
        setIsConnected(false);
        wsRef.current = null;
        // Auto-reconnect unless the component unmounted intentionally
        if (!unmountedRef.current) {
          reconnectTimer.current = setTimeout(connect, RECONNECT_DELAY_MS);
        }
      };
    }

    connectRef.current = connect;
    connect();

    return () => {
      unmountedRef.current = true;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [code, playerId, displayName]);

  const send = useCallback((msg: object) => {
    wsRef.current?.send(JSON.stringify(msg));
  }, []);

  const reconnect = useCallback(() => {
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
    // Detach the current socket's handlers before dropping it — a stale
    // connection may never fire onclose (or may fire it long after we've
    // moved on), and without this its generation check alone wouldn't stop
    // a straggling onmessage from a socket we've already abandoned. Then
    // open a fresh connection right away instead of waiting on the old
    // one's close event, which is the whole point of this escape hatch.
    const stale = wsRef.current;
    if (stale) {
      stale.onopen = null;
      stale.onmessage = null;
      stale.onclose = null;
      try { stale.close(); } catch { /* already dead — nothing to clean up */ }
    }
    // Explicit false->true round trip (a stale socket's own onclose is
    // detached above, so it can no longer do this itself) — callers that
    // resend a message once `isConnected` becomes true again (e.g.
    // summary.tsx's GOTO_PODIUM) depend on seeing it actually flip, not
    // just stay true the whole time a hung socket looked fine from here.
    setIsConnected(false);
    connectRef.current();
  }, []);

  // Mobile browsers throttle or silently kill WebSockets when a tab is
  // backgrounded, often without ever firing `onclose` — the socket looks
  // alive to this hook until the next message would have arrived. Checking
  // readyState the instant the tab becomes visible again catches that dead
  // state immediately instead of waiting on a message that will never come.
  useEffect(() => {
    if (Platform.OS !== 'web') return;

    function handleVisibilityChange() {
      if (unmountedRef.current) return;
      if (document.visibilityState !== 'visible') return;
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        reconnect();
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [reconnect]);

  const dismissPromotion = useCallback(() => {
    setSnapshot((prev) => (prev ? { ...prev, justPromoted: false } : prev));
  }, []);

  return { snapshot, isConnected, send, outcomesRef, dissolved, reconnect, dismissPromotion };
}
