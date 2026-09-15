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
  return (
    <PageMain narrow detail className="terms-page min-h-[50vh]">
      {v ? <TermsDocument terms={v} versions={TERMS_VERSIONS} current={v.id === TERMS.id} /> : (
        <>
          <h1 className="h2">No such version</h1>
          <p className="small dim">
            <Link to="/donation-terms" className="underline">Read the current donation terms</Link>
          </p>
        </>
      )}
    </PageMain>
  );
}
