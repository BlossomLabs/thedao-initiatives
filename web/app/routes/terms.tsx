import PageMain from "~/components/layout/PageMain";
import Markdown from "~/components/Markdown";
import { TERMS } from "~/data/terms";
import { generateMeta } from "~/utils/meta";

export function meta() {
  return generateMeta({
    title: "Donation terms",
    description: "Terms of service for donations to TheDAO Security Fund initiatives.",
    url: "/donation-terms",
  });
}

/** content/donation-terms.md, bundled at build time and prerendered. The donate widget links here. */
export default function TermsPage() {
  return (
    <PageMain narrow detail className="terms-page min-h-[50vh]">
      <p className="k mb-4">Terms version {TERMS.version}</p>
      <Markdown text={TERMS.body} className="terms-body" />
    </PageMain>
  );
}
