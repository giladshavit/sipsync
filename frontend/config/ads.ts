// Mock-ad feature flags — Web build only (see hooks/useMockAd.ts, which
// also gates on Platform.OS). Flip these to test ad placement/timing
// without touching a real ad network. An ad only shows if ENABLE_ALL_ADS
// AND its own specific flag are both true.
export const ENABLE_ALL_ADS = true;
export const ENABLE_LOBBY_AD = true;
export const ENABLE_PODIUM_AD = true;

export function shouldShowAd(specificFlag: boolean): boolean {
  return ENABLE_ALL_ADS && specificFlag;
}
