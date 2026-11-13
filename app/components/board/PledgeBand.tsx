import { Mail, MessageSquare } from "lucide-react";
import { Button } from "~/components/ui/Button";
import { CONTACT_EMAIL, CONTACT_MAILTO } from "~/data/site";
import { openPledgeRequest } from "~/lib/support";

// Figma: 28px 32px band 46px below the grid, 18px title, 14px copy, 51px button with ↗.
export default function PledgeBand() {
  return (
    <div className="mt-[46px] flex flex-wrap items-center justify-between gap-[22px] rounded-2xl border border-white/[.09] bg-white/5 px-8 py-7">
      <div>
        <b className="font-inter-tight text-[18px] font-medium">Want to pledge support?</b>
        <p className="m-0 mt-2 max-w-[470px] font-inter-tight text-[14px] leading-[1.6] text-white/50">
          Backers pledge now and pay only when the work is fully funded, with their logo on the
          initiative from day one.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <a className="btn flex-none" href={CONTACT_MAILTO}>
          <Mail className="size-4 opacity-70" />
          Email <span className="text-dao-green">{CONTACT_EMAIL}</span> to pledge
        </a>
        <Button className="flex-none" onClick={() => openPledgeRequest()} aria-haspopup="dialog">
          <MessageSquare className="size-4 opacity-70" />
          Use support form
        </Button>
      </div>
    </div>
  );
}
