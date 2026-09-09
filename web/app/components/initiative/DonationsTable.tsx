import SectionHeading from "~/components/layout/SectionHeading";
import Identity from "~/components/wallet/Identity";
import type { Donation } from "~/lib/api-types";
import { dt, shortAddr, usd } from "~/lib/format";

export default function DonationsTable({ donations }: { donations: Donation[] }) {
  return (
    <>
      <SectionHeading count={donations.length}>On-chain donations</SectionHeading>
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
