import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import Status from "~/components/ui/Status";
import type { Msg, Run } from "~/components/admin/initiative/run";
import { errorMessage } from "~/lib/api";

/**
 * A `Run` whose answer shows where it was asked (a row, a form), and that
 * refreshes every admin query on success: the to-do list, the table and any
 * initiative page in the cache.
 */
export function useRun() {
  const qc = useQueryClient();
  const [msg, setMsg] = useState<Msg>(null);
  const run: Run = async (fn, ok) => {
    setMsg(null);
    try {
      const result = await fn();
      const text = typeof ok === "function" ? ok(result) : ok;
      if (text) setMsg({ kind: "ok", text });
      void qc.invalidateQueries({ queryKey: ["admin"] });
      return true;
    } catch (e) {
      setMsg({ kind: "err", text: errorMessage(e) });
      return false;
    }
  };
  const said = msg && <Status kind={msg.kind} className="mt-2.5">{msg.text}</Status>;
  return { run, said, setMsg };
}
