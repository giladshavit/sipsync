import { useEffect } from 'react';
import { ADSENSE_CLIENT_ID } from '@/config/adPlacements';

const ADS_ENABLED = process.env.EXPO_PUBLIC_ADS_ENABLED === 'true';
const ADSENSE_SRC = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT_ID}`;

// The `adsbygoogle` command queue also carries AdSense's documented
// pause flag: 1 stops the tag from sending ad requests, 0 resumes them.
type AdsQueue = unknown[] & { pauseAdRequests?: 0 | 1 };

declare global {
  interface Window {
    adsbygoogle?: AdsQueue;
  }
}

function setAdRequestsPaused(paused: boolean): void {
  const queue: AdsQueue = window.adsbygoogle ?? [];
  window.adsbygoogle = queue;
  queue.pauseAdRequests = paused ? 1 : 0;
}

// Mirrors lib/vercelInsights.tsx's approach: a client-injected script tag.
// Mounted from _layout.tsx on web; `active` is whether the current route is
// one of the content pages in config/adPlacements.ts. The tag is injected
// the first time an eligible page is shown and then left in place — removing
// it wouldn't undo Auto ads' initialisation, and re-adding it would run the
// script twice. Leaving a content page for the app (client-side navigation
// into /room/*, onboarding, ...) pauses ad requests instead, so Vignette
// never fires mid-game; coming back resumes them.
export default function AdSenseScript({ active }: { active: boolean }) {
  useEffect(() => {
    if (!ADS_ENABLED) return;
    setAdRequestsPaused(!active);
    if (!active) return;
    if (document.querySelector(`script[src="${ADSENSE_SRC}"]`)) return;
    const script = document.createElement('script');
    script.async = true;
    script.src = ADSENSE_SRC;
    script.crossOrigin = 'anonymous';
    document.head.appendChild(script);
  }, [active]);

  return null;
}
