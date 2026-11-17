import { receiptTransactionError } from "@shared/support";

const RECEIPT_REQUEST = "thedao:receipt-request";
const PLEDGE_REQUEST = "thedao:pledge-request";

/** Opens the pledge form, on an initiative and with an amount (whole USD) when given. */
export function openPledgeRequest(initiativeId?: string, amountUsd?: number): void {
  globalThis.dispatchEvent(
    new CustomEvent(PLEDGE_REQUEST, {
      detail: { initiativeId: initiativeId ?? null, amountUsd: amountUsd ?? null },
    }),
  );
}

export function onPledgeRequest(
  open: (initiativeId: string | null, amountUsd: number | null) => void,
): () => void {
  const listener = (event: Event) => {
    const d = (event as CustomEvent).detail as
      | { initiativeId?: unknown; amountUsd?: unknown }
      | null;
    const amount = d?.amountUsd;
    open(
      typeof d?.initiativeId === "string" ? d.initiativeId : null,
      typeof amount === "number" && Number.isFinite(amount) && amount > 0 ? amount : null,
    );
  };
  globalThis.addEventListener(PLEDGE_REQUEST, listener);
  return () => globalThis.removeEventListener(PLEDGE_REQUEST, listener);
}

/** Open the shared Support panel for a confirmed donation without submitting a request. */
export function openReceiptRequest(txHash: string): void {
  globalThis.dispatchEvent(
    new CustomEvent(RECEIPT_REQUEST, {
      detail: `https://eth.blockscout.com/tx/${txHash}`,
    }),
  );
}

export function onReceiptRequest(open: (transactionUrl: string) => void): () => void {
  const listener = (event: Event) => {
    const url: unknown = (event as CustomEvent).detail;
    if (typeof url === "string" && !receiptTransactionError(url)) open(url);
  };
  globalThis.addEventListener(RECEIPT_REQUEST, listener);
  return () => globalThis.removeEventListener(RECEIPT_REQUEST, listener);
}
