import { assertEquals } from "@std/assert";
import { backerCount } from "../routes/board.ts";
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
