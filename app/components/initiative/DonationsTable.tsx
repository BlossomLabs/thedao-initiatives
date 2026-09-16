import SectionHeading from "~/components/layout/SectionHeading";
import Identity from "~/components/wallet/Identity";
import type { Donation, LedgerStatus } from "~/lib/api-types";
import { ago, dt, shortAddr, usd } from "~/lib/format";
import { LoaderCircle } from "lucide-react";

/** Last saved check; refreshes are driven by visitors rather than a schedule. */
export function ledgerLine(l: LedgerStatus | null | undefined): string {
  if (!l) return "";
  const within = l.intervalMinutes
    ? ` Refreshes when viewed after ${l.intervalMinutes} minutes.`
    : "";
  if (l.checkedAt === null) return "Not checked yet." + within;
  if (!l.ok) return `Last check ${ago(l.checkedAt)} failed. Showing saved donations; will retry.`;
  return `Checked ${ago(l.checkedAt)}.` + within;
}

export default function DonationsTable(
  { donations, ledger, updating = false }: {
    donations: Donation[];
    ledger?: LedgerStatus | null;
    updating?: boolean;
  },
) {
  const line = ledgerLine(ledger);
  return (
    <>
      <SectionHeading count={donations.length}>On-chain donations</SectionHeading>
      {updating && (
        <p className="m-0 mb-2 flex items-center gap-2 small dim" role="status">
          <LoaderCircle className="size-3.5 motion-safe:animate-spin" aria-hidden="true" />
          Updating donations…
        </p>
      )}
      {line && <p className="m-0 mb-2 small dim">{line}</p>}
      {donations.length
        ? (
          <div className="tblbox" aria-busy={updating}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Donor</th>
                  <th className="amt">Amount</th>
                  <th>Token</th>
                  <th>Tx</th>
                </tr>
              </thead>
              <tbody>
                {donations.map((d) => (
                  <tr
                    key={d.txHash}
                    className="motion-safe:animate-in motion-safe:fade-in duration-500"
                  >
                    <td>{dt(d.confirmedAt)}</td>
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
                    <td>{d.tokenSymbol}</td>
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
          <p className="text-muted">
            {ledger && ledger.checkedAt === null
              ? "No saved donations yet."
              : "No on-chain donations yet. Be the first."}
          </p>
        )}
    </>
  );
}
