// Guest UUID identity via SecureStore — implemented in M1 (Issue #11)
export function usePlayerIdentity() {
  return { playerId: null as string | null, displayName: null as string | null };
}
