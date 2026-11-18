import { useId, useMemo, useState } from "react";
import { PledgeForm } from "~/components/admin/initiative/Pledges";
import { StatusChip } from "~/components/ui/Badge";
import InitiativeCombobox from "~/components/ui/InitiativeCombobox";
import type { AdminTodo } from "~/lib/api-types";
import { useRun } from "./run";

type Item = AdminTodo["index"][number];

/** Add a pledge without opening the initiative: pick it by name, then the usual pledge form. */
export default function QuickPledge({ index }: { index: AdminTodo["index"] }) {
  const id = useId();
  const [picked, setPicked] = useState<Item | null>(null);
  const [search, setSearch] = useState("");
  const { run, said, setMsg } = useRun();
  // Approved initiatives first: pledges are for them; the rest still match a search.
  const items = useMemo(
    () =>
      [...index].sort((a, b) =>
        Number(b.status === "approved") - Number(a.status === "approved") ||
        a.title.localeCompare(b.title)
      ),
    [index],
  );
  return (
    <section
      aria-labelledby={`${id}-h`}
      className="flex flex-col gap-2.5 rounded-2xl border border-edge bg-card p-4"
    >
      <h2 id={`${id}-h`} className="m-0 font-inter-tight text-[15px] font-semibold">
        Record a pledge
      </h2>
      <label htmlFor={id} className="text-[12.5px] text-white/80">Initiative</label>
      <InitiativeCombobox<Item>
        id={id}
        items={items}
        value={picked}
        onValueChange={(x) => {
          setPicked(x);
          setMsg(null);
        }}
        inputValue={search}
        onInputValueChange={setSearch}
        popupZ="z-50"
        itemExtra={(x) => x.status !== "approved" && <StatusChip status={x.status} />}
      />
      {picked && search === picked.title && (
        <PledgeForm
          key={picked.id}
          slug={picked.slug}
          base={`/api/admin/initiatives/${picked.id}`}
          run={(fn, ok) => run(fn, typeof ok === "string" ? `${ok} (${picked.title})` : ok)}
          editing={null}
          onDone={() => {}}
          stacked
        />
      )}
      {said}
    </section>
  );
}
