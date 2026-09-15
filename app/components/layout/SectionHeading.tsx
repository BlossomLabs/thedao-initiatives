import { cn } from "~/lib/utils";

export default function SectionHeading({
  children,
  count,
  id,
  className,
}: {
  children: React.ReactNode;
  count?: number | string;
  id?: string;
  className?: string;
}) {
  return (
    <h2 id={id} className={cn("h2", className)}>
      {children}
      {count !== undefined && count !== "" && <span className="n">({count})</span>}
    </h2>
  );
}
