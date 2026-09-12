// Where the AdSense Auto-ads (Vignette) script is allowed to be present.
//
// AdSense's Google Publisher Policies forbid Google-served ads on screens
// "without publisher content" — screens used for navigation, alerts or other
// behavioral purposes. The room lobby and podium are exactly that (and are
// robots-disallowed to every crawler, so Google can't even review them), so
// quicklegame.com was rejected while the script lived there (#178). Ads are
// therefore only ever eligible on the public, static, crawlable content
// pages listed in the sitemap: home, the catalog, the rule pages and the
// info pages. Gameplay (/room/*), onboarding, profile and the animated
// tutorial previews never load the script, and AdSenseScript.tsx pauses ad
// requests when the user navigates client-side from a content page into
// the app. The site-wide EXPO_PUBLIC_ADS_ENABLED kill switch lives in
// AdSenseScript.tsx.

// Public AdSense publisher id — appears in ads.txt and the verification
// meta tag, so it is not a secret.
export const ADSENSE_CLIENT_ID = 'ca-pub-6248733928314999';

const CONTENT_PATHS: readonly RegExp[] = [
  /^\/$/,
  /^\/games$/,
  /^\/games\/[^/]+$/, // rule pages only — /games/<id>/tutorial is an app-like screen
  /^\/about$/,
  /^\/faq$/,
  /^\/terms$/,
  /^\/privacy$/,
];

export function isAdEligiblePath(pathname: string): boolean {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return CONTENT_PATHS.some((re) => re.test(path));
}
