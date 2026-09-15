import { cn } from "~/lib/utils";

/** A group heading on the form: green kicker plus one line of explanation. */
export default function FormGroup(
  { title, children, className, id }: {
    title: string;
    children?: React.ReactNode;
    className?: string;
    id?: string;
  },
) {
  return (
    <div id={id} className={cn("mt-10 border-t border-white/10 pt-6", className)}>
      <span className="k mb-1.5">{title}</span>
      {children && (
        <p className="m-0 max-w-[640px] font-inter-tight text-[13.5px] font-light leading-[1.55] text-muted">
          {children}
        </p>
      )}
    </div>
  );
}
