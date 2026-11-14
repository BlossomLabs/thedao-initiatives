/** The initiatives this browser opened in admin, newest first, for the dashboard's shortcut list. */
export interface RecentInitiative {
  slug: string;
  title: string;
  at: number;
}

const KEY = "admin:recent";
const KEEP = 5;

export function recentInitiatives(): RecentInitiative[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(raw)
      ? raw.filter((x) => typeof x?.slug === "string" && typeof x?.title === "string")
      : [];
  } catch {
    return [];
  }
}

/** Called by the initiative page once it has loaded. */
export function rememberInitiative(slug: string, title: string, at = Date.now() / 1000): void {
  try {
    const next = [{ slug, title, at }, ...recentInitiatives().filter((x) => x.slug !== slug)]
      .slice(0, KEEP);
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Private windows and blocked storage: the shortcut list just stays empty.
  }
}
