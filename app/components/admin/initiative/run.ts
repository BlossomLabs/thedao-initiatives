import type { StatusKind } from "~/components/ui/Status";

export type Msg = { kind: StatusKind; text: string } | null;
/** Resolves to whether `fn` succeeded; a failure is already on screen. `ok`
 * may read what `fn` answered to choose its message. */
export type Run = <T>(
  fn: () => Promise<T>,
  ok?: string | ((result: T) => string),
) => Promise<boolean>;
