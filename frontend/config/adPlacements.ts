// Per-placement kill switches for where the AdSense Auto-ads script is
// allowed to be present at all. Vignette itself decides *when* to actually
// show an ad within an eligible screen — these flags only control *which*
// screens the script ever loads on, so an admin can pull one placement
// (e.g. lobby) without affecting the other (podium), independent of the
// site-wide EXPO_PUBLIC_ADS_ENABLED kill switch in AdSenseScript.tsx.
export const LOBBY_AD_ENABLED = true;
export const PODIUM_AD_ENABLED = true;

const LOBBY_PATH = /^\/room\/[^/]+\/lobby$/;
const PODIUM_PATH = /^\/room\/[^/]+\/podium$/;

export function isAdEligiblePath(pathname: string): boolean {
  if (LOBBY_AD_ENABLED && LOBBY_PATH.test(pathname)) return true;
  if (PODIUM_AD_ENABLED && PODIUM_PATH.test(pathname)) return true;
  return false;
}
