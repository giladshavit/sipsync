import { useEffect } from 'react';

const ADS_ENABLED = process.env.EXPO_PUBLIC_ADS_ENABLED === 'true';
const ADSENSE_SRC =
  'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-6248733928314999';

// Mirrors lib/vercelInsights.tsx's approach: a client-injected script tag,
// mounted from _layout.tsx alongside Analytics/SpeedInsights. React 18
// Strict Mode double-invokes effects in development, so this guards
// against appending the tag twice on a single mount.
export default function AdSenseScript() {
  useEffect(() => {
    if (!ADS_ENABLED) return;
    if (document.querySelector(`script[src="${ADSENSE_SRC}"]`)) return;
    const script = document.createElement('script');
    script.async = true;
    script.src = ADSENSE_SRC;
    script.crossOrigin = 'anonymous';
    document.head.appendChild(script);
  }, []);

  return null;
}
