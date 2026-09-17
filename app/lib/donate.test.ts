import { walletErrorMessage } from "./donate";

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
