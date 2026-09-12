import { formatEffective, materialNoticeActive, type TermsVersionMeta } from "~/hooks/use-terms";

/**
 * Shown on the terms page and under the donate widget for 30 days after a
 * version flagged as a material change is published. Renders nothing otherwise.
 */
export default function TermsChangeNotice({
  terms,
  compact,
}: {
  terms: TermsVersionMeta | undefined;
  compact?: boolean;
}) {
  if (!materialNoticeActive(terms)) return null;
  const when = formatEffective(terms!.effectiveDate);
  if (compact) {
    return (
      <p className="m-0 small text-dao-amber" role="status">
        The donation terms changed on {when}.{" "}
        <a href="/donation-terms" className="underline">Read the current terms</a>.
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
