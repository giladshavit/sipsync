const PRODUCTION_DOMAIN = 'https://quicklegame.com';

// A single https link for both web and native shares — it opens straight in
// a browser tab on web, and reads as a normal, trustworthy link (rather than
// a bare `sipsync://` scheme, which most share targets show unresolved and
// which does nothing if the recipient doesn't have the app installed yet).
// Native deep-linking through this same URL requires associated-domains
// config (apple-app-site-association / assetlinks.json) that isn't set up
// yet — until then this always opens the web fallback at `/room/[code]`.
export function buildRoomShareUrl(code: string): string {
  return `${PRODUCTION_DOMAIN}/room/${code}`;
}

export function buildRoomShareMessage(code: string): string {
  return `Join my Quickle party! Click here: ${buildRoomShareUrl(code)}`;
}
