import { assertEquals } from "@std/assert";
import { backerCount, topSponsors } from "../routes/board.ts";
import type { Donation, Pledge } from "../db/types.ts";

const pledge = (status: Pledge["status"]) => ({ status }) as Pledge;
const donation = (donor: string) => ({ donor, status: "confirmed" }) as Donation;

const A = "0xAAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

Deno.test("backers: open pledges plus the distinct addresses that donated", () => {
  assertEquals(backerCount([], []), 0);
  assertEquals(backerCount([pledge("pledged"), pledge("pledged")], []), 2);
  assertEquals(backerCount([], [donation(A), donation(B)]), 2);
  assertEquals(backerCount([pledge("pledged")], [donation(A), donation(B)]), 3);
});

Deno.test("backers: a donor who gave twice is one backer, whatever the address casing", () => {
  assertEquals(backerCount([], [donation(A), donation(A.toLowerCase()), donation(B)]), 2);
});

Deno.test("backers: a received pledge is counted through its donation, not twice", () => {
  assertEquals(backerCount([pledge("pledged"), pledge("received")], [donation(A)]), 2);
  assertEquals(backerCount([pledge("withdrawn")], []), 0);
});

Deno.test("backers: a donation with no sender on record adds nobody", () => {
  assertEquals(backerCount([], [donation(""), donation(A)]), 1);
});

const cfg = { pinataGateway: "gw.example" } as Parameters<typeof topSponsors>[0];
const pl = (company: string, amountUsd: number, extra: Partial<Pledge> = {}) =>
  ({ company, amountUsd, status: "pledged", url: "", logoCid: "", ...extra }) as Pledge;

Deno.test("sponsors: one row per company across initiatives, biggest total first", () => {
  const s = topSponsors(cfg, [
    { pledges: [pl("EF", 10000), pl("Acme", 3000)] },
    { pledges: [pl(" ef ", 5000, { logoCid: "cid1", url: "https://ef" }), pl("Acme", 4000)] },
  ]);
  assertEquals(s.map((x) => [x.company, x.totalUsd]), [["EF", 15000], ["Acme", 7000]]);
  assertEquals(s[0].logoUrl, "https://gw.example/ipfs/cid1");
  assertEquals(s[0].url, "https://ef");
});

Deno.test("sponsors: withdrawn and empty pledges do not count, top 8 only", () => {
  const pledges = ["A", "B", "C", "D", "E", "F", "G", "H", "I"].map((c, i) => pl(c, 6000 + i));
  pledges.push(pl("Z", 99999, { status: "withdrawn" }), pl("Y", 0), pl("  ", 50000));
  const s = topSponsors(cfg, [{ pledges }]);
  assertEquals(s.map((x) => x.company), ["I", "H", "G", "F", "E", "D", "C", "B"]);
});

Deno.test("sponsors: the name shown is the biggest pledge's spelling", () => {
  const s = topSponsors(cfg, [{
    pledges: [pl("acme", 1000), pl("ACME", 500), pl("Acme ", 4000)],
  }]);
  assertEquals(s.map((x) => [x.company, x.totalUsd]), [["Acme", 5500]]);
});

Deno.test("sponsors: a slot takes $5,000 pledged in total, across initiatives", () => {
  const s = topSponsors(cfg, [
    { pledges: [pl("Small", 4999.99), pl("Split", 2500), pl("Exact", 5000)] },
    { pledges: [pl("Split", 2500), pl("Gone", 9000, { status: "withdrawn" }), pl("Gone", 100)] },
  ]);
  assertEquals(s.map((x) => x.company), ["Exact", "Split"]);
});
