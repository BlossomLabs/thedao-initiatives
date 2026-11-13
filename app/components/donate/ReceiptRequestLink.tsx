import { useSiteSettings } from "~/hooks/use-site-settings";
import { openReceiptRequest } from "~/lib/support";

/** A receipt request starts with the donation's confirmed transaction already filled in. */
export default function ReceiptRequestLink({ txHash }: { txHash: string }) {
  const { data } = useSiteSettings();
  if (!data?.support) return null;
  return (
    <span className="mt-1 block">
      <button
        type="button"
        className="cursor-pointer underline underline-offset-2 hover:no-underline"
        onClick={() => openReceiptRequest(txHash)}
      >
        Need a receipt?
      </button>
    </span>
  );
}
