import { Link } from "react-router";
import Markdown from "~/components/Markdown";
import TermsChangeNotice from "~/components/terms/TermsChangeNotice";
import { formatEffectiveDate, shortTermsId, type TermsVersion } from "~/data/terms";

/**
 * One version of the donation terms with its effective date, id, the material
 * change notice (current version only) and the list of earlier versions.
 */
export default function TermsDocument({
  terms,
  versions,
  current,
}: {
  terms: TermsVersion;
  versions: readonly TermsVersion[];
  current: boolean;
}) {
  const previous = versions.filter((v) => v.effectiveDate < terms.effectiveDate);
  return (
    <>
      <p className="k mb-1">
        {current ? "Effective" : "Was effective"} {formatEffectiveDate(terms.effectiveDate)}
      </p>
      <p className="mb-4 small dim">
        Version <span className="mono" title={terms.id}>{shortTermsId(terms.id)}</span>
        {terms.material ? ", a material change" : ""}
        {current ? "" : (
          <>
            . Superseded:{" "}
            <Link to="/donation-terms" className="underline">read the current terms</Link>
          </>
        )}
      </p>
      {current && <TermsChangeNotice terms={terms} />}
      <Markdown text={terms.body} className="terms-body" />
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
                    Effective {formatEffectiveDate(v.effectiveDate)}
                  </Link>
                  {v.material && <span className="ml-2 dim">material change</span>}
                  <span className="ml-2 mono dim" title={v.id}>{shortTermsId(v.id)}</span>
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
    </>
  );
}
