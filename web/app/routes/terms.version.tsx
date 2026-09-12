import { Link, useParams } from "react-router";
import PageMain from "~/components/layout/PageMain";
import Markdown from "~/components/Markdown";
import { formatEffective, useTerms, useTermsVersion } from "~/hooks/use-terms";
import { generateMeta } from "~/utils/meta";

export function meta() {
  return generateMeta({
    title: "Donation terms, earlier version",
    description: "An earlier version of the donation terms for TheDAO Security Fund initiatives.",
    url: "/donation-terms",
  });
}

/** One published version of the donation terms, exactly as it was in force. */
export default function TermsVersionPage() {
  const { id } = useParams();
  const { data: v, isLoading } = useTermsVersion(id);
  const { data: current } = useTerms();
  return (
    <PageMain narrow detail className="terms-page min-h-[50vh]">
      <p className="mb-4 small">
        <Link to="/donation-terms" className="underline">Current donation terms</Link>
      </p>
      {v
        ? (
          <>
            <p className="k mb-1">
              {current && current.id === v.id ? "Effective" : "Was effective"}{" "}
              {formatEffective(v.effectiveDate)}
            </p>
            <p className="mb-4 small dim">
              Version <span className="mono">{v.id.slice(0, 12)}</span>
              {v.material ? ", published as a material change" : ""}
              {current && current.id !== v.id ? ". Superseded by the current version." : ""}
            </p>
            <Markdown text={v.text} className="terms-body" />
          </>
        )
        : <p className="small dim">{isLoading ? "Loading…" : "No such version."}</p>}
    </PageMain>
  );
}
