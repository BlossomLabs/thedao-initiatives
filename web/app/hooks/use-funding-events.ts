import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { API_URL } from "~/lib/api";
import { initiativeKey } from "./use-initiative";
import { boardKey } from "./use-board";

/** Where the API streams an initiative's funding events (SSE). */
export const fundingEventsUrl = (slug: string) =>
  `${API_URL}/api/initiatives/${encodeURIComponent(slug)}/events`;

/**
 * Keep an initiative page's money live. The API sends one `funding` event
 * per donation or pledge write with the initiative's version number; the
 * first event after (re)connecting is the current version, so only a later,
 * different one refetches. EventSource reconnects on its own; a non-200
 * (e.g. the initiative vanished) ends it for good.
 */
export function useFundingEvents(slug: string, enabled: boolean) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!enabled || !slug || typeof EventSource === "undefined") return;
    const es = new EventSource(fundingEventsUrl(slug), { withCredentials: true });
    let last: string | null = null;
    const onFunding = (e: Event) => {
      const version = String((e as MessageEvent).data ?? "");
      if (last !== null && version !== last) {
        void qc.invalidateQueries({ queryKey: initiativeKey(slug) });
        void qc.invalidateQueries({ queryKey: boardKey });
      }
      last = version;
    };
    es.addEventListener("funding", onFunding);
    return () => {
      es.removeEventListener("funding", onFunding);
      es.close();
    };
  }, [slug, enabled, qc]);
}
