/** The cells of one row in "Waiting for review": the whole comment and its
 * thread, what the AI screen said and why, and who wrote it. Enough to
 * publish or discard without leaving the dashboard (#88). */
import { useState } from "react";
import { Link } from "react-router";
import { Check, Copy, ExternalLink, TriangleAlert } from "lucide-react";
import { Button } from "~/components/ui/Button";
import { commentLinks } from "../../../shared/comment-links";
import type { AiScreen, HeldComment } from "~/lib/api-types";
import { dt, truncate, usd } from "~/lib/format";
import { cn } from "~/lib/utils";

/** Long comments open in place past this many characters. */
const FOLD = 600;

export const addressUrl = (address: string) => `https://etherscan.io/address/${address}`;

/** Where the comment shows once published: its thread, or the comments section. */
export const commentAnchor = (c: HeldComment) =>
  c.initiative ? `/initiative/${c.initiative.slug}#${c.parentId ? `qa-${c.parentId}` : "qa"}` : "";

export function HeldEntryCell({ c }: { c: HeldComment }) {
  const [open, setOpen] = useState(false);
  const long = c.body.length > FOLD;
  const links = commentLinks(c.body);
  const parent = c.context.parent;
  return (
    <td className="min-w-[260px]">
      <b>{c.parentId ? "Reply" : "Comment"}</b> on{" "}
      {c.initiative
        ? <Link to={`/initiative/${c.initiative.slug}`}>{c.initiative.title}</Link>
        : "?"}
      {c.reports > 0 && <>· {c.reports} report{c.reports === 1 ? "" : "s"}</>}
      <span className="text-[12px] text-muted">· {dt(c.createdAt)}</span>
      {parent && (
        <blockquote className="my-1.5 border-l-2 border-white/20 pl-2 text-[12px] text-muted">
          In reply to <b>{parent.displayName || "(no name)"}</b>
          {parent.status !== "published" && ` (${parent.status})`}:{" "}
          <span className="whitespace-pre-line [overflow-wrap:anywhere]">
            {truncate(parent.body, 240)}
          </span>
        </blockquote>
      )}
      {/* Plain text: a held comment's links are not clickable until published. */}
      <p
        className="my-1 whitespace-pre-line text-[13px] text-white/85 [overflow-wrap:anywhere]"
        data-testid="held-body"
      >
        {long && !open ? truncate(c.body, FOLD) : c.body}
      </p>
      {long && (
        <button
          type="button"
          className="text-[12px] text-muted underline"
          onClick={() => setOpen(!open)}
        >
          {open ? "Show less" : `Show all ${c.body.length} characters`}
        </button>
      )}
      {links.length > 0 && (
        <ul className="m-0 mt-1 list-none p-0 text-[12px]" aria-label="Links in the comment">
          {links.map((l) => (
            <li key={l.url} className={cn(!l.known && "text-dao-amber")}>
              {l.known
                ? "Link to "
                : <TriangleAlert className="mr-1 inline size-3.5" aria-hidden />}
              <b>{l.domain || "an address that does not parse"}</b>
              {!l.known && " · not the board, a code host or a known forum"}
            </li>
          ))}
        </ul>
      )}
      {c.initiative && (
        <p className="m-0 mt-1 text-[12px]">
          <Link to={commentAnchor(c)}>
            {c.parentId ? "Open the thread" : "Open the comments"}
          </Link>
        </p>
      )}
    </td>
  );
}

const VERDICT: Record<NonNullable<AiScreen["verdict"]>, string> = {
  constructive: "Constructive",
  unclear: "Unclear",
  spam: "Spam",
};

export function HeldScreenCell(
  { c, onRerun, busy }: { c: HeldComment; onRerun: () => void; busy: boolean },
) {
  const s = c.aiScreen;
  return (
    <td className="small min-w-[180px]">
      {s
        ? (
          <>
            <b className={cn(!s.verdict && "text-dao-amber")}>
              {s.verdict ? VERDICT[s.verdict] : "No answer"}
            </b>
            {c.aiSummary && s.verdict && <span className="dim">: {c.aiSummary}</span>}
            {s.nameFlag && s.nameFlag !== "ok" && (
              <span className="block text-dao-amber">Name flagged: {s.nameFlag}</span>
            )}
            <span className="block dim">
              {s.error ? `The screen failed: ${s.error}` : s.reason ? `Held: ${s.reason}` : ""}
            </span>
            <span className="block text-[11px] text-muted">Screened {dt(s.at)}</span>
          </>
        )
        : (
          <>
            <span className="dim">{c.aiSummary || "No AI summary"}</span>
            <span className="block text-[11px] text-muted">
              Screened before reasons were kept. Re-run to see why it was held.
            </span>
          </>
        )}
      <Button sm variant="ghost" className="mt-1" onClick={onRerun} disabled={busy}>
        {busy ? "Re-running…" : "Re-run AI screen"}
      </Button>
    </td>
  );
}

function CopyAddress({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="ml-1 align-middle text-muted"
      aria-label={copied ? "Address copied" : "Copy the address"}
      title={copied ? "Copied" : "Copy"}
      onClick={() =>
        navigator.clipboard?.writeText(address).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }).catch(() => {})}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </button>
  );
}

export function HeldWhoCell({ c }: { c: HeldComment }) {
  const a = c.context.author;
  const facts: string[] = [];
  if (a) {
    if (a.admin) facts.push("Admin");
    for (const p of a.proposerOf) {
      facts.push(
        p.here
          ? "Proposer of this initiative"
          : `Proposer of ${p.title}${p.status === "approved" ? "" : ` (${p.status})`}`,
      );
    }
    const here = a.backed.find((b) => b.here);
    const elsewhere = a.backed.filter((b) => !b.here);
    if (here) facts.push(`Backer: ${usd(here.usd)} to this initiative`);
    if (elsewhere.length) {
      facts.push(
        `Backer of ${elsewhere.length === 1 ? elsewhere[0].title : `${elsewhere.length} others`}: ${
          usd(elsewhere.reduce((s, b) => s + b.usd, 0))
        }`,
      );
    }
    facts.push(
      a.badge === null
        ? "ETHSecurity badge: lookup failed"
        : a.badge
        ? "ETHSecurity badge holder"
        : "No ETHSecurity badge",
    );
    const n = a.comments;
    facts.push(
      `Comments: ${n.published} published · ${n.held} held · ${n.discarded} discarded`,
    );
    facts.push(`First seen ${dt(a.firstSeen)}`);
  }
  return (
    <td className="small min-w-[200px]">
      {c.displayName || "(no name)"}
      {c.email && ` · ${c.email}`}
      {a
        ? (
          <>
            <span className="block font-mono text-[11px] [overflow-wrap:anywhere]">
              {a.address}
              <CopyAddress address={a.address} />
              <a
                href={addressUrl(a.address)}
                target="_blank"
                rel="noreferrer"
                className="ml-1 align-middle text-muted"
                aria-label="Open the address on Etherscan"
                title="Etherscan"
              >
                <ExternalLink className="inline size-3.5" />
              </a>
            </span>
            <ul className="m-0 mt-1 list-none p-0 text-[12px] text-white/75">
              {facts.map((f) => <li key={f}>{f}</li>)}
            </ul>
          </>
        )
        : <span className="block text-[12px] text-muted">No wallet: a name only</span>}
    </td>
  );
}
