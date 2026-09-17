// Run explicitly when updating the reviewed, locally served wallet directory.
import { normalizeWallets } from "../app/lib/mobile-wallets.ts";

const projectId = Deno.env.get("VITE_WALLETCONNECT_PROJECT_ID");
if (!projectId) throw new Error("VITE_WALLETCONNECT_PROJECT_ID is required.");
const url = new URL("https://explorer-api.walletconnect.com/v3/wallets");
url.search = new URLSearchParams({
  projectId,
  chains: "eip155:1",
  platforms: "ios,android",
  sdks: "sign_v2",
}).toString();
const response = await fetch(url, {
  headers: {
    "User-Agent": "TheDAO wallet directory sync",
    Origin: new URL(Deno.env.get("VITE_SITE_URL") || "https://initiatives.thedao.fund").origin,
  },
});
if (!response.ok) throw new Error(`Wallet directory request failed (${response.status}).`);
const data = await response.json();
const wallets = normalizeWallets(data.listings);
if (!wallets.length || Object.keys(data.listings).length !== data.total) {
  throw new Error("Refusing to replace the directory with an empty or incomplete response.");
}
await Deno.writeTextFile(
  new URL("../public/wallets.json", import.meta.url),
  JSON.stringify(
    {
      source: "https://docs.reown.com/cloud/explorer",
      updatedAt: new Date().toISOString().slice(0, 10),
      wallets,
    },
    null,
    2,
  ) + "\n",
);
console.log(`Saved ${wallets.length} mobile wallets. Review the diff before publishing.`);
