import { useEffect, useRef, useState, useCallback, MutableRefObject } from 'react';
import { usePlayerIdentity } from './usePlayerIdentity';
import { API_BASE } from '@/constants/api';

const WS_BASE = API_BASE.replace(/^http/, 'ws');

export interface Player {
  display_name: string;
  score: number;
  clock_offset: number;
}

export interface RoomSnapshot {
  state: string | null;
  admin_id: string | null;
  players: Record<string, Player>;
  tutorialType?: string;
  tutorialAsset?: string;
  activeGameId?: string | null;
  gameState?: Record<string, unknown>;
}

export interface PlayerOutcome {
  result: 'WIN' | 'LOSE' | 'SAFE';
  chasers: number;
  score_delta: number;
  total_score: number;
  reason?: string;
}

export interface UseRoomSocket {
  snapshot: RoomSnapshot | null;
  isConnected: boolean;
  send: (msg: object) => void;
  outcomesRef: MutableRefObject<Record<string, PlayerOutcome>>;
}

export function useRoomSocket(code: string): UseRoomSocket {
  const { playerId, displayName } = usePlayerIdentity();
  const wsRef = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  // Ref so consumers can read outcomes synchronously at FSM-transition time
  // without waiting for a React re-render (avoids a setSnapshot race).
  const outcomesRef = useRef<Record<string, PlayerOutcome>>({});

  useEffect(() => {
    if (!playerId || !displayName) return;

    const ws = new WebSocket(`${WS_BASE}/ws/${code}`);
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
      ws.send(
        JSON.stringify({
          type: 'HANDSHAKE',
          player_id: playerId,
          display_name: displayName,
          local_ts: Date.now(),
        }),
      );
    };

    ws.onmessage = (event: MessageEvent<string>) => {
      const msg = JSON.parse(event.data);

      switch (msg.type) {
        case 'ROOM_STATE':
          setSnapshot({
            state: msg.state,
            admin_id: msg.admin_id,
            players: msg.players ?? {},
          });
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
                      score: 0,
                      clock_offset: 0,
                    },
                  },
                }
              : prev,
          );
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
                }
              : prev,
          );
          break;
      }
    };

    ws.onclose = () => {
      setIsConnected(false);
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [code, playerId, displayName]);

  const send = useCallback((msg: object) => {
    wsRef.current?.send(JSON.stringify(msg));
  }, []);

  return { snapshot, isConnected, send, outcomesRef };
}
