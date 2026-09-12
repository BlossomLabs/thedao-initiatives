import { Link } from "react-router";
import PageMain from "~/components/layout/PageMain";
import Markdown from "~/components/Markdown";
import TermsChangeNotice from "~/components/TermsChangeNotice";
import { BUNDLED_TERMS, formatEffective, useTerms, useTermsVersions } from "~/hooks/use-terms";
import { generateMeta } from "~/utils/meta";

export function meta() {
  return generateMeta({
    title: "Donation terms",
    description: "Terms of service for donations to TheDAO Security Fund initiatives.",
    url: "/donation-terms",
  });
}

/**
 * The donation terms in force: the API's current published version, with the
 * bundled content/donation-terms.md as the prerendered fallback. Every earlier
 * version stays reachable from the list at the bottom.
 */
export default function TermsPage() {
  const { data } = useTerms();
  const terms = data ?? BUNDLED_TERMS;
  const { data: list } = useTermsVersions();
  const previous = (list?.versions ?? []).filter((v) => v.id !== terms.id);
  return (
    <PageMain narrow detail className="terms-page min-h-[50vh]">
      <p className="k mb-1">Effective {formatEffective(terms.effectiveDate)}</p>
      <p className="mb-4 small dim">
        Version <span className="mono">{terms.id.slice(0, 12)}</span>
        {terms.fromBundle ? "" : ", published " +
          new Date(terms.publishedAt! * 1000).toLocaleDateString("en-US", {
            year: "numeric",
            month: "long",
            day: "numeric",
            timeZone: "UTC",
          })}
      </p>
      <TermsChangeNotice terms={terms} />
      <Markdown text={terms.text} className="terms-body" />
      <section
        className="mt-10 border-t border-white/[.08] pt-6"
        aria-labelledby="previous-versions"
      >
        <h2 id="previous-versions" className="h3 mb-2">Previous versions</h2>
        {previous.length
          ? (
            <ul className="m-0 list-none p-0">
              {previous.map((v) => (
                <li key={v.id} className="my-1.5 small">
                  <Link to={`/donation-terms/v/${v.id}`} className="underline">
                    Effective {formatEffective(v.effectiveDate)}
                  </Link>
                  {v.material && <span className="ml-2 dim">material change</span>}
                  <span className="ml-2 mono dim">{v.id.slice(0, 12)}</span>
                </li>
              ))}
            </ul>
          )
          : (
            <p className="m-0 small dim">
              No earlier versions. The version in force when you donate governs that donation.
            </p>
          )}
      </section>
    </PageMain>
  );
}
