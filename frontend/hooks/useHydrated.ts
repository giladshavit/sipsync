import { useEffect, useState } from 'react';

// True only after the first client render. Static-export hydration adopts
// the server's inline styles verbatim (React never patches attribute
// mismatches), so any style computed from runtime-only values (viewport
// size) must render the server's value on the first client pass too, then
// swap to the measured one — the value change is what makes React write
// the corrected style to the DOM.
export function useHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return hydrated;
}
