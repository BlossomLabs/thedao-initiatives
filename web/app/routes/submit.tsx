import { useState } from "react";
import { useNavigate } from "react-router";
import { Send } from "lucide-react";
import PageMain from "~/components/layout/PageMain";
import Shimmer from "~/components/layout/Shimmer";
import { Field, Input, Textarea } from "~/components/ui/Field";
import { Button } from "~/components/ui/Button";
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

export default function Submit() {
  const navigate = useNavigate();
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
      await api<{ slug: string }>("/api/initiatives", { json: f, token: null });
      navigate("/submit/thanks", { state: { title: f.title } });
    } catch (err) {
      setError(errorMessage(err));
      globalThis.scrollTo({ top: 0, behavior: "smooth" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageMain narrow detail>
      <h1 className="mb-3 mt-1.5 font-inter-tight text-[clamp(26px,4vw,40px)] font-medium leading-[1.12] tracking-[-.02em]">
        Suggest an initiative
      </h1>
      <p className="mt-3.5 max-w-[760px] font-inter-tight text-[15px] font-light leading-[1.65] text-muted">
        The strongest initiatives start as a forum post where the idea gets discussed in public;
        link it here if you have one. Submissions are reviewed before they appear on the site.
      </p>
      <Shimmer soft />

      <div className="mb-[26px] mt-[18px] grid grid-cols-1 gap-3.5 rounded-[14px] border border-[rgba(92,183,90,.25)] bg-[rgba(92,183,90,.06)] px-5 py-[18px] min-[720px]:grid-cols-3">
        {[
          {
            key: "guide",
            body: (
              <>
                Give this guide to your AI<br />
                <Button variant="ghost" sm className="mt-2" onClick={copyGuide}>
                  {copied === "done"
                    ? "Copied ✓"
                    : copied === "fail"
                    ? "Copy failed, open /llms.txt"
                    : "Copy the guide"}
                </Button>
              </>
            ),
          },
          { key: "answer", body: "Answer the questions the AI asks" },
          { key: "paste", body: "Paste the results below" },
        ].map((step, i) => (
          <div
            key={step.key}
            className="flex items-start gap-3 font-inter-tight text-[15px] leading-[1.5]"
          >
            <span className="grid size-[26px] flex-none place-items-center rounded-full border border-[rgba(92,183,90,.5)] bg-[rgba(92,183,90,.18)] font-inter-tight text-[13px] font-semibold text-[#7dd57e]">
              {i + 1}
            </span>
            <div>{step.body}</div>
          </div>
        ))}
      </div>

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
                  className="mt-[3px] accent-dao-bright"
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
      </form>
    </PageMain>
  );
}
