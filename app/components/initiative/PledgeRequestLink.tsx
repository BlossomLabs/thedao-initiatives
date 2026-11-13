import { useSiteSettings } from "~/hooks/use-site-settings";
import { openPledgeRequest } from "~/lib/support";

export default function PledgeRequestLink({ initiativeId }: { initiativeId: string }) {
  const { data } = useSiteSettings();
  if (!data?.support) return null;
  return (
    <>
      {" or use the "}
      <button
        type="button"
        onClick={() => openPledgeRequest(initiativeId)}
        aria-haspopup="dialog"
        className="cursor-pointer text-dao-green"
      >
        support form
      </button>
    </>
  );
}
