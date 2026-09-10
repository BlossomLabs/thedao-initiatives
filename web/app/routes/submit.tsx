import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useAccount } from "wagmi";
import { Check, Copy, Send } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Crumbs from "~/components/layout/Crumbs";
import PageMain from "~/components/layout/PageMain";
import Shimmer from "~/components/layout/Shimmer";
import Skeleton from "~/components/ui/Skeleton";
import { Field, Input, Textarea } from "~/components/ui/Field";
import { Button } from "~/components/ui/Button";
import SpecularButton from "~/components/ui/SpecularButton";
import Identity from "~/components/wallet/Identity";
import { useSession } from "~/context/session";
import { useProfileDialog } from "~/context/profile-dialog";
import { useIdentity } from "~/hooks/use-identity";
import { api, errorMessage } from "~/lib/api";
import { cn } from "~/lib/utils";
import { generateMeta } from "~/utils/meta";

export function meta() {
  return generateMeta({ title: "Suggest an initiative", url: "/submit" });
}

type Type = "rfp" | "grant";

const TYPES: { id: Type; label: string; sub: string }[] = [
  { id: "rfp", label: "RFP", sub: "An open request: any qualified team can bid to do the work." },
  { id: "grant", label: "Grant", sub: "Your team presents the idea and does the work." },
];

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

function Gate({ children }: { children: React.ReactNode }) {
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
      <div className="panel mt-2 flex flex-col gap-3">
        <Skeleton className="h-5 w-72" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-2/3" />
      </div>
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
  );
}

export default function Submit() {
  const navigate = useNavigate();
  const { requireSession } = useSession();
  const submitter = useSubmitter();
  const [f, setF] = useState({
    title: "",
    type: "rfp" as Type,
    summary: "",
    details: "",
    discourseUrl: "",
    goal: "",
    funders: "",
    contact: "",
    website: "",
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<"idle" | "done" | "fail">("idle");
  const set =
    (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setF((s) => ({ ...s, [k]: e.target.value }));

  async function copyGuide() {
    try {
      const text = await (await fetch("/llms.txt")).text();
      await navigator.clipboard.writeText(text);
      setCopied("done");
    } catch {
      setCopied("fail");
    }
    setTimeout(() => setCopied("idle"), 2500);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await requireSession();
      await api<{ slug: string }>("/api/initiatives", { json: f });
      navigate("/submit/thanks", { state: { title: f.title } });
    } catch (err) {
      setError(errorMessage(err));
      globalThis.scrollTo({ top: 0, behavior: "smooth" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageMain detail>
      <Crumbs items={[{ label: "Initiatives", to: "/" }]} />
      <h1 className="mb-3 mt-1.5 font-inter-tight text-[clamp(26px,4vw,40px)] font-medium leading-[1.12] tracking-[-.02em]">
        Suggest an initiative
      </h1>
      <p className="mt-3.5 max-w-[760px] font-inter-tight text-[15px] font-light leading-[1.65] text-muted">
        The strongest initiatives start as a forum post where the idea gets discussed in public;
        link it here if you have one. Submissions are reviewed before they appear on the site.
      </p>
      <Shimmer soft />

      <div className="mt-4 grid grid-cols-[1fr_340px] items-start gap-9 max-[960px]:grid-cols-1">
        <div>
          <Gate>
            {error && <div className="alert" role="alert">{error}</div>}

            <form className="flex flex-col" onSubmit={submit} noValidate>
              <input
                type="text"
                name="website"
                value={f.website}
                onChange={set("website")}
                className="hp"
                tabIndex={-1}
                autoComplete="off"
                aria-hidden="true"
              />

              <Field
                label="Title"
                htmlFor="f-title"
                hint="Or leave blank and we pull it from the forum link."
                className="mt-0"
              >
                <Input id="f-title" maxLength={140} value={f.title} onChange={set("title")} />
              </Field>

              <div className="mt-[18px]">
                <span className="label">Type *</span>
                <div className="mt-1.5 flex flex-wrap gap-2.5">
                  {TYPES.map((t) => (
                    <label
                      key={t.id}
                      className={cn(
                        "flex min-w-[220px] flex-1 cursor-pointer items-start gap-2.5 rounded-xl border border-white/15 bg-white/5 px-3.5 py-3 transition-colors duration-150 hover:border-[rgba(92,183,90,.45)]",
                        f.type === t.id && "border-dao-green shadow-[0_0_14px_rgba(92,183,90,.12)]",
                      )}
                    >
                      <input
                        type="radio"
                        name="type"
                        value={t.id}
                        checked={f.type === t.id}
                        onChange={() => setF((s) => ({ ...s, type: t.id }))}
                        className="mt-[3px]"
                      />
                      <span>
                        <b
                          className={cn(
                            "block font-inter-tight text-[13.5px] font-semibold",
                            f.type === t.id && "text-dao-green",
                          )}
                        >
                          {t.label}
                        </b>
                        <small className="mt-0.5 block text-[12px] leading-[1.5] text-muted">
                          {t.sub}
                        </small>
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              <Field
                label="Short summary"
                htmlFor="f-summary"
                required
                hint="2 to 4 sentences: what gets built, why it matters."
              >
                <Textarea
                  id="f-summary"
                  className="min-h-[104px]"
                  rows={4}
                  maxLength={4000}
                  value={f.summary}
                  onChange={set("summary")}
                  required
                />
              </Field>

              <Field
                label="Full initiative details"
                htmlFor="f-details"
                hint="Optional: scope, milestones, budget breakdown. Markdown supported: headings, **bold**, lists, tables, - [ ] checklists."
              >
                <Textarea
                  id="f-details"
                  className="min-h-[192px]"
                  rows={8}
                  maxLength={20000}
                  value={f.details}
                  onChange={set("details")}
                />
              </Field>

              <Field
                label="Forum link"
                htmlFor="f-forum"
                hint="Optional Discourse topic where this initiative is discussed."
              >
                <Input
                  id="f-forum"
                  type="url"
                  placeholder="https://forum.example.org/t/my-initiative/123"
                  value={f.discourseUrl}
                  onChange={set("discourseUrl")}
                />
              </Field>

              <Field label="Funding goal (USD)" htmlFor="f-goal" required>
                <Input
                  id="f-goal"
                  inputMode="decimal"
                  placeholder="250000"
                  value={f.goal}
                  onChange={set("goal")}
                  required
                />
              </Field>

              <Field label="Who is likely to fund this?" htmlFor="f-funders" required privateField>
                <Textarea
                  id="f-funders"
                  rows={4}
                  maxLength={4000}
                  placeholder="Ethereum Foundation | funds public-goods security tooling | met once | warm intro? yes | $50,000"
                  value={f.funders}
                  onChange={set("funders")}
                  required
                />
              </Field>

              <Field
                label="Contact"
                htmlFor="f-contact"
                privateField
                hint="Email or Telegram, kept private."
              >
                <Input id="f-contact" maxLength={200} value={f.contact} onChange={set("contact")} />
              </Field>

              <Button type="submit" variant="primary" className="mt-4 w-full" loading={busy}>
                <Send className="size-4" />Submit for review
              </Button>
              {submitter.address && (
                <p className="m-0 mt-3.5 flex flex-wrap items-center justify-center gap-2 text-[13.5px] text-muted">
                  Submitting as <Identity address={submitter.address} size={20} />
                </p>
              )}
            </form>
          </Gate>
        </div>
        <aside className="sticky top-[86px] flex flex-col gap-3.5 max-[960px]:static max-[960px]:order-first">
          <div className="panel glow-drift border-[rgba(92,183,90,.35)]">
            <span className="k">Give this guide to your AI</span>
            <ol className="m-0 flex list-none flex-col gap-2.5 p-0">
              {["Copy the guide", "Answer the questions the AI asks", "Paste the results here"]
                .map((step, i) => (
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
          <div className="panel">
            <span className="k">What happens next</span>
            <p className="m-0 small dim">
              Submissions are reviewed before they appear on the site. Once published, your
              initiative is listed with your wallet shown as the proposer.
            </p>
          </div>
        </aside>
      </div>
    </PageMain>
  );
}
