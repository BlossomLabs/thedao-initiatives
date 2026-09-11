/**
 * Label + control + findings for one field id. The control gets
 * id="f-<field>", has-error / has-warn and aria-invalid; the wrapper carries
 * data-field so the checks card can jump to it.
 */
import { cloneElement, isValidElement } from "react";
import { Label } from "~/components/ui/Field";
import { cn } from "~/lib/utils";
import { domId, FieldMsg, useFinding } from "./findings";

export interface ControlProps {
  id: string;
  className?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
}

export default function FormField({
  field,
  label,
  required,
  hint,
  privateField,
  className,
  children,
}: {
  field: string;
  label: string;
  required?: boolean;
  hint?: React.ReactNode;
  privateField?: boolean;
  className?: string;
  /** The control, or a render function receiving the props to spread on it. */
  children: React.ReactElement<ControlProps> | ((p: ControlProps) => React.ReactNode);
}) {
  const f = useFinding(field);
  const id = domId(field);
  const msgId = f.errors.length || f.warnings.length ? id + "-msg" : undefined;
  const props: ControlProps = {
    id,
    className: f.cls,
    "aria-invalid": f.errors.length ? true : undefined,
    "aria-describedby": msgId,
  };
  return (
    <div className={cn("mt-[18px] first:mt-3", className)} data-field={field}>
      <Label
        label={label}
        htmlFor={id}
        required={required}
        privateField={privateField}
        hint={hint}
      />
      <div className="mt-1.5">
        {typeof children === "function"
          ? children(props)
          : isValidElement(children)
          ? cloneElement(children, {
            ...props,
            className: cn(children.props.className, props.className),
          })
          : children}
      </div>
      <FieldMsg field={field} id={msgId} />
    </div>
  );
}
