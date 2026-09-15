import { useEffect, useState } from "react";
import { Link } from "react-router";
import { formatEffectiveDate, materialNoticeActive, TERMS, type TermsVersion } from "~/data/terms";

/**
 * Notice of a material change to the donation terms, shown on the terms page
 * and under the donate widget for 30 days from the version's effective date.
 * Decided in an effect so the prerendered page never bakes the notice in.
 */
export default function TermsChangeNotice({
  terms = TERMS,
  compact,
  now,
}: {
  terms?: TermsVersion;
  compact?: boolean;
  /** Test hook; defaults to the wall clock. */
  now?: Date;
}) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    setShow(materialNoticeActive(terms, now ?? new Date()));
  }, [terms, now]);
  if (!show) return null;
  const when = formatEffectiveDate(terms.effectiveDate);
  if (compact) {
    return (
      <p className="m-0 small text-dao-amber" role="status">
        The donation terms changed on {when}.{" "}
        <Link to="/donation-terms" target="_blank" rel="noopener" className="underline">
          Review the changes
        </Link>.
      </p>
    );
  }
  return (
    <div
      className="mb-5 rounded-[12px] border border-dao-amber/40 bg-dao-amber/10 px-4 py-3 small"
      role="status"
    >
      <b>Notice of material change.</b> These donation terms changed on{" "}
      {when}. The version in force when you donate governs that donation; earlier versions are
      listed at the bottom of this page.
    </div>
  );
}
