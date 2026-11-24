import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RotateCcw } from "lucide-react";
import { useAdminApi } from "~/hooks/use-admin-api";
import { sessionKey, useSession } from "~/context/session";
import { Button } from "~/components/ui/Button";
import Status, { type StatusKind } from "~/components/ui/Status";
import { When } from "~/components/vote/When";
import { api, errorMessage } from "~/lib/api";
import type { AiBudgetState } from "~/lib/api-types";

export const aiBudgetKey = ["admin", "ai-budget"] as const;

/** The next UTC midnight after `day` ("2026-11-24"), in unix seconds: when the caps start again. */
const nextDay = (day: string) => Date.parse(`${day}T00:00:00Z`) / 1000 + 86400;

/**
 * Today's AI calls against the daily caps, and a reset for the day an outage
 * (or a run of failing searches) used them up and search says it is resting.
 */
export default function AiBudget() {
  const adminApi = useAdminApi();
  const { session } = useSession();
  const qc = useQueryClient();
  const queryKey = [...aiBudgetKey, sessionKey(session)];
  const { data, error } = useQuery({
    queryKey,
    queryFn: ({ signal }) => api<AiBudgetState>("/api/admin/ai-budget", { signal }),
    enabled: Boolean(session?.isAdmin),
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: StatusKind; text: string } | null>(null);

  const reset = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const next = await adminApi<AiBudgetState>("/api/admin/ai-budget/reset", { json: {} });
      qc.setQueryData(queryKey, next);
      setMsg({ kind: "ok", text: "Today's AI caps are back in full. Search works again." });
    } catch (e) {
      setMsg({ kind: "err", text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  const full = data ? data.used >= data.cap : false;
  return (
    <section className="panel mt-4">
      <h2 className="k">AI calls today</h2>
      {error && <p className="alert mt-0">{errorMessage(error)}</p>}
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <p className="m-0 min-w-[240px] flex-1 small dim">
          {data
            ? (
              <>
                <span className={full ? "text-dao-red" : "text-white"}>
                  {data.used.toLocaleString("en-US")} of {data.cap.toLocaleString("en-US")}
                </span>{" "}
                calls used (support messages: {data.supportUsed} of {data.supportCap}).{" "}
                {full ? "Search is resting. " : ""}The count starts again at{" "}
                <When at={nextDay(data.day)} withDay={false} />.
              </>
            )
            : "Search, suggestions, comment screens and vote briefs share one daily cap."}
        </p>
        <Button
          className="w-[220px] max-[640px]:w-full"
          loading={busy}
          disabled={busy || !data || (data.used === 0 && data.supportUsed === 0)}
          onClick={() => void reset()}
        >
          <RotateCcw className="size-4" /> Reset AI caps
        </Button>
      </div>
      {msg && <Status kind={msg.kind} className="mt-4">{msg.text}</Status>}
    </section>
  );
}
