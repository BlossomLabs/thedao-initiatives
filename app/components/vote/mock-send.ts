import { useCallback, useEffect, useRef, useState } from "react";
import type { Hex } from "viem";
import type { BallotPhase } from "~/lib/vote-flow";

/** How long each step lasts in an example, in ms: long enough to read. */
const STEP_MS: Partial<Record<BallotPhase["kind"], number>> = {
  signing: 1100,
  relaying: 900,
  waiting: 1600,
};
/** A hash of "0x": BallotStatus shows no Etherscan link for it (there is no transaction). */
const NO_TX = "0x" as Hex;

/** An example ballot's Send (mock-round.ts): the same steps as a real one (sign in the
 * wallet, send, record, counted), timed, with nothing signed or sent. `counted` gets the
 * ballot once it "lands", so the page counts it from then on. Same shape as
 * useBallotSubmit's phase, submit, selfSend and retry. */
export function useMockBallotSubmit(counted: (ballot: Hex) => void) {
  const [phase, setPhase] = useState<BallotPhase>({ kind: "idle" });
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const last = useRef<{ ballot: Hex; steps: BallotPhase[] } | null>(null);
  const countedRef = useRef(counted);
  countedRef.current = counted;
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const run = useCallback((ballot: Hex, steps: BallotPhase[]) => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    last.current = { ballot, steps };
    // The first step shows at once, as a click on Send does; the rest follow in time.
    let t = 0;
    steps.forEach((p, i) => {
      if (i === 0) setPhase(p);
      else timers.current.push(setTimeout(() => setPhase(p), t));
      t += STEP_MS[p.kind] ?? 0;
    });
    timers.current.push(setTimeout(() => {
      setPhase({ kind: "counted", hash: NO_TX });
      countedRef.current(ballot);
    }, t));
  }, []);

  /** Through the relayer: sign, send, record. */
  const submit = useCallback(async (_id: bigint, ballot: Hex) => {
    run(ballot, [{ kind: "signing" }, { kind: "relaying" }, { kind: "waiting", hash: NO_TX }]);
  }, [run]);
  /** From the voter's own wallet: sign, confirm the transaction, record. */
  const selfSend = useCallback(async (_id: bigint, ballot: Hex) => {
    run(ballot, [{ kind: "signing" }, { kind: "relaying" }, { kind: "waiting", hash: NO_TX }]);
  }, [run]);
  const retry = useCallback(async () => {
    if (last.current) run(last.current.ballot, last.current.steps);
  }, [run]);
  /** Back to nothing sent (another example opened). */
  const reset = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    last.current = null;
    setPhase({ kind: "idle" });
  }, []);

  return { phase, submit, selfSend, retry, reset, last: null };
}
