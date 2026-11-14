import { useId, useState } from "react";
import { PledgeForm } from "~/components/admin/initiative/Pledges";
import { Input } from "~/components/ui/Field";
import type { AdminTodo } from "~/lib/api-types";
import { useRun } from "./run";

const MAX = 6;

/** Add a pledge without opening the initiative: pick it by title, then the usual pledge form. */
export default function QuickPledge({ index }: { index: AdminTodo["index"] }) {
  const id = useId();
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<AdminTodo["index"][number] | null>(null);
  const { run, said, setMsg } = useRun();
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  // Pledges are for approved initiatives first; the rest still match a search.
  const ordered = [...index].sort((a, b) =>
    Number(b.status === "approved") - Number(a.status === "approved")
  );
  const hits = words.length
    ? ordered.filter((x) => words.every((w) => x.title.toLowerCase().includes(w))).slice(0, MAX)
    : [];
  return (
    <section
      aria-labelledby={`${id}-h`}
      className="flex flex-col gap-2.5 rounded-2xl border border-edge bg-card p-4"
    >
      <h2 id={`${id}-h`} className="m-0 font-inter-tight text-[15px] font-semibold">
        Record a pledge
      </h2>
      {picked
        ? (
          <>
            <p className="m-0 flex flex-wrap items-center gap-2 text-[13.5px]">
              <span className="dim">To</span> <b className="font-medium">{picked.title}</b>
              <button
                type="button"
                className="cursor-pointer border-0 bg-transparent p-0 small text-white/80 underline decoration-white/25 underline-offset-2 hover:text-white"
                onClick={() => {
                  setPicked(null);
                  setMsg(null);
                }}
              >
                Change
              </button>
            </p>
            <PledgeForm
              key={picked.id}
              base={`/api/admin/initiatives/${picked.id}`}
              run={(fn, ok) => run(fn, typeof ok === "string" ? `${ok} (${picked.title})` : ok)}
              editing={null}
              onDone={() => {}}
              stacked
            />
          </>
        )
        : (
          <>
            <label htmlFor={id} className="small">Initiative</label>
            <Input
              id={id}
              type="search"
              placeholder="Search by title"
              autoComplete="off"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            {words.length > 0 && (
              <ul className="m-0 list-none p-0" aria-label="Pick the initiative">
                {hits.length
                  ? hits.map((x) => (
                    <li key={x.id}>
                      <button
                        type="button"
                        className="block w-full cursor-pointer border-0 border-b border-solid border-white/[.07] bg-transparent py-2 text-left text-[13.5px] text-white last:border-0 hover:text-dao-green"
                        onClick={() => {
                          setPicked(x);
                          setQ("");
                        }}
                      >
                        {x.title}
                        {x.status !== "approved" && (
                          <span className="small dim">{` · ${x.status}`}</span>
                        )}
                      </button>
                    </li>
                  ))
                  : <li className="small dim">No initiative has that in its title.</li>}
              </ul>
            )}
          </>
        )}
      {said}
    </section>
  );
}
