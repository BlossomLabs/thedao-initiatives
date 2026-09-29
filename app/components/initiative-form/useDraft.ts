/**
 * The draft reducer: one action per thing the form can do, plus the two
 * conversions at the edges (an initiative from the API -> a draft, a draft ->
 * the POST body). Pure functions first, the hook at the bottom. The paste
 * box mirror lives in draft-text.ts.
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
import type { Initiative, Pledge } from "~/lib/api-types";
import { normaliseCategories } from "~/lib/categories";
import { readCategoryText } from "@shared/categories";
import type { Draft, DraftBacker, DraftCriterion, DraftMilestone, SubmitPayload } from "./types";
import { replaceFromText } from "./draft-text";

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
  categories: [],
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
  return !(d.categories.length || page || sections || ms || bk || priv || d.unsorted.trim());
}

/** An initiative from the API as a draft (edit pages). Backers are pledges
 * there, managed by the admin: the rows are seeded from the live pledges so
 * the checks and the preview see what other backers committed, and the edit
 * pages never post them. */
export function fromInitiative(
  r: Initiative & Partial<{ funders: string; contact: string }>,
  pledges: Pick<Pledge, "company" | "amountUsd" | "url" | "status">[] = [],
): Draft {
  const d = emptyDraft();
  d.type = r.type;
  d.topup = r.type === "grant" && r.topup;
  d.categories = normaliseCategories(r.categories ?? []);
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
  d.backers = pledges.filter((p) => p.status !== "withdrawn" && p.company.trim())
    .map((p) => ({ ...emptyBacker(), org: p.company, amount: money(p.amountUsd), url: p.url }));
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
      discourseUrl: d.page.discourseUrl,
      funders: d.priv.funders,
      contact: d.priv.contact,
      reviewer: d.type === "grant" && d.topup ? d.milestoneReviewer : "",
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
    categories: [...d.categories],
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
  | { t: "setCategories"; value: string[] }
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
  | { t: "replaceText"; text: string }
  | { t: "replace"; draft: Draft };

export interface DraftState {
  draft: Draft;
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

/** What a paste changed, for the "Sorted: …" line. */
export function splitReport(res: SplitResult, type: DraftType) {
  const sections = SECTIONS[type].filter((k) => res.fields[k]).length;
  const others = SECTION_KEYS.filter((k) => res.fields[k] && !SECTIONS[type].includes(k));
  const p = res.page;
  let fields = 0;
  for (const k of ["title", "summary", "goal", "duration", "links", "recipient"] as const) {
    if (p[k]) fields++;
  }
  const backerRows = p.backers ? parseBackers(p.backers).length : 0;
  if (backerRows) fields++;
  const letter = (i: number) => String.fromCharCode(65 + (i % 26));
  const cats = readCategoryText(p.categories ?? "");
  return {
    /** Categories read from the Categories section, and names it could not read. */
    categories: cats.slugs.length,
    unknownCategories: cats.unknown,
    sections,
    milestones: res.milestones.length,
    fields,
    unsorted: Boolean(res.unsorted.trim()),
    /** Section keys that only the other type has (the paste was for a grant). */
    otherType: others,
    /** What did not read as intended, for the hints under the box. */
    noAmount: res.milestones.map((m, i) => (m.amount > 0 ? "" : letter(i))).filter(Boolean),
    noCriteria: res.milestones.map((m, i) => (m.criteria.length ? "" : letter(i))).filter(
      Boolean,
    ),
    /** A "Backers already committed" heading with no `Org | amount | link` line under it. */
    backersUnread: Boolean(p.backers?.trim()) && backerRows === 0,
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
    case "setCategories":
      return { ...s, draft: { ...d, categories: normaliseCategories(a.value) } };
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
    case "replaceText":
      return { draft: replaceFromText(d, a.text) };
    case "replace":
      return { draft: a.draft };
  }
}

export function useDraft(initial?: Draft) {
  const [state, dispatch] = useReducer(draftReducer, initial, (init) => ({
    draft: init ?? emptyDraft(),
  }));
  const actions = useMemo(
    () => ({
      setType: (type: DraftType) => dispatch({ t: "setType", type }),
      setTopup: (topup: boolean) => dispatch({ t: "setTopup", topup }),
      setCategories: (value: string[]) => dispatch({ t: "setCategories", value }),
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
      replaceText: (text: string) => dispatch({ t: "replaceText", text }),
      replace: (draft: Draft) => dispatch({ t: "replace", draft }),
    }),
    [],
  );
  const reset = useCallback(
    (d?: Draft) => dispatch({ t: "replace", draft: d ?? emptyDraft() }),
    [],
  );
  return { draft: state.draft, actions, reset };
}

export type DraftActions = ReturnType<typeof useDraft>["actions"];
