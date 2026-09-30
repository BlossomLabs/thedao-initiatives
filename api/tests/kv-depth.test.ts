/**
 * Pins the number of sequential KV round trips behind the public reads. Every
 * KV operation is delayed by a fixed LATENCY, so the elapsed time of one
 * request divided by LATENCY is the depth of its critical path; the count of
 * operations bounds the total KV work. Production pays ~120-180 ms per trip.
 */
import { assert, assertEquals } from "@std/assert";
import { harness } from "./app-helpers.ts";
import { K } from "../db/keys.ts";

const LATENCY = 30;
const delay = () => new Promise((r) => setTimeout(r, LATENCY));

const counter = { ops: 0, on: false };
const realOpen = Deno.openKv;
Object.defineProperty(Deno, "openKv", {
  configurable: true,
  value: async (path?: string) => {
    const kv = await realOpen(path);
    return new Proxy(kv, {
      get(target, prop, recv) {
        const v = Reflect.get(target, prop, recv);
        if (typeof v !== "function") return v;
        if (["get", "getMany", "set", "delete"].includes(String(prop))) {
          return async (...a: unknown[]) => {
            if (counter.on) {
              counter.ops++;
              await delay();
            }
            return (v as (...x: unknown[]) => unknown).apply(target, a);
          };
        }
        if (prop === "list") {
          return (...a: unknown[]) => {
            const it = (v as (...x: unknown[]) => Deno.KvListIterator<unknown>).apply(target, a);
            if (!counter.on) return it;
            counter.ops++;
            let first = true;
            const wrapped = {
              async next() {
                if (first) {
                  first = false;
                  await delay();
                }
                return await it.next();
              },
              [Symbol.asyncIterator]() {
                return wrapped;
              },
            };
            return wrapped;
          };
        }
        if (prop === "atomic") {
          return () => {
            const op = (v as () => Deno.AtomicOperation).apply(target);
            const commit = op.commit.bind(op);
            op.commit = async () => {
              if (counter.on) {
                counter.ops++;
                await delay();
              }
              return await commit();
            };
            return op;
          };
        }
        return (v as (...x: unknown[]) => unknown).bind(target);
      },
    });
  },
});

async function timed(run: () => Promise<Response>) {
  counter.ops = 0;
  counter.on = true;
  const t0 = performance.now();
  const res = await run();
  const elapsed = performance.now() - t0;
  counter.on = false;
  assertEquals(res.status, 200);
  return {
    ops: counter.ops,
    trips: Math.round(elapsed / LATENCY),
    elapsed,
    body: await res.json(),
  };
}

Deno.test("kv depth: the board and the initiative page stay within a few round trips", async () => {
  const h = await harness({ env: { BOARD_CACHE_SECS: "0" } });
  const text = "lorem ipsum ".repeat(700);
  for (let i = 0; i < 25; i++) {
    const r = await h.db.initiatives.insert({
      title: `Initiative ${i}`,
      summary: "s".repeat(200),
      details: text,
      goalUsd: 100_000,
      status: "approved",
      safeAddress: `0x${String(i + 1).padStart(40, "0")}`,
    });
    for (let p = 0; p < 2; p++) {
      await h.db.pledges.add(r.id, {
        company: "c",
        amountUsd: 100,
        status: "pledged",
        note: "",
        url: "",
        logoCid: "",
      });
    }
    for (let d = 0; d < 3; d++) {
      await h.kv.set(K.donation(r.id, `0x${i}${d}`), {
        rfpId: r.id,
        txHash: `0x${i}${d}`,
        tokenSymbol: "USDC",
        tokenAddress: "0x",
        amountRaw: "1",
        amountUsd: 10,
        donor: "0x",
        status: "confirmed",
        detail: "",
        source: "tx",
        createdAt: 1,
        confirmedAt: 1,
      });
    }
  }
  for (let i = 0; i < 10; i++) {
    await h.db.initiatives.insert({ title: `Pending ${i}`, summary: "", details: text });
  }

  await h.db.initiatives.cards("approved"); // the index is built, as on a running site
  // The first read after the writes builds every card summary from its rows (#46);
  // that is a one-off per write, not per build.
  const cold = await timed(() => h.req("/api/board"));
  assertEquals(cold.body.cards.length, 25);
  assert(
    cold.trips <= 6 && cold.ops <= 140,
    `cold board took ${cold.trips} sequential KV trips and ${cold.ops} operations`,
  );
  // Then a build is the status index (#47), one getMany per five cards, and the
  // ledger and balance snapshots per card, all but one wave in parallel.
  const board = await timed(() => h.req("/api/board"));
  assertEquals(board.body.cards.length, 25);
  assert(
    board.trips <= 3 && board.ops <= 60,
    `board took ${board.trips} sequential KV trips and ${board.ops} operations`,
  );

  const page = await timed(() => h.req("/api/initiatives/initiative-3"));
  assertEquals(page.body.initiative.slug, "initiative-3");
  assert(page.trips <= 4, `initiative page took ${page.trips} sequential KV trips`);
  h.close();
});
