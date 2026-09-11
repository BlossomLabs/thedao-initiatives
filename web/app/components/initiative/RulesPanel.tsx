import Markdown from "~/components/Markdown";
import { RULES, rulesKindFor } from "~/data/rules";
import type { Initiative } from "~/lib/api-types";

/** The process rules for this initiative's kind, written by the site, not the submitter. */
export default function RulesPanel({ r }: { r: Pick<Initiative, "type" | "topup"> }) {
  const p = RULES[rulesKindFor(r)];
  return (
    <section
      id="rules"
      className="panel mt-8 mb-2 border-[rgba(92,183,90,.35)] shadow-[0_0_34px_rgba(92,183,90,.06)]"
    >
      <h2 className="m-0 mb-3 font-inter-tight text-[19px] font-semibold text-white">{p.title}</h2>
      <Markdown text={p.body} className="rules-body" />
      <p className="m-0 mt-3.5 small dim">
        Rules v{p.version}, shown on every initiative of this type.
      </p>
    </section>
  );
}
