import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

// Static-export HTML shell. Global, page-independent tags only — titles,
// descriptions and og/social tags live in React (<Head>) so pages can
// override them; helmet dedupes those by tag identity, while anything
// written here is baked in verbatim on every page.
// Set in Vercel's environment (never in the repo). Absent → no pixel, no
// request to Meta at all. Present → the standard base snippet plus PageView;
// the in-app events live in lib/metaPixel.ts.
const META_PIXEL_ID = process.env.EXPO_PUBLIC_META_PIXEL_ID;

function metaPixelSnippet(id: string): string {
  return (
    "!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?" +
    "n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;" +
    "n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;" +
    "t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window," +
    "document,'script','https://connect.facebook.net/en_US/fbevents.js');" +
    `fbq('init','${id}');fbq('track','PageView');`
  );
}

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        {/* viewport-fit=cover lets layout extend under the iPhone notch /
            home-indicator; safe-area-context's web env() insets need it. */}
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, shrink-to-fit=no, viewport-fit=cover"
        />
        {/* Proves to Meta that quicklegame.com is ours - required before web
            conversion events can be prioritised for ads. The value is public
            by design (it appears in the page source of every verified site). */}
        <meta name="facebook-domain-verification" content="m1l349fownnxxywcrbe2cvfwuip1y1" />
        <ScrollViewStyleReset />
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
        {/* Pre-hydration paint: cream matches the app, not browser white. */}
        <style dangerouslySetInnerHTML={{ __html: 'html, body { background-color: #FFF8E1; }' }} />
        {META_PIXEL_ID && <script dangerouslySetInnerHTML={{ __html: metaPixelSnippet(META_PIXEL_ID) }} />}
      </head>
      <body>{children}</body>
    </html>
  );
}
