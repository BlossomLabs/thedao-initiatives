import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Camera,
  CheckCircle2,
  ChevronLeft,
  CircleAlert,
  Lightbulb,
  Loader2,
  MessageSquare,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import {
  SUPPORT_CATEGORIES,
  SUPPORT_CATEGORY_KEYS,
  SUPPORT_MESSAGE_MAX,
  SUPPORT_SCREENSHOT_MAX,
  type SupportCategory,
} from "@shared/support";
import { api } from "~/lib/api";
import { Button } from "~/components/ui/Button";
import { Input, Textarea } from "~/components/ui/Field";
import { cn } from "~/lib/utils";

type View = "picker" | "form" | "success" | "error";

const CATEGORY_UI: Record<
  SupportCategory,
  { placeholder: string; Icon: typeof MessageSquare; color: string }
> = {
  problem: { placeholder: "I noticed that...", Icon: TriangleAlert, color: "text-dao-amber" },
  idea: { placeholder: "What if...", Icon: Lightbulb, color: "text-dao-sky" },
  other: { placeholder: "I'd like to share...", Icon: MessageSquare, color: "text-soft" },
};

const ICON_BTN =
  "inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-white/50 transition-colors hover:bg-white/10 hover:text-white";

/**
 * Floating "Support" button (bottom right) that opens a small panel: pick a
 * category, write a message (email and a full-page screenshot optional), and
 * it goes to POST /api/support. Modelled on Octo's widget, in this site's
 * glass buttons and navy modal panel. Portaled to <body> after mount so the
 * prerender never sees it. Sits under the site's modals (z 100 vs 200).
 */
export default function SupportWidget() {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>("picker");
  const [category, setCategory] = useState<SupportCategory | null>(null);
  const [email, setEmail] = useState("");
  const [text, setText] = useState("");
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const headingId = useId();
  const panelId = useId();
  const emailId = useId();
  const messageId = useId();

  useEffect(() => setMounted(true), []);

  const reset = useCallback(() => {
    setView("picker");
    setCategory(null);
    setEmail("");
    setText("");
    setScreenshot(null);
    setError(null);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    reset();
  }, [reset]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (!t || panelRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      close();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open, close]);

  useEffect(() => {
    if (open && view === "form") textareaRef.current?.focus();
  }, [open, view]);

  const pick = (c: SupportCategory) => {
    setCategory(c);
    setView("form");
  };

  const back = () => {
    setView("picker");
    setText("");
    setScreenshot(null);
    setError(null);
  };

  const capture = async () => {
    if (capturing) return;
    setCapturing(true);
    setError(null);
    try {
      const { default: html2canvas } = await import("html2canvas-pro");
      const doc = document.documentElement;
      const body = document.body;
      const width = Math.max(doc.scrollWidth, body.scrollWidth, doc.clientWidth);
      const height = Math.max(doc.scrollHeight, body.scrollHeight, doc.clientHeight);
      const canvas = await html2canvas(body, {
        useCORS: true,
        logging: false,
        backgroundColor: "#2c5e86",
        width,
        height,
        windowWidth: width,
        windowHeight: height,
        scrollX: 0,
        scrollY: 0,
        ignoreElements: (el) => el.hasAttribute("data-support-widget"),
      });
      const url = canvas.toDataURL("image/jpeg", 0.7);
      if (url.length > SUPPORT_SCREENSHOT_MAX) {
        setError("The page is too big to attach as a screenshot.");
        return;
      }
      setScreenshot(url);
    } catch (e) {
      setError(e instanceof Error ? `Screenshot failed: ${e.message}` : "Screenshot failed.");
    } finally {
      setCapturing(false);
    }
  };

  const canSend = Boolean(category) && text.trim().length > 0 && !sending;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSend || !category) return;
    setSending(true);
    setError(null);
    try {
      await api("/api/support", {
        json: {
          category,
          email: email.trim(),
          message: text.trim(),
          page: globalThis.location?.pathname ?? "",
          ...(screenshot ? { screenshot } : {}),
        },
      });
      setView("success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't send your message.");
      setView("error");
    } finally {
      setSending(false);
    }
  };

  const title = view === "picker"
    ? "How can we help?"
    : view === "form" && category
    ? SUPPORT_CATEGORIES[category]
    : view === "success"
    ? "Thanks!"
    : "Something went wrong";

  if (!mounted) return null;

  return createPortal(
    <div data-support-widget>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-expanded={open}
        aria-controls={panelId}
        className={cn(
          "btn btn-sm fixed bottom-4 right-4 z-[100] border-edge2 bg-panel shadow-menu",
          "max-[760px]:size-11 max-[760px]:rounded-full max-[760px]:px-0",
        )}
      >
        <MessageSquare className="size-4" />
        <span className="max-[760px]:hidden">Support</span>
      </button>

      {open && (
        <div
          ref={panelRef}
          id={panelId}
          role="dialog"
          aria-modal="false"
          aria-labelledby={headingId}
          className="fixed bottom-[66px] right-4 z-[100] w-[22rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-[18px] border border-edge2 bg-panel-modal shadow-modal animate-in fade-in-0 slide-in-from-bottom-2 duration-200"
        >
          <div className="flex items-center gap-1.5 border-b border-white/[.08] px-3 py-2.5">
            {view === "form"
              ? (
                <button type="button" onClick={back} aria-label="Back" className={ICON_BTN}>
                  <ChevronLeft className="size-4" />
                </button>
              )
              : <span className="size-7 shrink-0" aria-hidden />}
            <h2
              id={headingId}
              className="m-0 flex-1 truncate text-center font-inter-tight text-[15px] font-medium text-white"
            >
              {title}
            </h2>
            <button type="button" onClick={close} aria-label="Close" className={ICON_BTN}>
              <X className="size-4" />
            </button>
          </div>

          {view === "picker" && (
            <div className="flex flex-col gap-2 p-3">
              {SUPPORT_CATEGORY_KEYS.map((c) => {
                const { Icon, color } = CATEGORY_UI[c];
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => pick(c)}
                    className="flex w-full items-center gap-3 rounded-[14px] border border-white/10 bg-white/5 px-3.5 py-2.5 text-left font-inter-tight text-[13.5px] text-white transition-[border-color,box-shadow] duration-150 hover:border-[rgba(92,183,90,.6)] hover:shadow-glow"
                  >
                    <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-white/[.06]">
                      <Icon className={cn("size-4", color)} />
                    </span>
                    {SUPPORT_CATEGORIES[c]}
                  </button>
                );
              })}
            </div>
          )}

          {view === "form" && category && (
            <form onSubmit={submit} className="flex flex-col gap-2.5 p-3">
              <Input
                id={emailId}
                type="email"
                aria-label="Email (optional)"
                placeholder="your@email.com (optional)"
                value={email}
                onChange={(e) =>
                  setEmail(e.target.value)}
                autoComplete="email"
                className="py-2.5 text-[13.5px]"
              />
              <Textarea
                id={messageId}
                ref={textareaRef}
                aria-label="Message"
                value={text}
                onChange={(e) =>
                  setText(e.target.value)}
                placeholder={CATEGORY_UI[category].placeholder}
                rows={4}
                maxLength={SUPPORT_MESSAGE_MAX}
                required
                className="resize-none py-2.5 text-[13.5px]"
              />
              {screenshot && (
                <div className="relative rounded-[14px] border border-white/10 bg-white/5 p-1.5">
                  <div className="max-h-40 overflow-y-auto rounded-[10px]">
                    <img
                      src={screenshot}
                      alt="Screenshot preview"
                      className="block w-full rounded-[10px]"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setScreenshot(null)}
                    disabled={sending}
                    aria-label="Remove screenshot"
                    className="absolute right-2.5 top-2.5 inline-flex size-7 items-center justify-center rounded-full bg-panel-deep/90 text-white/60 shadow-menu transition-colors hover:text-dao-red disabled:opacity-50"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              )}
              <div className="flex items-center gap-2">
                <Button
                  sm
                  onClick={capture}
                  disabled={capturing || sending}
                  aria-label={screenshot ? "Recapture screenshot" : "Attach a screenshot"}
                  title={screenshot ? "Recapture screenshot" : "Attach a screenshot"}
                  className="w-[38px] shrink-0 px-0"
                >
                  {capturing
                    ? <Loader2 className="size-4 animate-spin" />
                    : <Camera className="size-4" />}
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  sm
                  loading={sending}
                  disabled={!canSend}
                  className="flex-1"
                >
                  Send
                </Button>
              </div>
              {error && <p className="m-0 text-[12.5px] text-[#ffb3b1]" role="alert">{error}</p>}
            </form>
          )}

          {view === "success" && (
            <div className="flex flex-col items-center gap-3 px-4 py-6 text-center">
              <CheckCircle2 className="size-10 text-dao-green" />
              <p className="m-0 text-[13px] text-muted">
                Thanks for writing. We read every message.
              </p>
              <Button sm onClick={close} className="w-full">Done</Button>
            </div>
          )}

          {view === "error" && (
            <div className="flex flex-col items-center gap-3 px-4 py-6 text-center">
              <CircleAlert className="size-10 text-dao-red" />
              <p className="m-0 text-[13px] text-muted" role="alert">
                {error ?? "We couldn't send your message."}
              </p>
              <Button
                sm
                onClick={() => {
                  setView("form");
                  setError(null);
                }}
                className="w-full"
              >
                Try again
              </Button>
            </div>
          )}
        </div>
      )}
    </div>,
    document.body,
  );
}
