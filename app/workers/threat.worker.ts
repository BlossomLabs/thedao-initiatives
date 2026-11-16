/** The jump queue off the page's thread: `ThreatMsg`s in, `QueueEvent`s out. */
import { handle, type QueueEvent, type ThreatMsg, ThreatQueue } from "../lib/threat-queue";

const scope = self as unknown as {
  postMessage: (e: QueueEvent) => void;
  onmessage: ((ev: MessageEvent<ThreatMsg>) => void) | null;
};
const queue = new ThreatQueue((e) => scope.postMessage(e));
scope.onmessage = (ev) => handle(queue, ev.data);
