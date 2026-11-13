import { receiptTransactionError } from "@shared/support";

const RECEIPT_REQUEST = "thedao:receipt-request";
const PLEDGE_REQUEST = "thedao:pledge-request";

export function openPledgeRequest(initiativeId?: string): void {
  globalThis.dispatchEvent(new CustomEvent(PLEDGE_REQUEST, { detail: initiativeId ?? null }));
}

export function onPledgeRequest(open: (initiativeId: string | null) => void): () => void {
  const listener = (event: Event) => {
    const initiativeId: unknown = (event as CustomEvent).detail;
    open(typeof initiativeId === "string" ? initiativeId : null);
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
