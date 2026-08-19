import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

// Static-export HTML shell. Global, page-independent tags only — titles,
// descriptions and og/social tags live in React (<Head>) so pages can
// override them; helmet dedupes those by tag identity, while anything
// written here is baked in verbatim on every page.
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
        <ScrollViewStyleReset />
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
        {/* Pre-hydration paint: cream matches the app, not browser white. */}
        <style dangerouslySetInnerHTML={{ __html: 'html, body { background-color: #FFF8E1; }' }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
