/** Green rows' jumps, worked out ahead of a click in a web worker (the page's thread when
 * there is no `Worker`, as in tests): the open row and a typed amount first, then the
 * visible green rows, then the rest. Paused while the tab is hidden; started over when the
 * figures (`key`) change. */
import { useEffect, useRef, useState } from "react";
import type { LiveInputsJson } from "../../shared/vote/live-inputs";
import {
  handle,
  type JumpUsd,
  type QueueEvent,
  type ThreatMsg,
  ThreatQueue,
} from "../lib/threat-queue";

type Typed = { c: number; given: number; threat: number | null | undefined };
type Results = { key?: string; jumps: Map<number, JumpUsd[]>; typed?: Typed };

const NONE = new Map<number, JumpUsd[]>();

type Port = { send: (m: ThreatMsg) => void; end: () => void };

/** The queue behind a message port: the worker, or the queue on this thread when there is
 * no `Worker` or its script fails to load (the current figures and order are sent again). */
function startQueue(onEvent: (e: QueueEvent) => void): Port {
  // What a fresh queue needs to catch up: the latest of each message.
  const last = new Map<ThreatMsg["type"], ThreatMsg>();
  let paused: ThreatMsg | undefined;
  const remember = (m: ThreatMsg) => {
    if (m.type === "pause" || m.type === "resume") paused = m.type === "pause" ? m : undefined;
    else last.set(m.type, m);
  };
  const local = () => {
    const queue = new ThreatQueue(onEvent);
    return { send: (m: ThreatMsg) => handle(queue, m), end: () => queue.stop() };
  };
  if (typeof Worker === "undefined") return local();

  let inner: Port;
  let worker: Worker | undefined;
  try {
    worker = new Worker(new URL("../workers/threat.worker.ts", import.meta.url), {
      type: "module",
    });
  } catch {
    inner = local();
    return { send: (m) => inner.send(m), end: () => inner.end() };
  }
  const w = worker;
  inner = { send: (m) => w.postMessage(m), end: () => w.terminate() };
  w.onmessage = (ev: MessageEvent<QueueEvent>) => onEvent(ev.data);
  w.onerror = () => {
    w.terminate();
    inner = local();
    for (const m of last.values()) inner.send(m);
    if (paused) inner.send(paused);
  };
  return {
    send: (m) => {
      remember(m);
      inner.send(m);
    },
    end: () => inner.end(),
  };
}

export function useThreatJumps(args: {
  key?: string;
  inputs?: LiveInputsJson;
  open?: number;
  visible: number[];
  rest: number[];
  typed?: { c: number; given: number };
}): { jumps: Map<number, JumpUsd[]>; typed?: Typed } {
  const { key, inputs, open, visible, rest, typed } = args;
  const [res, setRes] = useState<Results>({ jumps: NONE });
  const port = useRef<Port | null>(null);
  const keyRef = useRef(key);
  keyRef.current = key;
  // The standing order and typed amount, sent to a queue when it is made.
  const standing = useRef<ThreatMsg[]>([]);

  const onEvent = (e: QueueEvent) => {
    // A message in flight from figures the page has moved on from.
    if (e.key !== keyRef.current) return;
    setRes((s) => {
      const base = s.key === e.key ? s : { key: e.key, jumps: NONE };
      if (e.kind === "typed") {
        return { ...base, typed: { c: e.c, given: e.given, threat: e.threat } };
      }
      return { ...base, jumps: new Map(base.jumps).set(e.c, e.jumps) };
    });
  };
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  /** Made the first time there are figures, so a visit without any costs no worker. */
  const ensurePort = (): Port => {
    if (port.current) return port.current;
    const p = startQueue((e) => onEventRef.current(e));
    port.current = p;
    if (document.hidden) p.send({ type: "pause" });
    for (const m of standing.current) p.send(m);
    return p;
  };

  useEffect(() => {
    const onVisibility = () => port.current?.send({ type: document.hidden ? "pause" : "resume" });
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      port.current?.end();
      port.current = null;
    };
  }, []);

  // `key` names the figures; `inputs` is read when it changes, or when they first arrive
  // after it (the queue ignores a key it already has).
  const hasInputs = inputs !== undefined;
  useEffect(() => {
    if (key !== undefined && inputs) ensurePort().send({ type: "inputs", key, inputs });
  }, [key, hasInputs]); // eslint-disable-line react-hooks/exhaustive-deps

  const visibleKey = visible.join(","), restKey = rest.join(",");
  useEffect(() => {
    const m: ThreatMsg = { type: "order", open, visible, rest };
    standing.current = [...standing.current.filter((x) => x.type !== "order"), m];
    port.current?.send(m);
  }, [open, visibleKey, restKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const m: ThreatMsg = { type: "typed", c: typed?.c ?? -1, given: typed?.given };
    standing.current = [...standing.current.filter((x) => x.type !== "typed"), m];
    port.current?.send(m);
  }, [typed?.c, typed?.given]);

  const current = res.key !== undefined && res.key === key;
  const t = current ? res.typed : undefined;
  return {
    jumps: current ? res.jumps : NONE,
    typed: t && typed && t.c === typed.c && t.given === typed.given ? t : undefined,
  };
}
