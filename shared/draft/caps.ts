/** Capped text fields, on their own: no dependencies, so the comment, profile,
 * support and rating fields import this without the draft normaliser. */

/** The one "too long" wording for every capped field. Normalisers keep one
 * character past the cap so the checks can report this instead of the field
 * losing its tail in silence (2026-09-17: 19 criteria cut at 300). */
export const tooLong = (label: string, cap: number): string =>
  `${label} is too long (${cap.toLocaleString("en-US")} characters at most).`;

/** `maxLength` for a capped control: room for one character past the cap so
 * the checks can say "too long" instead of the browser cutting the tail. Two
 * UTF-16 units, not one: when the character at the boundary is an emoji (a
 * surrogate pair) the browser will not split it, and with only one unit of
 * room it would drop the whole character in silence (2026-09-17: a title of
 * 71 emoji became 70 with no message). */
export const inputMax = (cap: number): number => cap + 2;
