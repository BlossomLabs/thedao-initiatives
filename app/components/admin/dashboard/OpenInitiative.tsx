import { useId, useMemo, useState } from "react";
import { Link } from "react-router";
import { StatusChip } from "~/components/ui/Badge";
import { Input } from "~/components/ui/Field";
import type { AdminTodo } from "~/lib/api-types";
import { recentInitiatives } from "~/lib/admin-recent";
import { dayTime } from "~/lib/format";

const MAX = 8;

/** Search every initiative by title and jump to its admin page; below it, the ones opened lately. */
export default function OpenInitiative({ index }: { index: AdminTodo["index"] }) {
  const [q, setQ] = useState("");
  const id = useId();
  const recent = useMemo(() => recentInitiatives(), []);
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const hits = words.length
    ? index.filter((x) => words.every((w) => x.title.toLowerCase().includes(w))).slice(0, MAX)
    : [];
  const row =
    "block border-b border-white/[.07] py-2 text-[13.5px] text-white no-underline last:border-0 hover:text-dao-green";
  return (
    <section
      aria-labelledby={`${id}-h`}
      className="flex flex-col gap-2.5 rounded-2xl border border-edge bg-card p-4"
    >
      <h2 id={`${id}-h`} className="m-0 font-inter-tight text-[15px] font-semibold">
        Open an initiative
      </h2>
      <label htmlFor={id} className="sr-only">Search initiatives by title</label>
      <Input
        id={id}
        type="search"
        placeholder="Search by title"
        autoComplete="off"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {words.length > 0
        ? (
          <nav aria-label="Matching initiatives">
            {hits.length
              ? hits.map((x) => (
                <Link
                  key={x.id}
                  className={`${row} flex items-center gap-2`}
                  to={`/admin/initiatives/${x.slug}`}
                >
                  <span className="min-w-0 flex-1 truncate">{x.title}</span>
                  {x.status !== "approved" && <StatusChip status={x.status} />}
                </Link>
              ))
              : <p className="m-0 small dim">No initiative has that in its title.</p>}
          </nav>
        )
        : recent.length > 0 && (
          <nav aria-label="Opened lately">
            {recent.map((x) => (
              <Link key={x.slug} className={row} to={`/admin/initiatives/${x.slug}`}>
                {x.title} <span className="small dim">· opened {dayTime(x.at)}</span>
              </Link>
            ))}
          </nav>
        )}
    </section>
  );
}
