import { useSyncExternalStore } from 'react';

/** Below this width the app shows one pane at a time with a tab bar. Matches Tailwind's `lg`. */
export const MOBILE_QUERY = '(max-width: 1023px)';

export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (l) => {
      const m = matchMedia(query);
      m.addEventListener('change', l);
      return () => m.removeEventListener('change', l);
    },
    () => matchMedia(query).matches,
  );
}

export const useIsMobile = () => useMedia(MOBILE_QUERY);
