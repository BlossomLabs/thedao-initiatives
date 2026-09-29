import { type RefObject, useEffect } from "react";

/**
 * A plain button can stand in for a control whose code is still loading.
 * When the real control replaces it while it holds focus, focus would drop to
 * the page; these two pass it on instead. `key` pairs a stand-in with its
 * control (one per card, say).
 */
let held: { key: string; el: HTMLElement } | null = null;

export const standInFocus = (key: string) => ({
  onFocus: (e: React.FocusEvent<HTMLElement>) => {
    held = { key, el: e.currentTarget };
  },
  onBlur: (e: React.FocusEvent<HTMLElement>) => {
    // Focus moved elsewhere; a blur from being removed has no related target.
    if (e.relatedTarget && held?.key === key) held = null;
  },
});

export function useTakeFocus(key: string, ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!held || held.key !== key) return;
    const lost = !held.el.isConnected;
    held = null;
    if (lost) ref.current?.focus();
  }, []);
}
