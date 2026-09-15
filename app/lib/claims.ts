/** Claim tokens for the viewer's own held comments (localStorage). */
const KEY = "thedao:claims";

export function myClaimTokens(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(raw)
      ? raw.filter((t) => typeof t === "string" && /^[0-9a-f]{32}$/.test(t)).slice(-20)
      : [];
  } catch {
    return [];
  }
}

export function rememberClaimToken(token: string) {
  if (!/^[0-9a-f]{32}$/.test(token)) return;
  try {
    const list = myClaimTokens().filter((t) => t !== token);
    list.push(token);
    localStorage.setItem(KEY, JSON.stringify(list.slice(-20)));
  } catch { /* private mode */ }
}
