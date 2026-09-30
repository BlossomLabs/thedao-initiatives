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
    { pledges: [pl("EF", 100), pl("Acme", 30)] },
    { pledges: [pl(" ef ", 50, { logoCid: "cid1", url: "https://ef" }), pl("Acme", 40)] },
  ]);
  assertEquals(s.map((x) => [x.company, x.totalUsd]), [["EF", 150], ["Acme", 70]]);
  assertEquals(s[0].logoUrl, "https://gw.example/ipfs/cid1");
  assertEquals(s[0].url, "https://ef");
});

Deno.test("sponsors: withdrawn and empty pledges do not count, top 5 only", () => {
  const pledges = ["A", "B", "C", "D", "E", "F"].map((c, i) => pl(c, 10 + i));
  pledges.push(pl("Z", 999, { status: "withdrawn" }), pl("Y", 0), pl("  ", 500));
  const s = topSponsors(cfg, [{ pledges }]);
  assertEquals(s.map((x) => x.company), ["F", "E", "D", "C", "B"]);
});

Deno.test("sponsors: the name shown is the biggest pledge's spelling", () => {
  const s = topSponsors(cfg, [{ pledges: [pl("acme", 10), pl("ACME", 5), pl("Acme ", 20)] }]);
  assertEquals(s.map((x) => [x.company, x.totalUsd]), [["Acme", 35]]);
});
