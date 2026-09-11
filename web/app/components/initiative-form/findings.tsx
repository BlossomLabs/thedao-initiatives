/**
 * Findings painting. Every control carries id="f-<fieldId>" and its wrapper
 * data-field="<fieldId>"; the context hands each field its messages, the
 * control gets has-error / has-warn, and the message renders under it.
 * Container fields (milestones, backers, a criteria list) paint a left edge.
 */
import { createContext, useContext } from "react";
import { cn } from "~/lib/utils";
import type { FieldFindings } from "./useChecks";

const Ctx = createContext<Map<string, FieldFindings>>(new Map());

export const FindingsProvider = Ctx.Provider;

export const domId = (field: string): string => `f-${field}`;

const EMPTY: FieldFindings = { errors: [], warnings: [] };

export function useFinding(field: string): FieldFindings & { cls: string | undefined } {
  const f = useContext(Ctx).get(field) ?? EMPTY;
  return {
    ...f,
    cls: f.errors.length ? "has-error" : f.warnings.length ? "has-warn" : undefined,
  };
}

/** The messages under a control. */
export function FieldMsg(
  { field, className, id }: { field: string; className?: string; id?: string },
) {
  const f = useFinding(field);
  if (!f.errors.length && !f.warnings.length) return null;
  return (
    <div className={className} id={id}>
      {f.errors.map((m, i) => <p key={"e" + i} className="fld-msg fld-err">{m}</p>)}
      {f.warnings.map((m, i) => <p key={"w" + i} className="fld-msg fld-warn">{m}</p>)}
    </div>
  );
}

/** Left-edge paint for a container (a list of rows), by finding state. */
export function edgeClass(f: { errors: string[]; warnings: string[] }): string | undefined {
  return cn(
    f.errors.length && "border-l-2 border-l-[rgba(255,59,56,.7)] pl-3.5",
    !f.errors.length && f.warnings.length && "border-l-2 border-l-[rgba(240,180,41,.7)] pl-3.5",
  ) || undefined;
}

const FOCUSABLE = /^(INPUT|TEXTAREA|SELECT|BUTTON)$/;

/** Scroll a field into view and focus it (or its first control). */
export function focusField(field: string): boolean {
  if (typeof document === "undefined") return false;
  const el = document.getElementById(domId(field));
  if (!el) return false;
  const target = FOCUSABLE.test(el.tagName)
    ? el
    : el.querySelector<HTMLElement>("input,textarea,select") ?? el;
  try {
    target.focus({ preventScroll: true });
  } catch {
    target.focus();
  }
  el.scrollIntoView?.({ behavior: "smooth", block: "center" });
  // Some browsers ignore a smooth scroll (reduced motion, automation); if the
  // field is still off-centre after a beat, jump there instead.
  setTimeout(() => {
    const r = el.getBoundingClientRect();
    const off = Math.abs(r.top + r.height / 2 - globalThis.innerHeight / 2);
    if (off > globalThis.innerHeight * 0.45) el.scrollIntoView?.({ block: "center" });
  }, 400);
  return true;
}

/** Of several fields, the one that comes first on the page. */
export function firstOnPage(fields: string[]): string | null {
  if (typeof document === "undefined") return fields[0] ?? null;
  let best: { field: string; el: Element } | null = null;
  for (const f of fields) {
    const el = document.getElementById(domId(f));
    if (!el) continue;
    // DOCUMENT_POSITION_FOLLOWING: the current best sits after this element
    if (!best || el.compareDocumentPosition(best.el) & Node.DOCUMENT_POSITION_FOLLOWING) {
      best = { field: f, el };
    }
  }
  return best?.field ?? fields[0] ?? null;
}
