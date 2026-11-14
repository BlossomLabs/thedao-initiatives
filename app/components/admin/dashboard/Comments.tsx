import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button, LinkButton } from "~/components/ui/Button";
import { api, errorMessage } from "~/lib/api";
import type { AdminComment, AdminTodo } from "~/lib/api-types";
import { dayTime, plural, shortAddr, truncate } from "~/lib/format";
import { cn } from "~/lib/utils";
import TodoSection, { TodoRow } from "./TodoSection";
import HeldQueue from "./HeldQueue";

/** Unanswered questions shown before "Show all". */
const FIRST = 3;

function Entry({ c, extra }: { c: AdminComment; extra?: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-[999_1_260px] flex-col gap-0.5">
      <span className="font-inter-tight text-[14px] font-medium">
        {c.type === "question" ? "Question" : c.type === "suggestion" ? "Suggestion" : "Comment"}
        {" on "}
        {c.initiative?.title ?? "?"}
      </span>
      <span className="whitespace-pre-line small text-white/75 [overflow-wrap:anywhere]">
        “{truncate(c.body, 200)}” · {c.displayName || "(no name)"}
        {c.address ? ` · ${shortAddr(c.address)}` : ""}
        {extra}
      </span>
      {c.aiSummary && <span className="small dim">AI: {c.aiSummary}</span>}
    </div>
  );
}

const link = (c: AdminComment) =>
  c.initiative ? `/initiative/${c.initiative.slug}#qa-${c.parentId ?? c.id}` : undefined;

/** Held entries, reported entries and unanswered questions in one card. */
export default function Comments({ data }: { data: AdminTodo }) {
  const qc = useQueryClient();
  const [all, setAll] = useState(false);
  // A failed action says so in its row, under the buttons.
  const [rowError, setRowError] = useState<{ id: string; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const act = async (id: string, action: string) => {
    if (action === "discard" && !confirm("Discard this comment?")) return;
    setRowError(null);
    setBusy(id + action);
    try {
      await api(`/api/admin/comments/${id}/${action}`, { method: "POST" });
    } catch (e) {
      setRowError({ id, text: errorMessage(e, "That did not work.") });
    }
    setBusy(null);
    void qc.invalidateQueries({ queryKey: ["admin", "todo"] });
  };
  const said = (id: string) =>
    rowError?.id === id && (
      <p className="fld-msg fld-err m-0 basis-full" role="alert">{rowError.text}</p>
    );
  const btn = (c: AdminComment, action: string, label: string, primary = false) => (
    <Button
      sm
      variant={primary ? "primary" : "ghost"}
      loading={busy === c.id + action}
      disabled={busy !== null}
      onClick={() => void act(c.id, action)}
    >
      {label}
    </Button>
  );
  const stale = data.unanswered.filter((q) => q.createdAt < data.weekAgo).length;
  const shown = all ? data.unanswered : data.unanswered.slice(0, FIRST);
  const count = data.held.length + data.reported.length + data.unanswered.length;
  return (
    <TodoSection
      title="Comments"
      count={count}
      note={[
        data.held.length && `${data.held.length} held`,
        data.reported.length && `${data.reported.length} reported`,
        data.unanswered.length &&
        `${data.unanswered.length} unanswered${stale ? `, ${stale} older than 7 days` : ""}`,
      ].filter(Boolean).join(" · ")}
      empty="Nothing held, nothing reported, every question has a reply."
    >
      <HeldQueue count={data.held.length} />
      {data.reported.map((c) => (
        <TodoRow key={c.id}>
          <Entry c={c} extra={` · ${plural(c.reports, "report")}`} />
          <span className="flex flex-wrap gap-1.5">
            {link(c) && <LinkButton sm variant="ghost" to={link(c)!}>Open</LinkButton>}
            {btn(c, "unreport", "Dismiss reports")}
            {btn(c, "discard", "Discard")}
          </span>
          {said(c.id)}
        </TodoRow>
      ))}
      {shown.map((c) => {
        const old = c.createdAt < data.weekAgo;
        return (
          <TodoRow key={c.id} className={cn(old && "bg-[rgba(255,59,56,.06)]")}>
            <Entry
              c={c}
              extra={
                <>
                  {" · asked "}
                  {dayTime(c.createdAt)}
                  {old && <b className="text-[#ffb3b2]">· 7+ days</b>}
                </>
              }
            />
            {link(c) && <LinkButton sm variant="ghost" to={link(c)!}>Answer</LinkButton>}
          </TodoRow>
        );
      })}
      {data.unanswered.length > FIRST && (
        <TodoRow>
          <button
            type="button"
            className="cursor-pointer border-0 bg-transparent p-0 small text-white/80 underline decoration-white/25 underline-offset-2 hover:text-white"
            onClick={() => setAll(!all)}
          >
            {all
              ? "Show fewer questions"
              : `Show ${plural(data.unanswered.length - FIRST, "more unanswered question")}`}
          </button>
        </TodoRow>
      )}
    </TodoSection>
  );
}
