import { cn } from "~/lib/utils";

export type StatusKind = "ok" | "err" | "wait";

export default function Status(
  { kind, children, className }: {
    kind: StatusKind;
    children: React.ReactNode;
    className?: string;
  },
) {
  return (
    <div
      className={cn("status", `status-${kind}`, className)}
      role={kind === "err" ? "alert" : "status"}
    >
      {children}
    </div>
  );
}
