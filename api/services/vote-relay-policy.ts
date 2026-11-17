/** Sponsorship limits, not ballot validity limits: voters can always pay for their own
 * transaction. Four million gas leaves room above the 80-project contract gas test and
 * an ordinary smart-wallet signature. A transaction can spend at most 0.005 ETH. */
export const BALLOT_RELAY_GAS = 4_000_000n;
export const CONTRACT_SIGNATURE_GAS = 500_000n;
export const BALLOT_RELAY_FEE = 20_000_000_000n; // 20 gwei
export const BALLOT_RELAY_COST = 5_000_000_000_000_000n; // 0.005 ETH

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
