import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  parsePledgeAmount,
  PLEDGE_CONTACT_MAX,
  PLEDGE_ORG_MAX,
  SUPPORT_MESSAGE_MAX,
} from "@shared/support";
import { inputMax, tooLong } from "@shared/draft/caps";
import { useBoard } from "~/hooks/use-board";
import { api, errorMessage } from "~/lib/api";
import type { CardInitiative } from "~/lib/api-types";
import { Button } from "~/components/ui/Button";
import InitiativeCombobox from "~/components/ui/InitiativeCombobox";
import { Input, Textarea } from "~/components/ui/Field";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A private pledge enquiry, delivered through the existing Support inbox. */
export default function PledgeSupportForm({ initialInitiativeId, sending, onSending, onSent }: {
  initialInitiativeId?: string | null;
  sending: boolean;
  onSending: (sending: boolean) => void;
  onSent: () => void;
}) {
  const { data, isPending, isError, refetch } = useBoard();
  const initiatives = useMemo(() =>
    (data?.cards ?? []).map((c) => c.initiative)
      .filter((i) => i.status === "approved")
      .sort((a, b) => a.title.localeCompare(b.title)), [data]);
  const [initiative, setInitiative] = useState<CardInitiative | null>(null);
  const [search, setSearch] = useState("");
  const [amount, setAmount] = useState("");
  const [org, setOrg] = useState("");
  const [email, setEmail] = useState("");
  const [contact, setContact] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const inputRef = useRef<HTMLInputElement>(null);
  const orgRef = useRef<HTMLInputElement>(null);
  const sendingRef = useRef(false);
  const initialized = useRef(false);
  const id = useId();

  useEffect(() => {
    if (initialized.current || isPending || isError) return;
    initialized.current = true;
    const selected = initiatives.find((i) => i.id === initialInitiativeId);
    if (selected) {
      setInitiative(selected);
      setSearch(selected.title);
      orgRef.current?.focus();
    } else {
      inputRef.current?.focus();
    }
  }, [initialInitiativeId, initiatives, isPending, isError]);

  const canSend = !sending && Boolean(
    initiative && search === initiative.title && initiatives.some((i) => i.id === initiative.id) &&
      amount.trim() && org.trim() && email.trim() && contact.trim() && message.trim(),
  );
  const clearError = (field: string) => setErrors((prev) => ({ ...prev, [field]: "" }));
  const fieldError = (field: string) =>
    errors[field]
      ? (
        <p id={`${id}-${field}-error`} className="fld-msg fld-err m-0" role="alert">
          {errors[field]}
        </p>
      )
      : null;
  const invalid = (field: string) => ({
    "aria-invalid": Boolean(errors[field]),
    "aria-describedby": errors[field] ? `${id}-${field}-error` : undefined,
  });

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSend || !initiative || sendingRef.current) return;
    const next: Record<string, string> = {};
    const pledgeAmount = parsePledgeAmount(amount);
    if (pledgeAmount === null) {
      next.amount = "Enter a pledge amount between $0.01 and $100,000,000 (USD).";
    }
    if (org.trim().length > PLEDGE_ORG_MAX) next.org = tooLong("The pledge org", PLEDGE_ORG_MAX);
    if (contact.trim().length > PLEDGE_CONTACT_MAX) {
      next.contact = tooLong("The contact name", PLEDGE_CONTACT_MAX);
    }
    if (email.trim().length > 200 || !EMAIL_RE.test(email.trim())) {
      next.email = "Enter a valid pledge contact email.";
    }
    if (message.trim().length > SUPPORT_MESSAGE_MAX) {
      next.message = tooLong("The message", SUPPORT_MESSAGE_MAX);
    }
    setErrors(next);
    if (Object.keys(next).length) return;
    setError(null);
    sendingRef.current = true;
    onSending(true);
    try {
      await api("/api/support", {
        json: {
          category: "pledge",
          initiativeId: initiative.id,
          pledgeAmount,
          pledgeOrg: org.trim(),
          email: email.trim(),
          pledgeContact: contact.trim(),
          message: message.trim(),
          page: globalThis.location?.pathname ?? "",
        },
      });
      onSent();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      sendingRef.current = false;
      onSending(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      noValidate
      className="flex max-h-[calc(100dvh-10rem)] flex-col gap-3 overflow-y-auto p-3"
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor={id + "-initiative"} className="text-[12.5px] text-white/80">
          Initiative
        </label>
        <InitiativeCombobox
          id={id + "-initiative"}
          items={initiatives}
          value={initiative}
          onValueChange={setInitiative}
          inputValue={search}
          onInputValueChange={setSearch}
          inputRef={inputRef}
          required
          disabled={sending || isPending || isError}
          placeholder={isPending ? "Loading initiatives…" : "Search by initiative name…"}
          popupProps={{
            "data-support-widget": true,
            onKeyDown: (e) => {
              if (e.key === "Escape") e.stopPropagation();
            },
          } as React.ComponentProps<typeof InitiativeCombobox>["popupProps"]}
        />
        {isError && (
          <p className="m-0 text-[12.5px] text-dao-red" role="alert">
            Couldn’t load initiatives.{" "}
            <button type="button" className="underline" onClick={() => void refetch()}>
              Try again
            </button>
          </p>
        )}
        {!isPending && !isError && !initiatives.length && (
          <p className="m-0 text-[12.5px] text-muted">No initiatives are available for pledges.</p>
        )}
      </div>
      <label className="flex flex-col gap-1.5 text-[12.5px] text-white/80">
        Pledge Organization
        <Input
          ref={orgRef}
          autoComplete="organization"
          placeholder="e.g. Acme Foundation"
          required
          maxLength={inputMax(PLEDGE_ORG_MAX)}
          disabled={sending}
          value={org}
          onChange={(e) => {
            setOrg(e.target.value);
            clearError("org");
          }}
          {...invalid("org")}
          className="py-2.5 text-[13.5px]"
        />
      </label>
      {fieldError("org")}
      <label className="flex flex-col gap-1.5 text-[12.5px] text-white/80">
        Pledge Amount (USD)
        <Input
          inputMode="decimal"
          placeholder="e.g. 25,000"
          required
          maxLength={30}
          disabled={sending}
          value={amount}
          onChange={(e) => {
            setAmount(e.target.value);
            clearError("amount");
          }}
          {...invalid("amount")}
          className="py-2.5 text-[13.5px]"
        />
      </label>
      {fieldError("amount")}
      <label className="flex flex-col gap-1.5 text-[12.5px] text-white/80">
        Pledge Contact Email
        <Input
          type="email"
          autoComplete="email"
          placeholder="alex@example.org"
          required
          maxLength={inputMax(200)}
          disabled={sending}
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            clearError("email");
          }}
          {...invalid("email")}
          className="py-2.5 text-[13.5px]"
        />
      </label>
      {fieldError("email")}
      <label className="flex flex-col gap-1.5 text-[12.5px] text-white/80">
        Who are you talking with?
        <Input
          autoComplete="name"
          placeholder="e.g. Jake from TheDAO"
          required
          maxLength={inputMax(PLEDGE_CONTACT_MAX)}
          disabled={sending}
          value={contact}
          onChange={(e) => {
            setContact(e.target.value);
            clearError("contact");
          }}
          {...invalid("contact")}
          className="py-2.5 text-[13.5px]"
        />
      </label>
      {fieldError("contact")}
      <label className="flex flex-col gap-1.5 text-[12.5px] text-white/80">
        Message
        <Textarea
          placeholder="Tell us about your pledge, any conditions, and next steps."
          required
          rows={3}
          maxLength={inputMax(SUPPORT_MESSAGE_MAX)}
          disabled={sending}
          value={message}
          onChange={(e) => {
            setMessage(e.target.value);
            clearError("message");
          }}
          {...invalid("message")}
          className="resize-none py-2.5 text-[13.5px]"
        />
      </label>
      {fieldError("message")}
      <Button type="submit" variant="primary" sm loading={sending} disabled={!canSend}>
        Send pledge request
      </Button>
      {error && <p className="m-0 text-[12.5px] text-dao-red" role="alert">{error}</p>}
    </form>
  );
}
