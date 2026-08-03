// Metro doesn't resolve package.json "exports" subpaths (unlike TypeScript), and these
// packages only declare their React entrypoint there — so we require() the concrete dist
// file Metro can actually find, typed against the subpath TypeScript resolves correctly.
export const Analytics = (require('@vercel/analytics/dist/react').Analytics) as typeof import('@vercel/analytics/react').Analytics;
export const SpeedInsights = (require('@vercel/speed-insights/dist/react').SpeedInsights) as typeof import('@vercel/speed-insights/react').SpeedInsights;
