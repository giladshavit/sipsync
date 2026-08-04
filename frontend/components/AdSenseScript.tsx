import { useEffect } from 'react';

const ADS_ENABLED = process.env.EXPO_PUBLIC_ADS_ENABLED === 'true';
const ADSENSE_SRC =
  'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-6248733928314999';

// Mirrors lib/vercelInsights.tsx's approach: a client-injected script tag,
// mounted from _layout.tsx only while the current route is ad-eligible
// (see config/adPlacements.ts). The querySelector guard covers Fast
// Refresh / re-mounts within the same eligible screen; the cleanup below
// removes the tag when navigating away, so the connector is only actually
// present while on lobby/podium, not for the rest of the session.
export default function AdSenseScript() {
  useEffect(() => {
    if (!ADS_ENABLED) return;
    if (document.querySelector(`script[src="${ADSENSE_SRC}"]`)) return;
    const script = document.createElement('script');
    script.async = true;
    script.src = ADSENSE_SRC;
    script.crossOrigin = 'anonymous';
    document.head.appendChild(script);
    return () => {
      script.remove();
    };
  }, []);

  return null;
}
