/**
 * A money field: free typing ("150,000", "$150k" is not read, "150.000" is),
 * the parsed amount echoed under it, and the value tidied to "150,000" on
 * blur. The string stays in the draft; parseAmount reads it at the edges.
 */
import { parseAmount, usd } from "@shared/draft/mod";
import { Input } from "~/components/ui/Field";
import { cn } from "~/lib/utils";
import { money } from "./useDraft";

export default function AmountInput({
  value,
  onChange,
  className,
  echoClassName,
  ...rest
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> & {
  value: string;
  onChange: (value: string) => void;
  echoClassName?: string;
}) {
  const n = parseAmount(value);
  return (
    <div>
      <Input
        inputMode="decimal"
        autoComplete="off"
        {...rest}
        className={cn("mono text-[14px]", className)}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={(e) => {
          if (n) onChange(money(n));
          rest.onBlur?.(e);
        }}
      />
      <span
        className={cn("mt-1 block min-h-[18px] small dim tnum", echoClassName)}
        aria-live="polite"
      >
        {n ? usd(n) : ""}
      </span>
    </div>
  );
}
