import { normalizeWallets, safeWalletLink, walletDeepLink } from "./mobile-wallets";
import snapshot from "../../public/wallets.json";

const uri = "wc:pairing-topic@2?relay-protocol=irn&symKey=abc123";

test.each([
  ["MetaMask", "metamask://wc"],
  ["Rainbow", "rainbow://wc"],
  ["Trust Wallet", "trust://wc"],
  ["SafePal", "safepalwallet://wc"],
])("opens %s from the actual directory with the same pairing", (name, endpoint) => {
  const wallet = normalizeWallets(snapshot.wallets).find((w) => w.name === name)!;
  expect(walletDeepLink(wallet, uri)).toBe(`${endpoint}?uri=${encodeURIComponent(uri)}`);
});

test.each([
  "javascript://alert(1)",
  "data://text/html,test",
  "file:///etc/passwd",
  "intent://wallet",
  "https://user:pass@wallet.test",
  "https://wallet.test/#redirect",
  "https://wallet.test/\nwc",
])(
  "rejects an unsafe registry link: %s",
  (link) => {
    expect(safeWalletLink(link)).toBeNull();
    expect(safeWalletLink(link, true)).toBeNull();
  },
);

test("keeps all wallets searchable, including those without app links, and sorts without promotion", () => {
  const result = normalizeWallets({
    z: { id: "z", name: "Zulu", mobile: { native: "zulu://" } },
    b: { id: "b", name: "Beta", mobile: { native: "javascript://evil" } },
    a: { id: "a", name: "Alpha", mobile: { universal: "https://alpha.test/wc/" } },
  });
  expect(result.map((w) => w.name)).toEqual(["Alpha", "Beta", "Zulu"]);
  expect(walletDeepLink(result[0], uri)).toBe(
    `https://alpha.test/wc?uri=${encodeURIComponent(uri)}`,
  );
  expect(walletDeepLink(result[1], uri)).toBeNull();
  expect(walletDeepLink(result[2], "javascript:bad")).toBeNull();
});

test("normalizes existing wc paths and strips stale pairing URIs", () => {
  const [wallet] = normalizeWallets([{
    id: "w",
    name: "Wallet",
    native: "wallet://wc?uri=wc:old",
    universal: null,
  }]);
  expect(walletDeepLink(wallet, uri)).toBe(`wallet://wc?uri=${encodeURIComponent(uri)}`);
});
