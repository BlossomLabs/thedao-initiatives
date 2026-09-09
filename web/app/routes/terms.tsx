import { useQuery } from "@tanstack/react-query";
import PageMain from "~/components/layout/PageMain";
import Markdown from "~/components/Markdown";
import { api } from "~/lib/api";
import type { DonationTerms } from "~/lib/api-types";
import { generateMeta } from "~/utils/meta";

export function meta() {
  return generateMeta({
    title: "Donation terms",
    description: "Terms of service for donations to TheDAO Security Fund initiatives.",
    url: "/donation-terms",
  });
}

export const termsKey = ["terms"] as const;

/** content/donation-terms.md, synced into the API. The donate widget links here. */
export default function TermsPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: termsKey,
    queryFn: () => api<DonationTerms>("/api/terms"),
    staleTime: 10 * 60_000,
  });
  return (
    <PageMain narrow detail className="terms-page min-h-[50vh]">
      {isLoading && <p className="text-muted">Loading…</p>}
      {error && (
        <p className="alert">The donation terms could not be loaded. Please try again shortly.</p>
      )}
      {data && (
        <>
          <p className="k mb-4">Terms version {data.version}</p>
          <Markdown text={data.body} className="terms-body" />
        </>
      )}
    </PageMain>
  );
}
