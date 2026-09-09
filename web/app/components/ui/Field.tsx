import { cn } from "~/lib/utils";

interface LabelProps {
  label: string;
  htmlFor?: string;
  required?: boolean;
  privateField?: boolean;
  hint?: React.ReactNode;
}

export function Label({ label, htmlFor, required, privateField, hint }: LabelProps) {
  return (
    <label className="label" htmlFor={htmlFor}>
      {label}
      {required && " *"}
      {privateField && <span className="priv">🔒 Private, never published</span>}
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

export function Input({ className, ...rest }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn("field", className)} {...rest} />;
}

export function Textarea(
  { className, ...rest }: React.TextareaHTMLAttributes<HTMLTextAreaElement>,
) {
  return <textarea className={cn("field", className)} {...rest} />;
}

export function Select(
  { className, children, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement>,
) {
  return (
    <select className={cn("field", className)} {...rest}>
      {children}
    </select>
  );
}

/** Label + control in one (Figma form: 12px label margin + 6px column gap). */
export function Field({
  children,
  ...label
}: LabelProps & { children: React.ReactNode }) {
  return (
    <div className="mt-[18px] first:mt-3">
      <Label {...label} />
      <div className="mt-1.5">{children}</div>
    </div>
  );
}
