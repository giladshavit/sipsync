import { useEffect, useRef, useState, useCallback } from 'react';
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
}

export interface UseRoomSocket {
  snapshot: RoomSnapshot | null;
  isConnected: boolean;
  send: (msg: object) => void;
}

export function useRoomSocket(code: string): UseRoomSocket {
  const { playerId, displayName } = usePlayerIdentity();
  const wsRef = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);

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

        case 'FSM_TRANSITION':
          setSnapshot((prev) => (prev ? { ...prev, state: msg.new_state } : prev));
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

  return { snapshot, isConnected, send };
}
