import * as React from 'react';

const MOBILE_BREAKPOINT = 768;
const QUERY = `(max-width: ${String(MOBILE_BREAKPOINT - 1)}px)`;

function subscribe(onChange: () => void): () => void {
  const mql = window.matchMedia(QUERY);
  mql.addEventListener('change', onChange);
  return () => {
    mql.removeEventListener('change', onChange);
  };
}

/** Whether the viewport is phone-sized. Read from the media query itself, so it never sets state in an effect. */
export function useIsMobile(): boolean {
  return React.useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}
