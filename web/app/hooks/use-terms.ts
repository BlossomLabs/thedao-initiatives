/**
 * The donation terms in force, from the API's versioned store. The bundled
 * copy (content/donation-terms.md via app/data/terms.ts) is the fallback while
 * nothing has been published yet or the API cannot be reached, so the gate and
 * the terms page always have a document.
 */
import { useQuery } from "@tanstack/react-query";
import { API_URL } from "~/lib/api";
import { TERMS } from "~/data/terms";

export interface TermsVersionMeta {
  /** Content hash of the effective date plus the text (the bundled fallback uses its version line). */
  id: string;
  /** YYYY-MM-DD */
  effectiveDate: string;
  material: boolean;
  /** Unix seconds; null for the bundled fallback. */
  publishedAt: number | null;
}

export interface TermsDoc extends TermsVersionMeta {
  text: string;
  fromBundle?: boolean;
}

export interface TermsVersionList {
  current: string | null;
  versions: TermsVersionMeta[];
}

export const BUNDLED_TERMS: TermsDoc = {
  id: TERMS.version,
  effectiveDate: TERMS.version,
  material: false,
  publishedAt: null,
  text: TERMS.body,
  fromBundle: true,
};

/** A material change is announced on the terms page and under the widget for this long. */
export const MATERIAL_NOTICE_DAYS = 30;

export function materialNoticeActive(v: TermsVersionMeta | undefined, nowSecs = Date.now() / 1000) {
  return Boolean(
    v && v.material && v.publishedAt != null &&
      nowSecs - v.publishedAt < MATERIAL_NOTICE_DAYS * 86400,
  );
}

/** "2026-09-06" -> "September 6, 2026" (UTC, so the date never shifts by timezone). */
export function formatEffective(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return date;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function useTerms() {
  return useQuery({
    queryKey: ["terms"],
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<TermsDoc> => {
      try {
        const res = await fetch(API_URL + "/api/terms");
        if (!res.ok) return BUNDLED_TERMS;
        return (await res.json()) as TermsDoc;
      } catch {
        return BUNDLED_TERMS;
      }
    },
  });
}

export function useTermsVersions() {
  return useQuery({
    queryKey: ["terms-versions"],
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<TermsVersionList> => {
      try {
        const res = await fetch(API_URL + "/api/terms/versions");
        if (!res.ok) return { current: null, versions: [] };
        return (await res.json()) as TermsVersionList;
      } catch {
        return { current: null, versions: [] };
      }
    },
  });
}

export function useTermsVersion(id: string | undefined) {
  return useQuery({
    queryKey: ["terms-version", id],
    enabled: Boolean(id),
    staleTime: Infinity,
    queryFn: async (): Promise<TermsDoc | null> => {
      const res = await fetch(API_URL + "/api/terms/versions/" + encodeURIComponent(id!));
      if (!res.ok) return null;
      return (await res.json()) as TermsDoc;
    },
  });
}
