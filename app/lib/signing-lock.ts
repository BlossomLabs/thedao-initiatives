/**
 * One pledge signing at a time, from anywhere on the page: the API reads the wallet's
 * pledge nonce when it prepares, so two signatures at once would carry the same nonce and
 * the second would fail after the admin signed it. A Sign, a Sign all, a Put on the ballot
 * and the pledge form's own signing each hold it from start to end; every such button is
 * disabled while it is held.
 */
import { useSyncExternalStore } from "react";

let lockOwner: string | null = null;
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
const emit = () => listeners.forEach((fn) => fn());

/** Takes the signing lock; false when something else holds it. */
export function takeLock(owner: string): boolean {
  if (lockOwner !== null) return false;
  lockOwner = owner;
  emit();
  return true;
}
export function dropLock(owner: string) {
  if (lockOwner !== owner) return;
  lockOwner = null;
  emit();
}
/** Whether anything is being signed or put on the ballot right now. */
export const useLocked = (): boolean =>
  useSyncExternalStore(subscribe, () => lockOwner !== null, () => lockOwner !== null);
/** For tests: nothing holds it. */
export function resetLock() {
  lockOwner = null;
  emit();
}
