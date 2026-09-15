import { OTPInput, REGEXP_ONLY_DIGITS, type SlotProps } from "input-otp";
import { cn } from "~/lib/utils";

/**
 * One-time-code field in the site's input style: one slot per digit, a
 * single hidden input underneath (paste, autofill and mobile keyboards all
 * work as on a normal input). Same building block as shadcn's InputOTP.
 */
export function InputOTP({
  length = 6,
  value,
  onChange,
  onComplete,
  disabled,
  id,
  autoFocus,
  className,
}: {
  length?: number;
  value: string;
  onChange: (value: string) => void;
  onComplete?: (value: string) => void;
  disabled?: boolean;
  id?: string;
  autoFocus?: boolean;
  className?: string;
}) {
  return (
    <OTPInput
      id={id}
      maxLength={length}
      value={value}
      onChange={onChange}
      onComplete={onComplete}
      disabled={disabled}
      autoFocus={autoFocus}
      inputMode="numeric"
      pattern={REGEXP_ONLY_DIGITS}
      autoComplete="one-time-code"
      containerClassName={cn("flex items-center gap-2 has-[:disabled]:opacity-50", className)}
      render={({ slots }) => (
        <>
          {slots.map((slot, i) => <Slot key={i} {...slot} />)}
        </>
      )}
    />
  );
}

function Slot({ char, isActive, hasFakeCaret }: SlotProps) {
  return (
    <div
      className={cn(
        "relative flex h-12 flex-1 items-center justify-center rounded-[12px] border border-white/15 bg-white/5 font-inter-tight text-[18px] text-white transition-colors duration-150",
        isActive && "border-[rgba(92,183,90,.6)]",
      )}
    >
      {char}
      {hasFakeCaret && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-5 w-px animate-caret-blink bg-white duration-1000" />
        </div>
      )}
    </div>
  );
}
