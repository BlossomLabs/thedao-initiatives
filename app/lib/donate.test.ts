import { donateChips, walletErrorMessage } from "./donate";

test("a wallet that is not on Ethereum gets told to switch, not an EIP-1193 code", () => {
  // viem's wording for EIP-1193 code 4901 (Ambire answers personal_sign with it
  // when the site's chain in the wallet is not an enabled network)
  const chainDisconnected = Object.assign(
    new Error("The Provider is not connected to the requested chain."),
    { code: 4901, shortMessage: "The Provider is not connected to the requested chain." },
  );
  expect(walletErrorMessage(chainDisconnected)).toBe(
    "the wallet is not on Ethereum. Switch it to Ethereum mainnet and try again.",
  );
  expect(walletErrorMessage({ code: 4901 })).toBe(
    "the wallet is not on Ethereum. Switch it to Ethereum mainnet and try again.",
  );
});

test("other errors keep their wording", () => {
  expect(walletErrorMessage({ code: 4001 })).toBe("you rejected the request in the wallet.");
  expect(walletErrorMessage(new Error("boom"))).toBe("boom");
});

describe("donateChips", () => {
  it("the usual amounts, without suggestions or a cap", () => {
    expect(donateChips([])).toEqual(["50", "500", "5000", "50000"]);
  });

  it("suggestions first, then the usual amounts after the smallest, smallest first", () => {
    expect(donateChips(["4050", "9800"])).toEqual(["500", "4050", "5000", "9800"]);
  });

  it("stops at the cap, ending on the cap itself (#102)", () => {
    // $30,000 still needed: $50,000 would give more than it needs.
    expect(donateChips([], 30_000)).toEqual(["50", "500", "5000", "30000"]);
    expect(donateChips(["4050", "9800"], 30_000)).toEqual(["500", "4050", "9800", "30000"]);
    expect(donateChips([], 3_000)).toEqual(["50", "500", "3000"]);
  });

  it("always reserves the last button for full funding, even above all usual amounts", () => {
    expect(donateChips([], 80_000)).toEqual(["50", "500", "5000", "80000"]);
    expect(donateChips(["1000", "10000"], 80_000))
      .toEqual(["500", "1000", "10000", "80000"]);
    expect(donateChips(["1000", "2000", "3000", "4000"], 80_000))
      .toEqual(["1000", "2000", "3000", "80000"]);
  });

  it("offers the full-funding amount once when it is also a suggestion", () => {
    expect(donateChips(["1000", "80000"], 80_000))
      .toEqual(["500", "1000", "5000", "80000"]);
  });
});
