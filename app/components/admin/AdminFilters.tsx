import { Select as SelectPrimitive } from "@base-ui/react/select";
import { ChevronDown, Search } from "lucide-react";
import { Select, SelectContent, SelectItem } from "~/components/ui/Select";
import TypeSelect from "~/components/board/filters/TypeSelect";
import StatusSelect from "~/components/board/filters/StatusSelect";
import CategoryFilter from "~/components/board/filters/CategoryFilter";
import { FILTER_PILL, FILTER_PILL_ON } from "~/components/board/filters/CategoryTrigger";
import {
  ADMIN_STATUSES,
  type AdminQuery,
  type AdminStatus,
  setQualifier,
  UNTAGGED,
} from "~/lib/admin-query";
import { cn } from "~/lib/utils";

const STATUS_LABELS: Record<AdminStatus, string> = {
  all: "Any status",
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  archived: "Archived",
};

// The status chips' colours, as dots.
const DOT: Record<AdminStatus, string> = {
  all: "border border-dashed border-white/50",
  pending: "bg-dao-amber",
  approved: "bg-dao-green",
  rejected: "bg-dao-red/70",
  archived: "bg-white/35",
};

const Dot = ({ status }: { status: AdminStatus }) => (
  <span className={cn("size-2 flex-none rounded-full", DOT[status])} aria-hidden="true" />
);

const ITEMS = (["all", ...ADMIN_STATUSES] as const).map((value) => ({
  value,
  label: STATUS_LABELS[value],
}));

/** The Status pill: pending, approved, rejected or archived, each with its live count. */
function AdminStatusSelect(
  { value, counts, onChange }: {
    value: AdminStatus;
    counts: Record<string, number>;
    onChange: (s: AdminStatus) => void;
  },
) {
  return (
    <Select value={value} items={ITEMS} onValueChange={(v) => v && onChange(v as AdminStatus)}>
      <SelectPrimitive.Trigger
        aria-label="Status"
        className={cn(FILTER_PILL, value !== "all" && FILTER_PILL_ON)}
      >
        <Dot status={value} />
        <span>
          {value === "all" ? "Status" : STATUS_LABELS[value]}{" "}
          <span className="tnum text-white/50">{counts[value] ?? 0}</span>
        </span>
        <ChevronDown className="size-3.5 text-white/45" aria-hidden="true" />
      </SelectPrimitive.Trigger>
      <SelectContent>
        {ITEMS.map((s) => (
          <SelectItem key={s.value} value={s.value}>
            <span className="flex items-center gap-2.5">
              <Dot status={s.value} />
              {s.label}
              <span className="tnum text-white/40">{counts[s.value] ?? 0}</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * The admin list's filters: one query box (`type:grant status:pending First
 * QA`) and the pills, which edit the same query. Unknown values are named
 * under the box and ignored.
 */
export default function AdminFilters(
  { q, query, problems, counts, onChange, aside }: {
    q: string;
    query: AdminQuery;
    problems: string[];
    counts: {
      type: { all: number; grant: number; rfp: number };
      status: Record<string, number>;
      cats: Record<string, number>;
    };
    onChange: (q: string) => void;
    /** The "N of M" count and the like, at the end of the pill row. */
    aside?: React.ReactNode;
  },
) {
  const untagged = query.cats.includes(UNTAGGED);
  return (
    <div className="mb-3 flex flex-col gap-2.5">
      <label className="relative block">
        <span className="sr-only">Search by project or contact</span>
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-white/40"
          aria-hidden="true"
        />
        <input
          type="search"
          className="field min-h-[38px] py-1.5 pl-9 font-mono text-[13px]"
          placeholder="Search project or contact, e.g. type:grant status:pending First QA"
          value={q}
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
          aria-describedby={problems.length ? "admin-query-problems" : undefined}
        />
      </label>
      {problems.length > 0 && (
        <p id="admin-query-problems" className="m-0 small text-dao-amber" role="status">
          {problems.join(" ")}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filters">
        <TypeSelect
          value={query.type}
          counts={counts.type}
          onChange={(t) => onChange(setQualifier(q, "type", t))}
        />
        <AdminStatusSelect
          value={query.status}
          counts={counts.status}
          onChange={(s) => onChange(setQualifier(q, "status", s))}
        />
        <CategoryFilter
          value={query.cats.filter((c) => c !== UNTAGGED)}
          counts={counts.cats}
          onChange={(cats) =>
            onChange(setQualifier(q, "cat", untagged ? [...cats, UNTAGGED] : cats))}
        />
        <StatusSelect
          value={query.funding}
          onChange={(f) => onChange(setQualifier(q, "funding", f))}
        />
        {aside && <span className="ml-auto">{aside}</span>}
      </div>
    </div>
  );
}
