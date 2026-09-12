import SectionHeading from "~/components/layout/SectionHeading";
import Identity from "~/components/wallet/Identity";
import type { Donation, LedgerStatus } from "~/lib/api-types";
import { ago, dt, shortAddr, usd } from "~/lib/format";

/** When the ledger was last filled from the Safe, and how long a new transfer can take to show. */
export function ledgerLine(l: LedgerStatus | null | undefined): string {
  if (!l) return "";
  const within = l.intervalMinutes
    ? ` New transfers appear here within about ${l.intervalMinutes} minutes.`
    : "";
  if (l.checkedAt === null) return "Not checked yet." + within;
  if (!l.ok) return `Last check ${ago(l.checkedAt)} failed; retrying.` + within;
  return `Checked ${ago(l.checkedAt)}.` + within;
}

export default function DonationsTable(
  { donations, ledger }: { donations: Donation[]; ledger?: LedgerStatus | null },
) {
  const line = ledgerLine(ledger);
  return (
    <>
      <SectionHeading count={donations.length}>On-chain donations</SectionHeading>
      {line && <p className="m-0 mb-2 small dim">{line}</p>}
      {donations.length
        ? (
          <div className="tblbox">
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
                  <tr key={d.txHash}>
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
                        href={`https://etherscan.io/tx/${d.txHash}`}
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
        : <p className="text-muted">No on-chain donations yet. Be the first.</p>}
    </>
  );
}
