// WebSocket connection + clock handshake — implemented in M2 (Issue #15)
export function useRoomSocket(_code: string) {
  return { send: (_msg: unknown) => {}, connected: false };
}
