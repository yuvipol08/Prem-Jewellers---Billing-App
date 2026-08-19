import { useEffect, useRef, useState } from 'react';

/** Delays a fast-changing value — used so search boxes hit SQLite once, not per keystroke. */
export function useDebounced<T>(value: T, delayMs = 220): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}

/** Tracks the browser's online flag, shown as the offline badge in the header. */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  return online;
}

/** Closes popovers when a click lands outside the referenced element. */
export function useClickOutside<T extends HTMLElement>(
  onOutside: () => void,
  active = true,
): React.RefObject<T | null> {
  const ref = useRef<T>(null);
  const handler = useRef(onOutside);
  handler.current = onOutside;

  useEffect(() => {
    if (!active) return undefined;
    const listener = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) handler.current();
    };
    document.addEventListener('mousedown', listener);
    return () => document.removeEventListener('mousedown', listener);
  }, [active]);

  return ref;
}
