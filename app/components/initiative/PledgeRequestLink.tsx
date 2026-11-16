import { Button } from "~/components/ui/Button";
import { useSiteSettings } from "~/hooks/use-site-settings";
import { openPledgeRequest } from "~/lib/support";

/** The red Pledge button of an initiative page: opens the pledge form for this initiative. */
export default function PledgeRequestLink({ initiativeId }: { initiativeId: string }) {
  const { data } = useSiteSettings();
  if (!data?.support) return null;
  return (
    <Button
      variant="primary"
      className="mt-3 w-full"
      onClick={() => openPledgeRequest(initiativeId)}
      aria-haspopup="dialog"
    >
      Pledge
    </Button>
  );
}
