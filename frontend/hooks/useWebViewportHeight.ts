import { useEffect, useState } from 'react';
import { Platform, useWindowDimensions } from 'react-native';

// Web-only: the height the app root should actually occupy.
//
// Two iOS Safari quirks make plain `height: 100%` / `100vh` wrong:
// 1. The address bar collapsing/expanding doesn't resize the layout
//    viewport live — window dimensions only update on the resize event.
// 2. The on-screen keyboard doesn't resize the layout viewport AT ALL —
//    only the *visual* viewport shrinks, and Safari "pans" the page to
//    reveal the focused input, throwing a fixed-height app out of frame.
//
// visualViewport.height covers both: it tracks the address bar AND the
// keyboard. Sizing the root to it means that when the keyboard opens the
// app reflows into the space that's really visible — the focused field
// stays on screen and there's nothing for Safari to pan to (any pan that
// does happen is undone below).
export function useWebViewportHeight(): number {
  const { height: windowHeight } = useWindowDimensions();
  const [vvHeight, setVvHeight] = useState<number | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined' || !window.visualViewport) return;
    const vv = window.visualViewport;
    const onResize = () => {
      setVvHeight(vv.height);
      // Undo Safari's focus pan: with the root sized to the visible area
      // there is nothing meaningful to pan to.
      window.scrollTo(0, 0);
    };
    vv.addEventListener('resize', onResize);
    return () => vv.removeEventListener('resize', onResize);
  }, []);

  return Platform.OS === 'web' && vvHeight != null ? vvHeight : windowHeight;
}
