import { Link, useParams } from "react-router";
import PageMain from "~/components/layout/PageMain";
import TermsDocument from "~/components/terms/TermsDocument";
import { TERMS, TERMS_VERSIONS, termsById } from "~/data/terms";
import { generateMeta } from "~/utils/meta";

export function meta({ params }: { params: { id?: string } }) {
  return generateMeta({
    title: "Donation terms, earlier version",
    description: "An earlier version of the donation terms for TheDAO Security Fund initiatives.",
    url: "/donation-terms/v/" + (params.id ?? ""),
  });
}

const ID_RE = /^[0-9a-f]{64}$/;

/** One published version of the donation terms, exactly as it was in force. Not prerendered. */
export default function TermsVersionPage() {
  const { id } = useParams();
  const v = id && ID_RE.test(id) ? termsById(id) : undefined;
  // Same shape as the other not-found pages, not a stray heading in the terms column.
  if (!v) {
    return (
      <PageMain detail center className="min-h-[50vh]">
        <h1 className="font-inter-tight text-[40px] font-medium tracking-[-.02em]">
          No such version
        </h1>
        <p className="text-muted">There is no version of the donation terms at this address.</p>
        <Link className="btn mt-4" to="/donation-terms">Read the current donation terms</Link>
      </PageMain>
    );
  }
  return (
    <PageMain narrow detail className="terms-page min-h-[50vh]">
      <TermsDocument terms={v} versions={TERMS_VERSIONS} current={v.id === TERMS.id} />
    </PageMain>
  );
}
