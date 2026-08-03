// Mock-ad feature flags — Web build only (see hooks/useMockAd.ts, which
// also gates on Platform.OS). Flip these to test ad placement/timing
// without touching a real ad network. An ad only shows if ENABLE_ALL_ADS
// AND its own specific flag are both true.
//
// PRE-LAUNCH CHECKLIST: these default to `true` so mock ads test on a live
// web build right now. Before a real production web deploy — or once real
// AdSense wiring replaces this mock layer — flip these to `false` (or wire
// them to actual ad-network config) so real users never see test inventory.
export const ENABLE_ALL_ADS = false;
export const ENABLE_LOBBY_AD = true;
export const ENABLE_PODIUM_AD = true;

export function shouldShowAd(specificFlag: boolean): boolean {
  return ENABLE_ALL_ADS && specificFlag;
}
