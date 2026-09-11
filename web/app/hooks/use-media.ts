import { useEffect, useState } from "react";

/** True while the media query matches; false on the server and first paint. */
export function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    if (typeof globalThis.matchMedia !== "function") return;
    const mq = globalThis.matchMedia(query);
    const update = () => setMatches(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [query]);
  return matches;
}

/** The phone breakpoint used by the form and the board (max-[640px] in Tailwind). */
export const usePhone = () => useMedia("(max-width: 640px)");
