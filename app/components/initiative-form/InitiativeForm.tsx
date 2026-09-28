/**
 * The initiative editor: the submit page and the edit page share it.
 * The draft lives in useDraft, the rules run in useChecks on every change,
 * findings paint through the FindingsProvider, and the sidebar carries the
 * live checks. Errors never disable the button: pressing it paints them.
 */
import StickyAside from "~/components/layout/StickyAside";
import { useCallback, useId, useState } from "react";
import { Lock, Send } from "lucide-react";
import { type CheckScope, type Findings, SECTIONS } from "@shared/draft/mod";
import RulesPanel from "~/components/initiative/RulesPanel";
import { Button } from "~/components/ui/Button";
import Reveal from "~/components/ui/Reveal";
import Status from "~/components/ui/Status";
import { WHAT_NEXT } from "~/data/what-next";
import { errorMessage } from "~/lib/api";
import { findingsOf } from "~/lib/submit-initiative";
import { cn } from "~/lib/utils";
import BackersEditor from "./BackersEditor";
import ChecksCard from "./ChecksCard";
import { FindingsProvider, firstOnPage, focusField } from "./findings";
import FormGroup from "./FormGroup";
import MilestonesEditor from "./MilestonesEditor";
import PageFields from "./PageFields";
import PasteBox from "./PasteBox";
import PreviewPane from "./PreviewPane";
import PrivateFields from "./PrivateFields";
import SectionField from "./SectionField";
import type { Draft, FormMode, SubmitPayload } from "./types";
import TypePicker from "./TypePicker";
import CategoriesPicker from "./CategoriesPicker";
import { AUTOSAVE_KEY, useAutosave } from "./useAutosave";
import { paintField, runChecks, useChecks } from "./useChecks";
import { emptyDraft, isEmptyDraft, toPayload, useDraft } from "./useDraft";

export interface InitiativeFormProps {
  mode: FormMode;
  initial?: Draft;
  /** The money facts (type, top-up, goal, duration, recipient, reviewer,
   * forum link, private fields) are read-only: an approved initiative. */
  locked?: boolean;
  /** Which rules run; defaults to "submit" on the submit page, "edit" elsewhere. */
  scope?: CheckScope;
  /** Throw (a FindingsError, or an ApiError with a findings body) to paint
   * server findings; anything else shows as the alert. */
  onSubmit: (payload: SubmitPayload, draft: Draft) => Promise<void>;
  submitLabel: string;
  /** Shown above the locked fields; defaults to the "Locked after approval" line. */
  lockNote?: React.ReactNode;
  showBackers?: boolean;
  showPrivate?: boolean;
  showRules?: boolean;
  showTypePicker?: boolean;
  showPaste?: boolean;
  /** localStorage key, null to disable (edit pages). */
  autosaveKey?: string | null;
  /** Whether the API accepts logo uploads right now. */
  uploads?: boolean;
  /** The sidebar card above the checks (the guide); gets whether the draft is empty. */
  asideTop?: React.ReactNode | ((ctx: { empty: boolean }) => React.ReactNode);
  /** Below the checks; defaults to "What happens next" on the submit page. */
  asideBottom?: React.ReactNode;
  /** Under the submit button ("Submitting as …"). */
  footer?: React.ReactNode;
  /** The categories question, right under the type. Outside the draft (the
   * pasted text never carries it); required when shown. `suggest` turns on the
   * AI pre-fill from the title and summary. */
  categories?: { value: string[]; onChange: (next: string[]) => void; suggest?: boolean };
}

/** The two-column grid of the submit and edit pages. */
export function FormGrid({ main, aside }: { main: React.ReactNode; aside: React.ReactNode }) {
  return (
    <div className="mt-4 grid grid-cols-[1fr_340px] items-start gap-9 max-[960px]:grid-cols-1">
      <div className="min-w-0">{main}</div>
      <StickyAside className="flex flex-col gap-3.5 max-[960px]:contents">
        {aside}
      </StickyAside>
    </div>
  );
}

const fixingLine = (n: number) =>
  n === 1 ? "One thing needs fixing, marked above." : `${n} things need fixing, marked above.`;

const CATEGORY_MISSING = "Pick at least one category.";

export const LOCK_NOTE =
  "Locked after approval: type, goal, duration, recipient and the private fields. Email the team to change them.";

export default function InitiativeForm({
  mode,
  initial,
  locked,
  scope = mode === "submit" ? "submit" : "edit",
  onSubmit,
  submitLabel,
  showBackers = mode === "submit",
  showPrivate = mode === "submit",
  showRules = true,
  showTypePicker = true,
  showPaste = true,
  autosaveKey = mode === "submit" ? AUTOSAVE_KEY : null,
  uploads = true,
  asideTop,
  asideBottom,
  footer,
  lockNote = LOCK_NOTE,
  categories,
}: InitiativeFormProps) {
  const { draft, actions, reset } = useDraft(initial);
  const [submitted, setSubmitted] = useState(false);
  const [serverFeedback, setServerFeedback] = useState<
    {
      draft: Draft;
      findings: Findings | null;
      alert: string;
    } | null
  >(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(true);
  const rulesId = useId();
  const [website, setWebsite] = useState("");

  // Findings and alerts describe only the submitted draft, including when
  // a response arrives after the user has already edited it.
  const feedback = serverFeedback?.draft === draft ? serverFeedback : null;
  const alert = feedback?.alert;
  const checks = useChecks(draft, { submitted, serverFindings: feedback?.findings, scope });
  const autosave = useAutosave(draft, { key: autosaveKey, onRestore: actions.replace });

  const jump = useCallback((field: string) => {
    setPreviewing(false);
    setTimeout(() => focusField(paintField(field)), 0);
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setSubmitted(true);
    setServerFeedback(null);
    const res = runChecks(draft, scope);
    if (categories && !categories.value.length) {
      res.errors.unshift({ field: "categories", msg: CATEGORY_MISSING, kind: "missing" });
    }
    if (res.errors.length) {
      setFailed(true);
      const first = firstOnPage(res.errors.map((x) => paintField(x.field)).filter(Boolean));
      setTimeout(() => {
        if (!first || !focusField(first)) {
          document.querySelector("[data-checks]")?.scrollIntoView?.({ behavior: "smooth" });
        }
      }, 0);
      return;
    }
    setBusy(true);
    try {
      await onSubmit(toPayload(draft, {}), draft);
      autosave.clear();
      setFailed(false);
    } catch (err) {
      const findings = findingsOf(err);
      setFailed(true);
      setServerFeedback({ draft, findings, alert: errorMessage(err) });
      if (findings) {
        const first = firstOnPage(
          findings.errors.map((x) => paintField(x.field)).filter(Boolean),
        );
        setTimeout(() => {
          if (!first || !focusField(first)) globalThis.scrollTo?.({ top: 0, behavior: "smooth" });
        }, 0);
      } else {
        globalThis.scrollTo?.({ top: 0, behavior: "smooth" });
      }
    } finally {
      setBusy(false);
    }
  }

  // Shown once a submit was tried, like the other required questions.
  const categoryError = !categories
    ? undefined
    : feedback?.findings?.errors.find((f) => f.field === "categories")?.msg ??
      (submitted && !categories.value.length ? CATEGORY_MISSING : undefined);

  const empty = isEmptyDraft(draft);
  const top = typeof asideTop === "function" ? asideTop({ empty }) : asideTop;
  const errorsNow = checks.errors.length;

  const checksCard = (
    <div data-checks="">
      <ChecksCard
        checks={checks}
        submitted={submitted}
        failed={failed}
        previewing={previewing}
        onTogglePreview={() => setPreviewing((p) => !p)}
        onJump={jump}
        scope={scope}
      />
    </div>
  );
  const bottom = asideBottom !== undefined
    ? asideBottom
    : mode === "submit" && (
      <div className="panel">
        <span className="k">What happens next</span>
        <p className="m-0 small dim">{WHAT_NEXT[draft.type]}</p>
      </div>
    );

  const main = (
    <>
      {autosave.restored && (
        <Status
          kind="wait"
          className="mt-2 flex flex-wrap items-center justify-between gap-3"
        >
          <span>Restored your unsent draft.</span>
          <Button
            variant="ghost"
            sm
            onClick={() => {
              autosave.clear();
              reset(emptyDraft());
              setSubmitted(false);
            }}
          >
            Discard
          </Button>
        </Status>
      )}
      {alert && <div className="alert" role="alert">{alert}</div>}
      <form
        className="flex flex-col"
        onSubmit={submit}
        noValidate
        onKeyDown={(e) => {
          const t = e.target as HTMLElement;
          if (
            e.key === "Enter" && t.tagName === "INPUT" &&
            (t as HTMLInputElement).type !== "submit"
          ) e.preventDefault();
        }}
      >
        <input
          type="text"
          name="website"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
          className="hp"
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
        />
        {locked && lockNote && (
          <Status kind="wait" className="mt-3">
            <Lock className="mr-1.5 inline size-3.5 align-[-2px]" />
            {lockNote}
          </Status>
        )}
        {showTypePicker && <TypePicker draft={draft} actions={actions} locked={locked} />}
        {categories && (
          <CategoriesPicker
            value={categories.value}
            onChange={categories.onChange}
            suggestFrom={categories.suggest ? draft.page : undefined}
            error={categoryError}
          />
        )}
        {showPaste && (
          <PasteBox
            draft={draft}
            onText={actions.replaceText}
            onUnsorted={actions.setUnsorted}
          />
        )}

        <FormGroup title="The page fields">
          These render in the header of your initiative page, next to the type badge. They are never
          part of a body section.
        </FormGroup>
        <PageFields draft={draft} actions={actions} locked={locked} />

        {showBackers && (
          <>
            <FormGroup title="Backers already committed">
              Optional, and open to every type. Anyone who has already committed money to this work,
              with their logo. The header of your page and your board card show the total and the
              logos, the way backer logos show on every initiative today.
            </FormGroup>
            <BackersEditor draft={draft} actions={actions} uploads={uploads} />
          </>
        )}

        <FormGroup title="The sections">
          The site renders the heading, you answer the question. Fixed order, no renaming, no
          dropping. Bold, links and lists are welcome inside a field.
        </FormGroup>
        {SECTIONS[draft.type].map((key) => (
          <SectionField
            key={key}
            sectionKey={key}
            value={draft.sections[key] ?? ""}
            onChange={(v) => actions.setSection(key, v)}
          />
        ))}

        <FormGroup title="Milestones">
          Each row renders as a heading with a checklist under it. The site letters them A, B, C in
          the order they sit here. The amounts add up against your funding goal. An adoption
          milestone is all adoption: every criterion is evidence that other people use the work, and
          its payment divided by the users or integrations it buys has to be a number a funder would
          pay.
        </FormGroup>
        <MilestonesEditor draft={draft} actions={actions} totals={checks.totals} />

        {showPrivate && (
          <>
            <FormGroup title="Private, never published">
              Only the review team reads these two fields. They never appear on the page, the board,
              or the API.
            </FormGroup>
            <PrivateFields draft={draft} actions={actions} locked={locked} />
          </>
        )}

        {showRules && (
          <div className="mt-10">
            <button
              type="button"
              className="block w-full cursor-pointer border-0 bg-transparent p-0 text-left font-inter-tight text-[13.5px] text-muted"
              aria-expanded={rulesOpen}
              aria-controls={rulesOpen ? rulesId : undefined}
              onClick={() => setRulesOpen((o) => !o)}
            >
              <span className="k mb-0 inline text-dao-green">The panel the site adds</span>
              <span className="mt-1 block">
                The site adds this panel under your text, it swaps with the type
              </span>
            </button>
            <Reveal show={rulesOpen} id={rulesId}>
              <RulesPanel
                r={{ type: draft.type, topup: draft.type === "grant" && draft.topup }}
              />
            </Reveal>
          </div>
        )}

        <Button
          type="submit"
          variant="primary"
          className={cn("mt-6 w-full", showRules && "mt-4")}
          loading={busy}
        >
          <Send className="size-4" />
          {submitLabel}
        </Button>
        {submitted && errorsNow > 0 && (
          <p className="m-0 mt-2.5 text-center small text-[#ffd7d6]" role="status">
            {fixingLine(errorsNow)}
          </p>
        )}
        {footer}
      </form>
    </>
  );

  return (
    <FindingsProvider value={checks.byField}>
      {previewing && <PreviewPane draft={draft} onBack={() => setPreviewing(false)} />}
      <div hidden={previewing}>
        <FormGrid
          main={main}
          aside={
            <>
              {top && (
                <div className="contents max-[960px]:order-first max-[960px]:block">{top}</div>
              )}
              {checksCard}
              {bottom}
            </>
          }
        />
      </div>
    </FindingsProvider>
  );
}
