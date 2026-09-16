import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useAccount } from "wagmi";
import { Check, Copy } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Crumbs from "~/components/layout/Crumbs";
import PageMain from "~/components/layout/PageMain";
import Shimmer from "~/components/layout/Shimmer";
import Skeleton from "~/components/ui/Skeleton";
import { Button } from "~/components/ui/Button";
import SpecularButton from "~/components/ui/SpecularButton";
import Identity from "~/components/wallet/Identity";
import InitiativeForm, { FormGrid } from "~/components/initiative-form/InitiativeForm";
import type { Draft } from "~/components/initiative-form/types";
import { useSession } from "~/context/session";
import { useProfileDialog } from "~/context/profile-dialog";
import { useIdentity } from "~/hooks/use-identity";
import { useSiteSettings } from "~/hooks/use-site-settings";
import { GUIDE_TEXT } from "~/data/guide";
import { rulesKindFor } from "~/data/rules";
import { WHAT_NEXT } from "~/data/what-next";
import { errorMessage } from "~/lib/api";
import { submitInitiative } from "~/lib/submit-initiative";
import { cn } from "~/lib/utils";
import { generateMeta } from "~/utils/meta";
import type { SubmittedState } from "./submitted";

export function meta() {
  return generateMeta({ title: "Suggest an initiative", url: "/submit" });
}

/**
 * The form is only reachable from a wallet that is connected and signed in
 * with Ethereum (one step from the top-bar button) and has a display name and
 * picture (ENS or set on the site). The proposer is recorded with the
 * initiative and shown on its page.
 */
/** The connected wallet, whether it is signed in, and whether its identity is complete. */
function useSubmitter() {
  const { isConnected, address, status } = useAccount();
  const { session, signIn, signingIn } = useSession();
  const identity = useIdentity(address);
  const signedIn = Boolean(
    session && address && session.address.toLowerCase() === address.toLowerCase(),
  );
  const complete = identity.hasName && identity.hasAvatar;
  return { isConnected, address, status, signIn, signingIn, identity, signedIn, complete };
}

function Gate({ children, aside }: { children: React.ReactNode; aside: React.ReactNode }) {
  const { isConnected, status, signIn, signingIn, identity, signedIn, complete } = useSubmitter();
  const { openProfile } = useProfileDialog();
  const [error, setError] = useState("");

  // wagmi starts a reload as "reconnecting" (and stays there while an injected
  // wallet drags its feet), and the identity lookups take a moment: a neutral
  // placeholder beats flashing through the steps. Give up waiting on the
  // reconnect after a moment so a stuck extension cannot hold the page.
  const [gaveUp, setGaveUp] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setGaveUp(true), 1500);
    return () => clearTimeout(t);
  }, []);
  const reconnecting = status === "reconnecting" && !isConnected && !gaveUp;
  if (reconnecting || (signedIn && identity.loading)) {
    return (
      <FormGrid
        aside={aside}
        main={
          <div className="panel mt-2 flex flex-col gap-3">
            <Skeleton className="h-5 w-72" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-2/3" />
          </div>
        }
      />
    );
  }

  if (signedIn && complete) return <>{children}</>;

  const step = !signedIn ? 0 : 1;
  const steps = [
    {
      label: "Connect your wallet and sign in",
      sub: "Use the Connect wallet button in the top right. One signature, no transaction, no gas.",
    },
    {
      label: "Set your name and picture",
      sub: "Shown with your initiative, ENS is used when set.",
    },
  ];
  return (
    <FormGrid
      aside={aside}
      main={
        <div className="panel mt-2 flex flex-col gap-3.5">
          <p className="m-0 font-inter-tight text-[15px] font-semibold">
            Initiatives are submitted from a wallet, so before you start:
          </p>
          <ol className="m-0 flex list-none flex-col gap-3 p-0">
            {steps.map((s, i) => (
              <li key={s.label} className="flex items-start gap-3">
                <span
                  className={cn(
                    "grid size-[26px] flex-none place-items-center rounded-full border font-inter-tight text-[13px] font-semibold",
                    i < step
                      ? "border-dao-green bg-dao-green text-[#0f1e2c]"
                      : i === step
                      ? "border-[rgba(92,183,90,.5)] bg-[rgba(92,183,90,.18)] text-[#7dd57e]"
                      : "border-white/15 text-muted",
                  )}
                >
                  {i < step ? <Check className="size-3.5" /> : i + 1}
                </span>
                <span>
                  <b
                    className={cn(
                      "block font-inter-tight text-[14px] font-semibold",
                      i > step && "text-muted",
                    )}
                  >
                    {s.label}
                  </b>
                  <small className="block text-[12.5px] leading-[1.5] text-muted">{s.sub}</small>
                </span>
              </li>
            ))}
          </ol>
          {step === 0 && isConnected && (
            <Button
              variant="primary"
              className="self-start"
              loading={signingIn}
              onClick={() => signIn().catch((e) => setError(errorMessage(e)))}
            >
              Sign in with {identity.name}
            </Button>
          )}
          {step === 1 && (
            <Button
              variant="primary"
              className="self-start"
              onClick={() => openProfile(true)}
            >
              {identity.hasName ? "Pick a picture" : "Set your name and picture"}
            </Button>
          )}
          {error && <p className="m-0 small text-[#ffd7d6]">{error}</p>}
        </div>
      }
    />
  );
}

const STEPS = [
  "Copy the guide",
  "Answer the questions the AI asks",
  "Paste the whole draft here, it fills the fields",
];

/** "Give this guide to your AI": the three steps and the copy button. Glows until the draft has text. */
function GuideCard({ glow }: { glow: boolean }) {
  const [copied, setCopied] = useState<"idle" | "done" | "fail">("idle");
  async function copyGuide() {
    try {
      await navigator.clipboard.writeText(GUIDE_TEXT);
      setCopied("done");
    } catch {
      setCopied("fail");
    }
    setTimeout(() => setCopied("idle"), 2500);
  }
  return (
    <div className={cn("panel border-[rgba(92,183,90,.35)]", glow && "glow-drift")}>
      <span className="k">Give this guide to your AI</span>
      <ol className="m-0 flex list-none flex-col gap-2.5 p-0">
        {STEPS.map((step, i) => (
          <li
            key={step}
            className="flex items-start gap-3 font-inter-tight text-[14px] leading-[1.5]"
          >
            <span className="grid size-[24px] flex-none place-items-center rounded-full border border-[rgba(92,183,90,.5)] bg-[rgba(92,183,90,.18)] font-inter-tight text-[12.5px] font-semibold text-[#7dd57e]">
              {i + 1}
            </span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
      <SpecularButton className="mt-4 w-full" onClick={copyGuide}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={copied}
            className="inline-flex items-center gap-1.5"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            {copied === "done"
              ? (
                <>
                  <Check className="size-4" />Copied
                </>
              )
              : copied === "fail"
              ? "Copy failed, open /llms.txt"
              : (
                <>
                  <Copy className="size-4" />Copy the guide
                </>
              )}
          </motion.span>
        </AnimatePresence>
      </SpecularButton>
    </div>
  );
}

export default function Submit() {
  const navigate = useNavigate();
  const { requireSession } = useSession();
  const submitter = useSubmitter();
  const settings = useSiteSettings();
  const uploads = settings.data?.uploads ?? true;

  async function onSubmit(_payload: unknown, draft: Draft) {
    await requireSession();
    const res = await submitInitiative(draft);
    const state: SubmittedState = {
      title: draft.page.title.trim(),
      slug: res.slug,
      kind: rulesKindFor({ type: draft.type, topup: draft.type === "grant" && draft.topup }),
      warnings: res.warnings,
    };
    navigate("/submit/thanks", { state });
  }

  return (
    <PageMain detail>
      <Crumbs items={[{ label: "Initiatives", to: "/" }]} />
      <h1 className="mb-3 mt-1.5 font-inter-tight text-[clamp(26px,4vw,40px)] font-medium leading-[1.12] tracking-[-.02em]">
        Suggest an initiative
      </h1>
      <p className="mt-3.5 max-w-[760px] font-inter-tight text-[15px] font-light leading-[1.65] text-muted">
        The strongest initiatives start as a forum post or a group chat where the idea gets
        discussed in public; link it here if you have one. Submissions are reviewed before they
        appear on the site.
      </p>
      <Shimmer soft />

      <Gate
        aside={
          <>
            <div className="max-[960px]:order-first">
              <GuideCard glow />
            </div>
            <div className="panel">
              <span className="k">What happens next</span>
              <p className="m-0 small dim">{WHAT_NEXT.rfp}</p>
            </div>
          </>
        }
      >
        <InitiativeForm
          mode="submit"
          onSubmit={onSubmit}
          submitLabel="Submit for review"
          uploads={uploads}
          asideTop={({ empty }) => <GuideCard glow={empty} />}
          footer={submitter.address && (
            <p className="m-0 mt-3.5 flex flex-wrap items-center justify-center gap-2 text-[13.5px] text-muted">
              Submitting as <Identity address={submitter.address} size={20} />
            </p>
          )}
        />
      </Gate>
    </PageMain>
  );
}
