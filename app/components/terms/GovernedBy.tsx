import { Link } from "react-router";
import { cn } from "~/lib/utils";

/**
 * The one line that accompanies every display or copy of an initiative's Safe
 * address: direct transfers are donations under the same terms as the widget.
 */
export default function GovernedBy(
  { inline, className }: { inline?: boolean; className?: string },
) {
  const text = (
    <>
      Transfers to this address are governed by the{" "}
      <Link to="/donation-terms" target="_blank" rel="noopener" className="underline">
        Donation Terms
      </Link>.
    </>
  );
  return inline
    ? <span className={className}>{text}</span>
    : <p className={cn("m-0 small dim", className)}>{text}</p>;
}
