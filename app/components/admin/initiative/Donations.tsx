import { useState } from "react";
import { Button } from "~/components/ui/Button";
import { Input } from "~/components/ui/Field";
import Identity from "~/components/wallet/Identity";
import { api } from "~/lib/api";
import type { AdminInitiativePage } from "~/lib/api-types";
import { dt, shortAddr, usd } from "~/lib/format";
import type { Run } from "./run";

export default function Donations(
  { page, base, run }: { page: AdminInitiativePage; base: string; run: Run },
) {
  const [tx, setTx] = useState("");
  const valid = /^0x[0-9a-fA-F]{64}$/.test(tx.trim());
  return (
    <>
      {page.donations.length > 0
        ? (
          <div className="tblbox mb-3.5">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Donor</th>
                  <th className="amt">USD</th>
                  <th>Token</th>
                  <th>Status</th>
                  <th>Detail</th>
                  <th>Tx</th>
                </tr>
              </thead>
              <tbody>
                {page.donations.map((d) => (
                  <tr key={d.txHash}>
                    <td className="whitespace-nowrap">{dt(d.confirmedAt ?? d.createdAt)}</td>
                    <td>
                      {d.donor
                        ? (
                          <Identity
                            address={d.donor}
                            size={18}
                            nameClassName="text-[12.5px] font-normal text-white"
                          />
                        )
                        : <span className="mono">—</span>}
                    </td>
                    <td className="amt">{usd(d.amountUsd)}</td>
                    <td>
                      {d.tokenSymbol}
                      {d.source === "safe-api" && <span className="dim">(indexer)</span>}
                    </td>
                    <td>
                      <span
                        className={`chip st-${
                          d.status === "confirmed"
                            ? "approved"
                            : d.status === "failed"
                            ? "rejected"
                            : "pending"
                        }`}
                      >
                        {d.status}
                      </span>
                    </td>
                    <td className="small dim">{d.detail}</td>
                    <td className="mono">
                      <a
                        href={`https://eth.blockscout.com/tx/${d.txHash}`}
                        target="_blank"
                        rel="noopener"
                      >
                        {shortAddr(d.txHash)}
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
        : (
          <p className="m-0 mb-3.5 small dim">
            No donations recorded yet. Transfers to the Safe are picked up by the indexer sync;
            paste a transaction hash below to check one right away.
          </p>
        )}
      <form
        className="panel"
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid) return;
          void run(
            () => api(`${base}/donations/recheck`, { json: { txHash: tx.trim().toLowerCase() } }),
            "Rechecked.",
          );
        }}
      >
        <span className="k">Check a transaction</span>
        <div className="flex flex-wrap items-center gap-2.5">
          <Input
            className="mono min-w-[280px] flex-1"
            placeholder="0x… transaction hash"
            value={tx}
            onChange={(e) => setTx(e.target.value)}
          />
          <Button type="submit" variant="ghost" disabled={!valid}>Recheck</Button>
        </div>
      </form>
    </>
  );
}
