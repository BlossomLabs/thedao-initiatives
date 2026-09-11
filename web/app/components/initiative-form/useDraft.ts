/**
 * The draft reducer: one action per thing the form can do, plus the two
 * conversions at the edges (an initiative from the API -> a draft, a draft ->
 * the POST body). Pure functions first, the hook at the bottom.
 */
import { useCallback, useMemo, useReducer } from "react";
import {
  type CheckInput,
  type DraftType,
  type Milestone,
  parseAmount,
  parseBackers,
  SECTION_KEYS,
  type SectionKey,
  SECTIONS,
  type Sections,
  type SplitResult,
} from "@shared/draft/mod";
import type { Initiative } from "~/lib/api-types";
import type { Draft, DraftBacker, DraftCriterion, DraftMilestone, SubmitPayload } from "./types";

let seq = 0;
export const newId = (): string => `d${++seq}${Math.random().toString(36).slice(2, 7)}`;

export const emptyCriterion = (text = ""): DraftCriterion => ({ id: newId(), text });

export const emptyMilestone = (): DraftMilestone => ({
  id: newId(),
  name: "",
  amount: "",
  adoption: false,
  done: false,
  link: "",
  month: "",
  criteria: [emptyCriterion()],
});

export const emptyBacker = (): DraftBacker => ({
  id: newId(),
  org: "",
  amount: "",
  url: "",
  logo: null,
  logoCid: "",
});

export const emptyDraft = (): Draft => ({
  type: "rfp",
  topup: false,
  milestoneReviewer: "",
  page: {
    title: "",
    summary: "",
    goal: "",
    duration: "",
    recipientTeam: "",
    recipientUrl: "",
    discourseUrl: "",
    links: "",
  },
  sections: {},
  milestones: [emptyMilestone()],
  backers: [],
  priv: { funders: "", contact: "" },
  unsorted: "",
});

/** "150000" -> "150,000"; "" for nothing. What the amount inputs show after blur. */
export const money = (n: number): string =>
  n ? n.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "";

const intText = (raw: string): string => {
  const n = parseInt(String(raw).replace(/[^0-9]/g, ""), 10);
  return Number.isFinite(n) && n > 0 ? String(n) : "";
};

/** One line per criterion: newlines (typed or pasted) become spaces. */
export const flatten = (s: string): string => s.replace(/[\r\n]+/g, " ");

export const draftMilestone = (m: Milestone): DraftMilestone => ({
  id: newId(),
  name: m.name,
  amount: money(m.amount),
  adoption: m.adoption,
  done: m.done,
  link: m.link,
  month: m.month,
  criteria: (m.criteria.length ? m.criteria : [""]).map((c) => emptyCriterion(c)),
});

/** True when nothing has been typed yet (the guide card glows until then). */
export function isEmptyDraft(d: Draft): boolean {
  const page = Object.values(d.page).some((v) => v.trim());
  const sections = Object.values(d.sections).some((v) => v && v.trim());
  const ms = d.milestones.some((m) =>
    m.name.trim() || m.amount.trim() || m.criteria.some((c) => c.text.trim())
  );
  const bk = d.backers.some((b) => b.org.trim() || b.amount.trim());
  const priv = Boolean(d.priv.funders.trim() || d.priv.contact.trim());
  return !(page || sections || ms || bk || priv || d.unsorted.trim());
}

/** An initiative from the API as a draft (edit pages). Backers are pledges
 * there, managed by the admin, so the list starts empty. */
export function fromInitiative(
  r: Initiative & Partial<{ funders: string; contact: string }>,
): Draft {
  const d = emptyDraft();
  d.type = r.type;
  d.topup = r.type === "grant" && r.topup;
  d.milestoneReviewer = r.milestoneReviewer ?? "";
  d.page = {
    title: r.title ?? "",
    summary: r.summary ?? "",
    goal: money(r.goalUsd || 0),
    duration: r.durationMonths ? String(r.durationMonths) : "",
    recipientTeam: r.recipientTeam ?? "",
    recipientUrl: r.recipientUrl ?? "",
    discourseUrl: r.discourseUrl ?? "",
    links: (r.links ?? []).join("\n"),
  };
  d.sections = { ...(r.sections ?? {}) };
  d.milestones = (r.milestones ?? []).length
    ? (r.milestones ?? []).map(draftMilestone)
    : [emptyMilestone()];
  d.priv = { funders: r.funders ?? "", contact: r.contact ?? "" };
  return d;
}

export const linksOf = (d: Draft): string[] =>
  d.page.links.split("\n").map((l) => l.trim()).filter(Boolean);

/** Milestones as the API reads them: numbers, empty criteria dropped. */
export const payloadMilestones = (d: Draft): Milestone[] =>
  d.milestones.map((m) => ({
    name: m.name.trim(),
    amount: parseAmount(m.amount),
    adoption: Boolean(m.adoption),
    done: Boolean(d.topup && m.done),
    link: d.topup && m.done ? m.link.trim() : "",
    month: d.topup && !m.done ? m.month.trim() : "",
    criteria: m.criteria.map((c) => c.text.trim()).filter(Boolean),
  }));

/** The sections of the draft's type only (text for the other type stays in
 * the draft in case the proposer switches back). */
export const sectionsOf = (d: Draft): Sections => {
  const out: Sections = {};
  for (const key of SECTIONS[d.type]) {
    const t = (d.sections[key] ?? "").trim();
    if (t) out[key] = t;
  }
  return out;
};

/** Rows with something in them; empty rows are not backers. */
export const liveBackers = (d: Draft): DraftBacker[] =>
  d.backers.filter((b) => b.org.trim() || parseAmount(b.amount) > 0);

export function toCheckInput(d: Draft): CheckInput {
  return {
    type: d.type,
    topup: d.topup,
    page: {
      title: d.page.title,
      summary: d.page.summary,
      goal: parseAmount(d.page.goal),
      duration: d.page.duration.trim(),
      recipient: d.page.recipientTeam,
      recipientUrl: d.page.recipientUrl,
      funders: d.priv.funders,
      contact: d.priv.contact,
    },
    sections: sectionsOf(d),
    milestones: payloadMilestones(d),
    links: linksOf(d),
    backers: liveBackers(d).map((b) => ({
      org: b.org.trim(),
      amountUsd: parseAmount(b.amount),
      url: b.url.trim(),
    })),
  };
}

/** The POST body. `logoCids` overrides per backer id (set after the uploads). */
export function toPayload(d: Draft, logoCids: Record<string, string> = {}): SubmitPayload {
  const goal = parseAmount(d.page.goal);
  return {
    website: "",
    type: d.type,
    topup: d.type === "grant" && d.topup,
    title: d.page.title.trim(),
    summary: d.page.summary.trim(),
    discourseUrl: d.page.discourseUrl.trim(),
    goal: goal ? String(goal) : "",
    durationMonths: d.page.duration.trim(),
    recipientTeam: d.type === "grant" ? d.page.recipientTeam.trim() : "",
    recipientUrl: d.type === "grant" ? d.page.recipientUrl.trim() : "",
    milestoneReviewer: d.type === "grant" && d.topup ? d.milestoneReviewer.trim() : "",
    funders: d.priv.funders.trim(),
    contact: d.priv.contact.trim(),
    sections: sectionsOf(d),
    milestones: payloadMilestones(d),
    links: linksOf(d),
    backers: liveBackers(d).map((b) => ({
      org: b.org.trim(),
      amountUsd: parseAmount(b.amount),
      url: b.url.trim(),
      logoCid: logoCids[b.id] ?? b.logoCid,
    })),
  };
}

/* ------------------------------------------------------------ reducer */

export type DraftAction =
  | { t: "setType"; type: DraftType }
  | { t: "setTopup"; topup: boolean }
  | { t: "setReviewer"; value: string }
  | { t: "setPage"; key: keyof Draft["page"]; value: string }
  | { t: "setSection"; key: SectionKey; value: string }
  | { t: "setPriv"; key: "funders" | "contact"; value: string }
  | { t: "setUnsorted"; value: string }
  | { t: "addMilestone"; row: DraftMilestone }
  | { t: "removeMilestone"; id: string }
  | { t: "setMilestone"; id: string; patch: Partial<Omit<DraftMilestone, "id" | "criteria">> }
  | { t: "setCriterion"; ms: string; id: string; value: string }
  | { t: "insertCriterion"; ms: string; after: string | null; row: DraftCriterion }
  | { t: "removeCriterion"; ms: string; id: string }
  | { t: "addBacker"; row: DraftBacker }
  | { t: "removeBacker"; id: string }
  | { t: "setBacker"; id: string; patch: Partial<Omit<DraftBacker, "id" | "logo">> }
  | { t: "setLogo"; id: string; file: File | null }
  | { t: "applySplit"; result: SplitResult }
  | { t: "undoSplit" }
  | { t: "replace"; draft: Draft };

export interface DraftState {
  draft: Draft;
  /** The draft as it was before the last paste, for Undo. */
  undo: Draft | null;
}

const mapMs = (
  d: Draft,
  id: string,
  fn: (m: DraftMilestone) => DraftMilestone,
): Draft => ({ ...d, milestones: d.milestones.map((m) => (m.id === id ? fn(m) : m)) });

const mapBk = (d: Draft, id: string, fn: (b: DraftBacker) => DraftBacker): Draft => ({
  ...d,
  backers: d.backers.map((b) => (b.id === id ? fn(b) : b)),
});

/** Fill the draft from a sorted paste: only what the paste contains is
 * overwritten; milestones and backers are replaced only when present. */
export function applySplit(d: Draft, res: SplitResult): Draft {
  const page = { ...d.page };
  const p = res.page;
  if (p.title) page.title = p.title;
  if (p.summary) page.summary = p.summary;
  if (p.goal) page.goal = money(parseAmount(p.goal));
  if (p.duration) page.duration = intText(p.duration);
  if (p.links) page.links = p.links;
  if (p.recipient) page.recipientTeam = p.recipient;
  const priv = { ...d.priv };
  if (p.funders) priv.funders = p.funders;
  if (p.contact) priv.contact = p.contact;
  const sections: Sections = { ...d.sections };
  for (const key of SECTION_KEYS) {
    const t = res.fields[key];
    if (t) sections[key] = t;
  }
  const pasted = p.backers ? parseBackers(p.backers) : [];
  const backers = pasted.length
    ? pasted.map((b) => ({
      ...emptyBacker(),
      org: b.org,
      amount: money(b.amountUsd),
      url: b.url,
    }))
    : d.backers;
  const milestones = res.milestones.length ? res.milestones.map(draftMilestone) : d.milestones;
  return { ...d, page, priv, sections, backers, milestones, unsorted: res.unsorted };
}

/** What a paste changed, for the "Sorted: …" line. */
export function splitReport(res: SplitResult, type: DraftType) {
  const sections = SECTIONS[type].filter((k) => res.fields[k]).length;
  const others = SECTION_KEYS.filter((k) => res.fields[k] && !SECTIONS[type].includes(k));
  const p = res.page;
  let fields = 0;
  for (const k of ["title", "summary", "goal", "duration", "links", "recipient"] as const) {
    if (p[k]) fields++;
  }
  if (p.backers && parseBackers(p.backers).length) fields++;
  return {
    sections,
    milestones: res.milestones.length,
    fields,
    unsorted: Boolean(res.unsorted.trim()),
    /** Section keys that only the other type has (the paste was for a grant). */
    otherType: others,
  };
}

export function draftReducer(s: DraftState, a: DraftAction): DraftState {
  const d = s.draft;
  switch (a.t) {
    case "setType":
      return {
        ...s,
        draft: { ...d, type: a.type, topup: a.type === "grant" ? d.topup : false },
      };
    case "setTopup":
      return { ...s, draft: { ...d, topup: d.type === "grant" && a.topup } };
    case "setReviewer":
      return { ...s, draft: { ...d, milestoneReviewer: a.value } };
    case "setPage":
      return { ...s, draft: { ...d, page: { ...d.page, [a.key]: a.value } } };
    case "setSection":
      return { ...s, draft: { ...d, sections: { ...d.sections, [a.key]: a.value } } };
    case "setPriv":
      return { ...s, draft: { ...d, priv: { ...d.priv, [a.key]: a.value } } };
    case "setUnsorted":
      return { ...s, draft: { ...d, unsorted: a.value } };
    case "addMilestone":
      return { ...s, draft: { ...d, milestones: [...d.milestones, a.row] } };
    case "removeMilestone":
      return { ...s, draft: { ...d, milestones: d.milestones.filter((m) => m.id !== a.id) } };
    case "setMilestone":
      return { ...s, draft: mapMs(d, a.id, (m) => ({ ...m, ...a.patch })) };
    case "setCriterion":
      return {
        ...s,
        draft: mapMs(d, a.ms, (m) => ({
          ...m,
          criteria: m.criteria.map((c) => (c.id === a.id ? { ...c, text: flatten(a.value) } : c)),
        })),
      };
    case "insertCriterion":
      return {
        ...s,
        draft: mapMs(d, a.ms, (m) => {
          const at = a.after === null
            ? m.criteria.length
            : m.criteria.findIndex((c) => c.id === a.after) + 1;
          const criteria = [...m.criteria];
          criteria.splice(at <= 0 ? m.criteria.length : at, 0, a.row);
          return { ...m, criteria };
        }),
      };
    case "removeCriterion":
      return {
        ...s,
        draft: mapMs(d, a.ms, (m) => ({
          ...m,
          criteria: m.criteria.filter((c) => c.id !== a.id),
        })),
      };
    case "addBacker":
      return { ...s, draft: { ...d, backers: [...d.backers, a.row] } };
    case "removeBacker":
      return { ...s, draft: { ...d, backers: d.backers.filter((b) => b.id !== a.id) } };
    case "setBacker":
      return { ...s, draft: mapBk(d, a.id, (b) => ({ ...b, ...a.patch })) };
    case "setLogo":
      // a new file invalidates the receipt of the old upload
      return { ...s, draft: mapBk(d, a.id, (b) => ({ ...b, logo: a.file, logoCid: "" })) };
    case "applySplit":
      return { undo: d, draft: applySplit(d, a.result) };
    case "undoSplit":
      return s.undo ? { undo: null, draft: s.undo } : s;
    case "replace":
      return { undo: null, draft: a.draft };
  }
}

export function useDraft(initial?: Draft) {
  const [state, dispatch] = useReducer(draftReducer, initial, (init) => ({
    draft: init ?? emptyDraft(),
    undo: null,
  }));
  const actions = useMemo(
    () => ({
      setType: (type: DraftType) => dispatch({ t: "setType", type }),
      setTopup: (topup: boolean) => dispatch({ t: "setTopup", topup }),
      setReviewer: (value: string) => dispatch({ t: "setReviewer", value }),
      setPage: (key: keyof Draft["page"], value: string) => dispatch({ t: "setPage", key, value }),
      setSection: (key: SectionKey, value: string) => dispatch({ t: "setSection", key, value }),
      setPriv: (key: "funders" | "contact", value: string) =>
        dispatch({ t: "setPriv", key, value }),
      setUnsorted: (value: string) => dispatch({ t: "setUnsorted", value }),
      addMilestone: (): string => {
        const row = emptyMilestone();
        dispatch({ t: "addMilestone", row });
        return row.id;
      },
      removeMilestone: (id: string) => dispatch({ t: "removeMilestone", id }),
      setMilestone: (id: string, patch: Partial<Omit<DraftMilestone, "id" | "criteria">>) =>
        dispatch({ t: "setMilestone", id, patch }),
      setCriterion: (ms: string, id: string, value: string) =>
        dispatch({ t: "setCriterion", ms, id, value }),
      /** Inserts an empty criterion after `after` (or at the end) and returns its id. */
      insertCriterion: (ms: string, after: string | null): string => {
        const row = emptyCriterion();
        dispatch({ t: "insertCriterion", ms, after, row });
        return row.id;
      },
      removeCriterion: (ms: string, id: string) => dispatch({ t: "removeCriterion", ms, id }),
      addBacker: (): string => {
        const row = emptyBacker();
        dispatch({ t: "addBacker", row });
        return row.id;
      },
      removeBacker: (id: string) => dispatch({ t: "removeBacker", id }),
      setBacker: (id: string, patch: Partial<Omit<DraftBacker, "id" | "logo">>) =>
        dispatch({ t: "setBacker", id, patch }),
      setLogo: (id: string, file: File | null) => dispatch({ t: "setLogo", id, file }),
      applySplit: (result: SplitResult) => dispatch({ t: "applySplit", result }),
      undoSplit: () => dispatch({ t: "undoSplit" }),
      replace: (draft: Draft) => dispatch({ t: "replace", draft }),
    }),
    [],
  );
  const canUndo = state.undo !== null;
  const reset = useCallback(
    (d?: Draft) => dispatch({ t: "replace", draft: d ?? emptyDraft() }),
    [],
  );
  return { draft: state.draft, actions, canUndo, reset };
}

export type DraftActions = ReturnType<typeof useDraft>["actions"];
