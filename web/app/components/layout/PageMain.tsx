import { cn } from "~/lib/utils";

/** Page column (Figma): 1100px max with 24px padding; `narrow` = the 672px form column. */
export default function PageMain({
  children,
  narrow,
  center,
  detail,
  className,
}: {
  children: React.ReactNode;
  narrow?: boolean;
  center?: boolean;
  detail?: boolean;
  className?: string;
}) {
  return (
    <main
      className={cn(
        "mx-auto px-6 pb-20 pt-1.5",
        narrow ? "max-w-[672px]" : "max-w-[1100px]",
        detail && "pt-[34px]",
        center && "text-center",
        className,
      )}
    >
      {children}
    </main>
  );
}
