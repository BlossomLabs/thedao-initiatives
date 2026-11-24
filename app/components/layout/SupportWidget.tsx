import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Camera,
  CheckCircle2,
  ChevronLeft,
  CircleAlert,
  Handshake,
  Lightbulb,
  Loader2,
  MessageSquare,
  ReceiptText,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import {
  RECEIPT_ADDRESS_MAX,
  RECEIPT_COUNTRY_MAX,
  RECEIPT_ISSUED_TO,
  RECEIPT_NAME_MAX,
  RECEIPT_NOTE,
  type ReceiptIssuedTo,
  receiptTransactionError,
  SUPPORT_CATEGORIES,
  SUPPORT_CATEGORY_KEYS,
  SUPPORT_MESSAGE_MAX,
  SUPPORT_SCREENSHOT_MAX,
  SUPPORT_TRANSACTION_URL_MAX,
  type SupportCategory,
} from "@shared/support";
import { inputMax, tooLong } from "@shared/draft/caps";
import { api, ApiError, errorMessage } from "~/lib/api";
import { useSiteSettings } from "~/hooks/use-site-settings";
import { Button } from "~/components/ui/Button";
import { Input, Textarea } from "~/components/ui/Field";
import Pop from "~/components/ui/Pop";
import { cn } from "~/lib/utils";
import { onPledgeRequest, onReceiptRequest } from "~/lib/support";
import PledgeSupportForm from "./PledgeSupportForm";

type View = "picker" | "form" | "success" | "error";

const CATEGORY_UI: Record<
  SupportCategory,
  { placeholder: string; Icon: typeof MessageSquare; color: string }
> = {
  problem: { placeholder: "I noticed that...", Icon: TriangleAlert, color: "text-dao-amber" },
  idea: { placeholder: "What if...", Icon: Lightbulb, color: "text-dao-sky" },
  receipt: {
    placeholder: "Anything else we should know? (optional)",
    Icon: ReceiptText,
    color: "text-dao-green",
  },
  pledge: { placeholder: "Tell us about your pledge.", Icon: Handshake, color: "text-dao-green" },
  other: { placeholder: "I'd like to share...", Icon: MessageSquare, color: "text-soft" },
};

/** The same loose shape the server checks; a typo is caught before sending. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const ISSUED_TO_KEYS = Object.keys(RECEIPT_ISSUED_TO) as ReceiptIssuedTo[];

const LABEL = "text-[12.5px] text-white/80";

const ICON_BTN =
  "inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-white/50 transition-colors hover:bg-white/10 hover:text-white";

/** Where the floating button sits off the viewport's bottom, in px, and its panel above it. */
const BUTTON_BOTTOM = 16;
const PANEL_BOTTOM = 66;

/**
 * How far the floating button and its panel rise, in px: 0 until the footer's legal bar
 * (the darker band at the very bottom) reaches the button, then the bar's height, so the
 * button rests right above it. Two places,
 * not one per scrolled pixel; the move between them is a CSS transition.
 */
export function useFooterLift(): number {
  const [lift, setLift] = useState(0);
  useEffect(() => {
    const footer = document.querySelector("[data-site-footer]");
    if (!footer || typeof IntersectionObserver === "undefined") return;
    // From the bar's top to the page's end.
    const height = () =>
      Math.round(
        document.documentElement.scrollHeight -
          (footer.getBoundingClientRect().top + globalThis.scrollY),
      );
    // The bottom strip the button stands in: the footer "reaches it" on entering it.
    const io = new IntersectionObserver(
      ([entry]) => setLift(entry.isIntersecting ? height() : 0),
      { rootMargin: `0px 0px -${BUTTON_BOTTOM + 44}px 0px` },
    );
    io.observe(footer);
    return () => io.disconnect();
  }, []);
  return lift;
}

/**
 * Floating "Support" button (bottom right), only once the site settings say
 * SUPPORT_URL is configured: without a destination there is nothing to show.
 */
export default function SupportWidget() {
  const { data } = useSiteSettings();
  if (!data?.support) return null;
  return <SupportPanel />;
}

/**
 * The button and its panel: pick a category, write a message (email and a
 * full-page screenshot optional), and it goes to POST /api/support. Modelled
 * on Octo's widget, in this site's glass buttons and navy modal panel.
 * Portaled to <body> after mount so the prerender never sees it. Sits under
 * the site's modals (z 100 vs 200).
 */
export function SupportPanel() {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const lift = useFooterLift();
  const [view, setView] = useState<View>("picker");
  const [category, setCategory] = useState<SupportCategory | null>(null);
  const [email, setEmail] = useState("");
  const [transactionUrl, setTransactionUrl] = useState("");
  const [issuedTo, setIssuedTo] = useState<ReceiptIssuedTo | null>(null);
  const [legalName, setLegalName] = useState("");
  const [country, setCountry] = useState("");
  const [address, setAddress] = useState("");
  /** Under-the-field errors for the receipt details, by field. */
  const [receiptErrors, setReceiptErrors] = useState<Record<string, string>>({});
  const [pledgeInitiative, setPledgeInitiative] = useState<string | null>(null);
  /** The amount the pledge form opens with, when the request named one. */
  const [pledgeAmount, setPledgeAmount] = useState<number | null>(null);
  const [text, setText] = useState("");
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [transactionError, setTransactionError] = useState<string | null>(null);
  const receipt = category === "receipt";
  const pledge = category === "pledge";

  const formRef = useRef<HTMLFormElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const headingId = useId();
  const panelId = useId();
  const emailId = useId();
  const transactionId = useId();
  const receiptId = useId();
  const messageId = useId();

  useEffect(() => setMounted(true), []);

  const clearReceiptDetails = useCallback(() => {
    setIssuedTo(null);
    setLegalName("");
    setCountry("");
    setAddress("");
    setReceiptErrors({});
  }, []);

  const reset = useCallback(() => {
    setView("picker");
    setCategory(null);
    setEmail("");
    setTransactionUrl("");
    clearReceiptDetails();
    setPledgeInitiative(null);
    setPledgeAmount(null);
    setText("");
    setScreenshot(null);
    setError(null);
    setEmailError(null);
    setTransactionError(null);
  }, [clearReceiptDetails]);

  const close = useCallback(() => {
    setOpen(false);
    reset();
  }, [reset]);

  useEffect(() =>
    onReceiptRequest((url) => {
      if (sending) return;
      setCategory("receipt");
      setTransactionUrl(url);
      setText("");
      setScreenshot(null);
      setError(null);
      setEmailError(null);
      setTransactionError(null);
      setReceiptErrors({});
      setView("form");
      setOpen(true);
      // Also focus when a receipt form is already open for another donation.
      formRef.current?.querySelector("input")?.focus();
    }), [sending]);

  useEffect(() =>
    onPledgeRequest((initiativeId, amountUsd) => {
      if (sending) return;
      reset();
      setPledgeInitiative(initiativeId);
      setPledgeAmount(amountUsd);
      setCategory("pledge");
      setView("form");
      setOpen(true);
    }), [sending, reset]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) close();
    };
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (
        !t || panelRef.current?.contains(t) || triggerRef.current?.contains(t) ||
        (t instanceof Element && t.closest("[data-support-widget]"))
      ) return;
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
    if (open && view === "form") {
      if (receipt) formRef.current?.querySelector("input")?.focus();
      else textareaRef.current?.focus();
    }
  }, [open, view, receipt]);

  const pick = (c: SupportCategory) => {
    setCategory(c);
    setView("form");
  };

  const back = () => {
    setView("picker");
    setText("");
    setTransactionUrl("");
    clearReceiptDetails();
    setPledgeInitiative(null);
    setScreenshot(null);
    setError(null);
    setEmailError(null);
    setTransactionError(null);
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

  const overCap = text.trim().length > SUPPORT_MESSAGE_MAX;
  const canSend = Boolean(category) && !overCap && !sending &&
    (receipt
      ? Boolean(
        email.trim() && transactionUrl.trim() && issuedTo && legalName.trim() && country.trim(),
      )
      : text.trim().length > 0);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSend || !category) return;
    setError(null);
    // Checked here, under the field, rather than by the browser's own bubble.
    const badEmail = email.trim().length > 200
      ? tooLong("The email", 200)
      : email.trim() && !EMAIL_RE.test(email.trim())
      ? receipt
        ? "Enter a valid email for the receipt."
        : "That email does not look right. Fix it, or leave it blank."
      : null;
    const badTransaction = receipt ? receiptTransactionError(transactionUrl) : null;
    const badReceipt: Record<string, string> = {};
    if (receipt) {
      if (legalName.trim().length > RECEIPT_NAME_MAX) {
        badReceipt.name = tooLong("The legal name", RECEIPT_NAME_MAX);
      }
      if (country.trim().length > RECEIPT_COUNTRY_MAX) {
        badReceipt.country = tooLong("The country", RECEIPT_COUNTRY_MAX);
      }
      if (address.trim().length > RECEIPT_ADDRESS_MAX) {
        badReceipt.address = tooLong("The address", RECEIPT_ADDRESS_MAX);
      }
    }
    setEmailError(badEmail);
    setTransactionError(badTransaction);
    setReceiptErrors(badReceipt);
    if (badEmail || badTransaction || Object.keys(badReceipt).length) return;
    setSending(true);
    try {
      await api("/api/support", {
        json: {
          category,
          email: email.trim(),
          ...(receipt
            ? {
              transactionUrl: transactionUrl.trim(),
              receiptIssuedTo: issuedTo,
              receiptName: legalName.trim(),
              receiptCountry: country.trim(),
              receiptAddress: address.trim(),
            }
            : {}),
          message: text.trim(),
          page: globalThis.location?.pathname ?? "",
          ...(screenshot ? { screenshot } : {}),
        },
      });
      setView("success");
    } catch (err) {
      setError(err instanceof Error ? errorMessage(err) : "We couldn't send your message.");
      // Something the sender can fix stays in the form, with what they typed.
      if (!(err instanceof ApiError && err.status === 400)) setView("error");
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
      {/* The wrapper rises above the footer; the button keeps .btn's own transitions. */}
      <div
        className="fixed right-4 z-[100] flex transition-[bottom] duration-500 ease-out motion-reduce:transition-none"
        style={{ bottom: BUTTON_BOTTOM + lift }}
      >
        <button
          ref={triggerRef}
          type="button"
          onClick={() => (open ? close() : setOpen(true))}
          aria-expanded={open}
          aria-controls={panelId}
          className={cn(
            "btn btn-sm border-edge2 bg-panel shadow-menu",
            "max-[760px]:size-11 max-[760px]:rounded-full max-[760px]:px-0",
          )}
        >
          <MessageSquare className="size-4" />
          <span className="max-[760px]:hidden">Support</span>
        </button>
      </div>

      <Pop
        show={open}
        from="rise"
        ref={panelRef}
        id={panelId}
        role="dialog"
        aria-modal="false"
        aria-labelledby={headingId}
        style={{ bottom: PANEL_BOTTOM + lift }}
        className="fixed right-4 transition-[bottom] duration-500 ease-out motion-reduce:transition-none z-[100] w-[22rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-[18px] border border-edge2 bg-panel-modal shadow-modal"
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

        {view === "form" && pledge && (
          <PledgeSupportForm
            key={`${pledgeInitiative ?? "picker"}:${pledgeAmount ?? ""}`}
            initialInitiativeId={pledgeInitiative}
            initialAmountUsd={pledgeAmount}
            sending={sending}
            onSending={setSending}
            onSent={() => setView("success")}
          />
        )}

        {view === "form" && category && !pledge && (
          <form
            ref={formRef}
            onSubmit={submit}
            noValidate
            className="flex max-h-[calc(100dvh-10rem)] flex-col gap-2.5 overflow-y-auto p-3"
          >
            {receipt && (
              <>
                <p className="m-0 text-[13px] text-muted">
                  Tell us who the receipt is for and which donation it covers.
                </p>
                <label htmlFor={emailId} className={LABEL}>
                  Email
                </label>
              </>
            )}
            <Input
              id={emailId}
              type="email"
              aria-label={receipt ? "Email" : "Email (optional)"}
              placeholder={receipt ? "your@email.com" : "your@email.com (optional)"}
              required={receipt}
              maxLength={inputMax(200)}
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setEmailError(null);
              }}
              autoComplete="email"
              aria-invalid={Boolean(emailError)}
              aria-describedby={emailError ? emailId + "-msg" : undefined}
              className={cn("py-2.5 text-[13.5px]", emailError && "has-error")}
            />
            {emailError && (
              <p id={emailId + "-msg"} className="fld-msg fld-err -mt-1" role="alert">
                {emailError}
              </p>
            )}
            {receipt && (
              <>
                <label htmlFor={transactionId} className={LABEL}>
                  Transaction link
                </label>
                <Input
                  id={transactionId}
                  type="url"
                  inputMode="url"
                  placeholder="https://eth.blockscout.com/tx/…"
                  value={transactionUrl}
                  onChange={(e) => {
                    setTransactionUrl(e.target.value);
                    setTransactionError(null);
                  }}
                  required
                  maxLength={inputMax(SUPPORT_TRANSACTION_URL_MAX)}
                  aria-invalid={Boolean(transactionError)}
                  aria-describedby={transactionError ? transactionId + "-msg" : undefined}
                  className={cn("py-2.5 text-[13.5px]", transactionError && "has-error")}
                />
                {transactionError && (
                  <p id={transactionId + "-msg"} className="fld-msg fld-err -mt-1" role="alert">
                    {transactionError}
                  </p>
                )}
                <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
                  <legend className={cn(LABEL, "mb-1.5 p-0")}>Receipt issued to</legend>
                  <div className="flex gap-2">
                    {ISSUED_TO_KEYS.map((k) => (
                      <label
                        key={k}
                        className={cn(
                          "flex flex-1 cursor-pointer items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-3 py-2 font-inter-tight text-[13px] text-white transition-colors duration-150 hover:border-[rgba(92,183,90,.45)]",
                          issuedTo === k && "border-dao-green text-dao-green",
                        )}
                      >
                        <input
                          type="radio"
                          name={receiptId + "-issued-to"}
                          value={k}
                          checked={issuedTo === k}
                          onChange={() => setIssuedTo(k)}
                          required
                        />
                        {RECEIPT_ISSUED_TO[k]}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <ReceiptField
                  id={receiptId + "-name"}
                  label="Legal name"
                  error={receiptErrors.name}
                >
                  <Input
                    id={receiptId + "-name"}
                    placeholder={issuedTo === "organization"
                      ? "e.g. Acme Foundation"
                      : "Your full legal name"}
                    autoComplete={issuedTo === "organization" ? "organization" : "name"}
                    required
                    maxLength={inputMax(RECEIPT_NAME_MAX)}
                    value={legalName}
                    onChange={(e) => {
                      setLegalName(e.target.value);
                      setReceiptErrors((p) => ({ ...p, name: "" }));
                    }}
                    {...invalid(receiptId + "-name", receiptErrors.name)}
                  />
                </ReceiptField>
                <ReceiptField
                  id={receiptId + "-country"}
                  label="Country"
                  error={receiptErrors.country}
                >
                  <Input
                    id={receiptId + "-country"}
                    placeholder="e.g. Switzerland"
                    autoComplete="country-name"
                    required
                    maxLength={inputMax(RECEIPT_COUNTRY_MAX)}
                    value={country}
                    onChange={(e) => {
                      setCountry(e.target.value);
                      setReceiptErrors((p) => ({ ...p, country: "" }));
                    }}
                    {...invalid(receiptId + "-country", receiptErrors.country)}
                  />
                </ReceiptField>
                <ReceiptField
                  id={receiptId + "-address"}
                  label="Address (optional)"
                  error={receiptErrors.address}
                >
                  <Input
                    id={receiptId + "-address"}
                    placeholder="Street, city, postcode"
                    autoComplete="street-address"
                    maxLength={inputMax(RECEIPT_ADDRESS_MAX)}
                    value={address}
                    onChange={(e) => {
                      setAddress(e.target.value);
                      setReceiptErrors((p) => ({ ...p, address: "" }));
                    }}
                    {...invalid(receiptId + "-address", receiptErrors.address)}
                  />
                </ReceiptField>
              </>
            )}
            <Textarea
              id={messageId}
              ref={textareaRef}
              aria-label={receipt ? "Message (optional)" : "Message"}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={CATEGORY_UI[category].placeholder}
              rows={receipt ? 2 : 4}
              maxLength={inputMax(SUPPORT_MESSAGE_MAX)}
              required={!receipt}
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
              {!receipt && (
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
              )}
              <Button
                type="submit"
                variant="primary"
                sm
                loading={sending}
                disabled={!canSend}
                className="flex-1"
              >
                {receipt ? "Send request" : "Send"}
              </Button>
            </div>
            {receipt && <p className="m-0 text-[12px] leading-[1.5] text-muted">{RECEIPT_NOTE}</p>}
            {overCap && (
              <p className="m-0 text-[12.5px] text-[#ffb3b1]" role="alert">
                {tooLong("The message", SUPPORT_MESSAGE_MAX)}
              </p>
            )}
            {error && <p className="m-0 text-[12.5px] text-[#ffb3b1]" role="alert">{error}</p>}
          </form>
        )}

        {view === "success" && (
          <div className="flex flex-col items-center gap-3 px-4 py-6 text-center">
            <CheckCircle2 className="size-10 text-dao-green" />
            <p className="m-0 text-[13px] text-muted">
              {receipt
                ? "Your donation receipt request has been sent."
                : pledge
                ? "Your pledge request has been sent. We’ll be in touch."
                : "Thanks for writing. We read every message."}
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
      </Pop>
    </div>,
    document.body,
  );
}

/** aria for a receipt field, pointing at its error line when it has one. */
function invalid(id: string, error: string | undefined) {
  return {
    "aria-invalid": Boolean(error),
    "aria-describedby": error ? id + "-msg" : undefined,
    className: cn("py-2.5 text-[13.5px]", error && "has-error"),
  };
}

function ReceiptField(
  { id, label, error, children }: {
    id: string;
    label: string;
    error?: string;
    children: React.ReactNode;
  },
) {
  return (
    <>
      <label htmlFor={id} className={LABEL}>{label}</label>
      {children}
      {error && <p id={id + "-msg"} className="fld-msg fld-err -mt-1" role="alert">{error}</p>}
    </>
  );
}
