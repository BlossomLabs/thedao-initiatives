import type { StatusKind } from "~/components/ui/Status";

export type Msg = { kind: StatusKind; text: string } | null;
/** Resolves to whether `fn` succeeded; a failure is already on screen. */
export type Run = (fn: () => Promise<unknown>, ok?: string) => Promise<boolean>;
