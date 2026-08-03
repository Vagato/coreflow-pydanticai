"use client";

import { useEffect, useState } from "react";

/**
 * Returns true when the viewport matches a CSS media query.
 * Re-renders on resize/changes so the caller always sees the current value.
 *
 * Usage:
 *   const isMobile = useMediaQuery("(pointer: coarse)");
 *   const isLarge  = useMediaQuery("(min-width: 1024px)");
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    // SSR guard — window isn't available during server render
    if (typeof window === "undefined") return;

    const mql = window.matchMedia(query);
    setMatches(mql.matches);

    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}
