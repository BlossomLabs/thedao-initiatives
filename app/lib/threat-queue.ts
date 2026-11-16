/** Works out green rows' jumps (and a typed amount's number) ahead of a click, one job at a
 * time, in the order the page wants them: a typed amount, the open row, the visible green
 * rows, then the rest. No Worker or DOM here: the worker (app/workers/threat.worker.ts)
 * and the page's fallback (app/hooks/use-threat-jumps.ts) both run this. */
import type { ChainInputs } from "../../shared/vote/chain";
import { liveInputsFrom, type LiveInputsJson } from "../../shared/vote/live-inputs";
import { withGift } from "../../shared/vote/next-tier";
import { jumpsAsync, threatOfAsync } from "../../shared/vote/threat";

/** A suggestion in whole dollars; `threat` null when none was found after it, not safe. */
export type JumpUsd = { usd: number; threat: number | null };

/** What the queue sends out, each on the figures (`key`) it was worked out on. */
export type QueueEvent =
  | { kind: "jumps"; key: string; c: number; jumps: JumpUsd[] }
  | { kind: "typed"; key: string; c: number; given: number; threat: number | null | undefined };

/** Page → worker. */
export type ThreatMsg =
  | { type: "inputs"; key: string; inputs: LiveInputsJson }
  | { type: "order"; open: number | undefined; visible: number[]; rest: number[] }
  | { type: "typed"; c: number; given: number | undefined }
  | { type: "pause" }
  | { type: "resume" };

/** A job slice before handing the event loop back, ms. */
const SLICE_MS = 10;

/** Micro-USD (multiples of $10) to whole dollars. */
const dollars = (v: bigint) => Number(v / 1_000_000n);

type Job =
  | { kind: "jumps"; c: number; ctl: AbortController }
  | { kind: "typed"; c: number; given: number; ctl: AbortController };

export class ThreatQueue {
  #key: string | undefined;
  #round: { inp: ChainInputs; first: number } | undefined;
  #done = new Set<number>();
  #open: number | undefined;
  #visible: number[] = [];
  #rest: number[] = [];
  /** The standing typed amount; `#typedDone` names it (`c:given`) once worked out for `#key`. */
  #typed: { c: number; given: number } | undefined;
  #typedDone: string | undefined;
  #job: Job | undefined;
  #paused = false;
  #stopped = false;

  constructor(
    private emit: (e: QueueEvent) => void,
    private work: { jumps: typeof jumpsAsync; threatOf: typeof threatOfAsync } = {
      jumps: jumpsAsync,
      threatOf: threatOfAsync,
    },
  ) {}

  /** New figures: everything in hand or under way is dropped; the order starts again. */
  setInputs(key: string, inputs: LiveInputsJson): void {
    if (key === this.#key) return;
    this.#abort();
    this.#key = key;
    this.#round = liveInputsFrom(inputs);
    this.#done.clear();
    this.#typedDone = undefined;
    this.#pump();
  }

  setOrder(open: number | undefined, visible: number[], rest: number[]): void {
    this.#open = open;
    this.#visible = visible;
    this.#rest = rest;
    // A newly opened row goes ahead of the row under way, which is done again later.
    const job = this.#job;
    if (job?.kind === "jumps" && open !== undefined && job.c !== open && !this.#done.has(open)) {
      this.#abort();
    }
    this.#pump();
  }

  /** The amount typed for row `c`, whole dollars; undefined cancels it. */
  typed(c: number, given: number | undefined): void {
    const next = given === undefined ? undefined : { c, given };
    const job = this.#job;
    const running = job?.kind === "typed" && next && job.c === next.c && job.given === next.given;
    this.#typed = next;
    // Already worked out for these figures, or under way: nothing to redo or interrupt.
    if (running || (next && this.#typedDone === `${next.c}:${next.given}`)) return;
    if (job && (next || job.kind === "typed")) this.#abort();
    this.#pump();
  }

  /** Nothing starts while paused; a job under way stops and is done again on resuming. */
  pause(): void {
    this.#paused = true;
    this.#abort();
  }

  resume(): void {
    this.#paused = false;
    this.#pump();
  }

  stop(): void {
    this.#stopped = true;
    this.#abort();
  }

  #abort() {
    this.#job?.ctl.abort(new DOMException("No longer wanted", "AbortError"));
    this.#job = undefined;
  }

  #next(): { kind: "typed"; c: number; given: number } | { kind: "jumps"; c: number } | undefined {
    const round = this.#round!;
    if (this.#typed && this.#typedDone !== `${this.#typed.c}:${this.#typed.given}`) {
      // An amount covering the whole ask is the page's to show; nothing to work out.
      if (BigInt(this.#typed.given) * 1_000_000n < round.inp.costs[this.#typed.c]) {
        return { kind: "typed", ...this.#typed };
      }
    }
    const order = [this.#open, ...this.#visible, ...this.#rest];
    const c = order.find((c) => c !== undefined && !this.#done.has(c));
    return c === undefined ? undefined : { kind: "jumps", c };
  }

  #pump() {
    if (this.#paused || this.#stopped || this.#job || !this.#round || this.#key === undefined) {
      return;
    }
    const next = this.#next();
    if (!next) return;
    const ctl = new AbortController();
    const job: Job = { ...next, ctl };
    this.#job = job;
    const key = this.#key, { inp, first } = this.#round;
    const opts = { sliceMs: SLICE_MS, signal: ctl.signal };
    const run: Promise<QueueEvent> = job.kind === "typed"
      ? this.work
        .threatOf(withGift(inp, job.c, BigInt(job.given) * 1_000_000n), first, job.c, opts)
        .then((v) => ({
          kind: "typed",
          key,
          c: job.c,
          given: job.given,
          threat: v === null || v === undefined ? v : dollars(v),
        }))
      : this.work.jumps(inp, first, job.c, opts).then((js) => ({
        kind: "jumps",
        key,
        c: job.c,
        jumps: js.map((j) => ({
          usd: dollars(j.usd),
          threat: j.threat === null ? null : dollars(j.threat),
        })),
      }));
    run.then(
      (e) => {
        if (ctl.signal.aborted) return;
        this.#finish(job);
        this.emit(e);
        this.#pump();
      },
      (err) => {
        // Aborted: cancelled, not an error; whoever aborted has moved on.
        if (ctl.signal.aborted) return;
        console.error("threat queue: job failed", err);
        this.#finish(job);
        // Say so, or the page keeps saying it is working.
        this.emit(
          job.kind === "jumps"
            ? { kind: "jumps", key, c: job.c, jumps: [] }
            : { kind: "typed", key, c: job.c, given: job.given, threat: undefined },
        );
        this.#pump();
      },
    );
  }

  #finish(job: Job) {
    this.#job = undefined;
    if (job.kind === "jumps") this.#done.add(job.c);
    else this.#typedDone = `${job.c}:${job.given}`;
  }
}

/** Hands a page message to the queue: the worker's glue, and the page's fallback without one. */
export function handle(queue: ThreatQueue, m: ThreatMsg): void {
  if (m.type === "inputs") queue.setInputs(m.key, m.inputs);
  else if (m.type === "order") queue.setOrder(m.open, m.visible, m.rest);
  else if (m.type === "typed") queue.typed(m.c, m.given);
  else if (m.type === "pause") queue.pause();
  else queue.resume();
}
