/** Exact dollar text from micro-USD, with no rounding or unnecessary trailing zeros. */
export function formatMicroUsd(micro: bigint): string {
  const fraction = (micro % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return `$${(micro / 1_000_000n).toLocaleString("en-US")}${fraction ? `.${fraction}` : ""}`;
}
