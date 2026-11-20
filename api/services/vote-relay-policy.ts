/** Sponsorship limits, not ballot validity limits: voters can always pay for their own
 * transaction. Ten million gas leaves room above the heaviest mainnet ballots so far
 * (2.65M used, 3.2M padded) and an ordinary smart-wallet signature, well under the
 * protocol's 16.7M per-transaction cap. A transaction can spend at most 0.02 ETH
 * (a 3.2M-gas ballot up to about 6 gwei). */
export const BALLOT_RELAY_GAS = 10_000_000n;
export const CONTRACT_SIGNATURE_GAS = 500_000n;
export const BALLOT_RELAY_FEE = 20_000_000_000n; // 20 gwei
export const BALLOT_RELAY_COST = 20_000_000_000_000_000n; // 0.02 ETH

export class RelayBudgetError extends Error {
  constructor(readonly reason: "signature" | "gas" | "fee" | "cost") {
    super(`Ballot relay ${reason} budget exceeded`);
    this.name = "RelayBudgetError";
  }
}

/** Pin every cost-bearing field before signing. A later RPC estimate or a wallet's
 * state-dependent signature cannot raise the amount the sponsor authorizes. */
export function ballotRelayBudget(
  estimate: bigint,
  fees: { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint },
) {
  if (estimate <= 0n || estimate > BALLOT_RELAY_GAS) throw new RelayBudgetError("gas");
  const padded = (estimate * 120n + 99n) / 100n;
  const gas = padded > BALLOT_RELAY_GAS ? BALLOT_RELAY_GAS : padded;
  const { maxFeePerGas, maxPriorityFeePerGas } = fees;
  if (
    maxFeePerGas <= 0n || maxFeePerGas > BALLOT_RELAY_FEE || maxPriorityFeePerGas < 0n ||
    maxPriorityFeePerGas > maxFeePerGas
  ) throw new RelayBudgetError("fee");
  if (gas * maxFeePerGas > BALLOT_RELAY_COST) throw new RelayBudgetError("cost");
  return { gas, maxFeePerGas, maxPriorityFeePerGas };
}
