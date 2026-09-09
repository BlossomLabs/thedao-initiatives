/** Avatars: 10 gradient presets + a deterministic default per address
 * (port of static/app.js:294-343). */
const PFP_COLORS: [string, string][] = [
  ["#5cb75a", "#00ff88"],
  ["#2c5e86", "#5ac8fa"],
  ["#ff3b38", "#ffb03a"],
  ["#a06cff", "#5ac8fa"],
  ["#ff6ec7", "#ffb03a"],
  ["#00d2b8", "#5cb75a"],
  ["#ffcf3a", "#ff6b3a"],
  ["#6d8cff", "#a06cff"],
  ["#3ad1ff", "#2c5e86"],
  ["#ff8a5c", "#ff3b6b"],
];
const PFP_GLYPHS = [
  '<circle cx="20" cy="20" r="8" fill="#fff" opacity=".85"/>',
  '<path d="M20 12 L28 28 L12 28 Z" fill="#fff" opacity=".85"/>',
  '<circle cx="20" cy="20" r="8" fill="none" stroke="#fff" stroke-width="3" opacity=".85"/>',
  '<rect x="13" y="13" width="4" height="14" fill="#fff" opacity=".85"/><rect x="19" y="13" width="4" height="14" fill="#fff" opacity=".85"/><rect x="25" y="13" width="4" height="14" fill="#fff" opacity=".85"/>',
  '<path d="M20 11 L29 20 L20 29 L11 20 Z" fill="#fff" opacity=".85"/>',
  '<circle cx="15" cy="15" r="3" fill="#fff" opacity=".85"/><circle cx="25" cy="15" r="3" fill="#fff" opacity=".85"/><circle cx="15" cy="25" r="3" fill="#fff" opacity=".85"/><circle cx="25" cy="25" r="3" fill="#fff" opacity=".85"/>',
  '<path d="M11 22 Q15 15 20 22 T29 22" fill="none" stroke="#fff" stroke-width="3" opacity=".85"/>',
  '<path d="M20 11 L22.5 17 L29 17.5 L24 22 L25.5 28.5 L20 25 L14.5 28.5 L16 22 L11 17.5 L17.5 17 Z" fill="#fff" opacity=".85"/>',
  '<path d="M20 11 L28 15.5 L28 24.5 L20 29 L12 24.5 L12 15.5 Z" fill="#fff" opacity=".85"/>',
  '<rect x="17" y="12" width="6" height="16" fill="#fff" opacity=".85"/><rect x="12" y="17" width="16" height="6" fill="#fff" opacity=".85"/>',
];

export const PRESET_COUNT = 10;

export function presetSvg(i: number): string {
  const c = PFP_COLORS[i] ?? PFP_COLORS[0];
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">' +
    '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
    `<stop offset="0" stop-color="${c[0]}"/><stop offset="1" stop-color="${c[1]}"/>` +
    '</linearGradient></defs><rect width="40" height="40" rx="20" fill="url(#g)"/>' +
    (PFP_GLYPHS[i] ?? "") + "</svg>";
}

export const presetUri = (i: number): string =>
  "data:image/svg+xml," + encodeURIComponent(presetSvg(i));

export function addrHash(a: string): number {
  let h = 5381;
  const s = (a || "").toLowerCase();
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h;
}

export const pfpDefaultIndex = (address: string): number => addrHash(address) % PRESET_COUNT;

/** Image source for an address given its pfp value ("" = default, "preset:N", or an uploaded URL). */
export function avatarSrc(address: string, pfp?: string, pfpUrl?: string): string {
  if (pfpUrl) return pfpUrl;
  if (pfp?.startsWith("preset:")) return presetUri(parseInt(pfp.slice(7), 10) || 0);
  return presetUri(pfpDefaultIndex(address));
}
