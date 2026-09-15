import PageMain from "~/components/layout/PageMain";
import TermsDocument from "~/components/terms/TermsDocument";
import { TERMS, TERMS_VERSIONS } from "~/data/terms";
import { generateMeta } from "~/utils/meta";

export function meta() {
  return generateMeta({
    title: "Donation terms",
    description: "Terms of service for donations to TheDAO Security Fund initiatives.",
    url: "/donation-terms",
  });
}

/**
 * The donation terms in force: the latest content/donation-terms/<date>.md,
 * bundled at build time and prerendered, with every earlier version linked.
 * The donate widget and the footer link here.
 */
export default function TermsPage() {
  return (
    <PageMain narrow detail className="terms-page min-h-[50vh]">
      <TermsDocument terms={TERMS} versions={TERMS_VERSIONS} current />
    </PageMain>
  );
}
