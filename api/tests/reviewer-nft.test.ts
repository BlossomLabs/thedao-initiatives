import { assertEquals, assertRejects } from "@std/assert";
import { ownsReviewToken, reviewTokenIds } from "../chain/reviewer.ts";
import { REVIEW_BADGE_CONTRACT } from "../config.ts";
import type { Rpc } from "../chain/rpc.ts";

const A = "0x1111111111111111111111111111111111111111";
const B = "0x2222222222222222222222222222222222222222";

Deno.test("review NFTs: indexed candidates are deduplicated and current ownerOf decides ownership", async () => {
  const big = 2n ** 128n;
  const owners = new Map([["0", A], ["7", B], [big.toString(), A]]);
  const rpc: Rpc = (_method, params) => {
    const call = params[0] as { data: string; to: string };
    assertEquals(call.to, REVIEW_BADGE_CONTRACT.toLowerCase());
    assertEquals(call.data.slice(0, 10), "0x6352211e");
    const id = BigInt("0x" + call.data.slice(10)).toString();
    return Promise.resolve("0x" + owners.get(id)!.slice(2).padStart(64, "0"));
  };
  const index: typeof fetch = () =>
    Promise.resolve(Response.json({
      items: [0n, 7n, 0n, big].map((id) => ({
        id: id.toString(),
        token: { address_hash: REVIEW_BADGE_CONTRACT },
      })),
      next_page_params: null,
    }));
  assertEquals(await reviewTokenIds(rpc, A, index), ["0", big.toString()]);
  owners.set("0", B);
  assertEquals(await ownsReviewToken(rpc, A, "0"), false);
  assertEquals(await reviewTokenIds(rpc, A, index), [big.toString()]);
});

Deno.test("review NFTs: malformed or failed chain responses never grant ownership", async () => {
  for (const result of [null, "0x", "0x01", A]) {
    await assertRejects(() => ownsReviewToken(() => Promise.resolve(result), A, "0"));
  }
  await assertRejects(() =>
    reviewTokenIds(() => Promise.resolve(null), A, () => Promise.resolve(Response.json({})))
  );
  await assertRejects(() =>
    reviewTokenIds(() => Promise.resolve(null), A, () => Promise.reject(new Error("down")))
  );
});

Deno.test("review NFTs: follows index pages, ignores other contracts, and verifies stale candidates", async () => {
  const urls: string[] = [];
  const index: typeof fetch = (input) => {
    const url = String(input);
    urls.push(url);
    return Promise.resolve(Response.json(
      urls.length === 1
        ? {
          items: [{ id: "4", token: { address_hash: A } }],
          next_page_params: { id: "4", items_count: 50 },
        }
        : {
          items: [{ id: "12", token: { address_hash: REVIEW_BADGE_CONTRACT } }],
          next_page_params: null,
        },
    ));
  };
  const rpc: Rpc = () => Promise.resolve("0x" + B.slice(2).padStart(64, "0"));
  assertEquals(await reviewTokenIds(rpc, A, index), []);
  assertEquals(urls.length, 2);
  assertEquals(new URL(urls[1]).searchParams.get("id"), "4");
  assertEquals(new URL(urls[1]).origin, "https://eth.blockscout.com");
});
