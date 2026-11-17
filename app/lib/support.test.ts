import { expect, it, vi } from "vitest";
import { onPledgeRequest, openPledgeRequest } from "./support";

it("a pledge request carries the initiative and the amount to the form (#128)", () => {
  const open = vi.fn();
  const off = onPledgeRequest(open);
  openPledgeRequest("init-1", 25_000);
  openPledgeRequest("init-2");
  openPledgeRequest();
  off();
  openPledgeRequest("ignored");
  expect(open.mock.calls).toEqual([["init-1", 25_000], ["init-2", null], [null, null]]);
});
