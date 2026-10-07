import SectionHeading from "~/components/layout/SectionHeading";
import type { InitiativeStatus } from "~/lib/api-types";

/**
 * The comments section of an initiative that is not public: it has no
 * comments to load, so the page says when they open instead of asking.
 */
export default function CommentsClosed({ status }: { status: InitiativeStatus }) {
  return (
    <section id="qa" className="mt-2">
      <SectionHeading>Comments</SectionHeading>
      <p className="text-muted">
        {status === "rejected"
          ? "This initiative was not published, so it has no comments."
          : "Comments open once this initiative is approved and published."}
      </p>
    </section>
  );
}
