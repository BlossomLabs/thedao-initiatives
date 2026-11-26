import { formatUnits, getAddress, isAddress, parseUnits, stringToHex } from "viem";
import { adminBatch } from "./admin-batch.ts";
import type { VoteManifest } from "./manifest.ts";
import { tierSpan } from "./round-from-chain.ts";

export type CorrectionView = {
  supported: boolean;
  manifest: VoteManifest;
  now: number;
  settled: number[];
  final: boolean;
  poolUsd: string;
  pendingPoolUsd: string | null;
  poolUpdateNonce: string;
};

export const addingOpen = (m: VoteManifest, now: number) =>
  now < m.opensAt ||
  (now < m.closesAt &&
    m.schedule.firstTallyAt.every((t) => now < t || now >= t + tierSpan(m.schedule)));

/** Allowlisted, validated calls only. The site prepares an atomic Safe batch; it never
 * executes the correction. Values in the review are the exact values encoded below. */
export function prepareCorrection(body: Record<string, unknown>, v: CorrectionView) {
  const m = v.manifest;
  const reject = (message: string): never => {
    throw new Error(message);
  };
  if (!v.supported || m.configRevision === undefined) reject("This round predates corrections.");
  if (body.revision !== m.configRevision) {
    reject("Settings changed. Reload and review the change again.");
  }
  const text = (key: string, max = 200) => {
    const x = body[key];
    if (typeof x !== "string" || x.length > max) return reject(`Invalid ${key}.`);
    return x.trim();
  };
  const uint = (key: string, max = (1n << 256n) - 1n) => {
    const x = text(key, 78);
    if (!/^\d+$/.test(x) || BigInt(x) > max) return reject(`Invalid ${key}.`);
    return BigInt(x);
  };
  const id = (count: number) => Number(uint("id", BigInt(count - 1)));
  const address = (key: string) => {
    const x = text(key, 42);
    if (!isAddress(x)) return reject(`Invalid ${key} address.`);
    return getAddress(x);
  };
  const dollars = (key: string) => {
    const x = text(key, 85);
    if (!/^\d+(\.\d{1,6})?$/.test(x)) return reject("Use dollars with at most six decimal places.");
    const amount = parseUnits(x, 6);
    if (amount >= 1n << 256n) return reject("Dollar amount is too large.");
    return amount;
  };
  const bool = (key: string) =>
    typeof body[key] === "boolean" ? body[key] as boolean : reject(`Invalid ${key}.`);
  const setup = () => {
    if (v.now >= m.opensAt) reject("These settings froze when voting opened.");
  };
  const open = () => {
    if (v.now >= m.closesAt || v.final) reject("The round has finished.");
  };
  let fn: string;
  let args: readonly unknown[];
  let summary: string;
  switch (body.action) {
    case "initiative": {
      open();
      if (!addingOpen(m, v.now)) {
        reject("Initiatives cannot change during a scheduled quiet ending.");
      }
      const i = id(m.slugs.length);
      if (v.settled.includes(i)) reject("This initiative has already settled.");
      // The account is the initiative's Safe, set once from its id: never changed here.
      const current = m.accounts?.[i];
      if (!current) return reject("This round doesn't list the initiative's account.");
      const account = getAddress(current);
      if (body.account !== undefined && address("account") !== account) {
        reject("The account can't change here: it is the initiative's Safe.");
      }
      const goal = dollars("goalUsd");
      const rfp = bool("rfp");
      const groups = body.groups;
      if (
        !Array.isArray(groups) ||
        groups.some((g) => !Number.isInteger(g) || g < 0 || g >= m.groups.length)
      ) reject("Invalid affiliations.");
      const ids = groups as number[];
      if (rfp && ids.length) reject("An RFP cannot have affiliations.");
      fn = "setInitiative";
      args = [BigInt(i), account, goal, rfp, ids.reduce((a, g) => a | (1n << BigInt(g)), 0n)];
      summary = `${m.slugs[i]}: goal $${text("goalUsd")}; ${
        rfp ? "RFP" : "initiative"
      }; affiliations: ${
        ids.map((g) => m.groups[g]).join(", ") || "none"
      }. Earlier ballots and settled awards are unchanged.`;
      break;
    }
    case "currency": {
      setup();
      const i = id(m.currencies?.length ?? 0);
      if (!i) reject("The USD accounting unit cannot change.");
      const feed = address("usdFeed"), disabled = bool("disabled");
      if (/^0x0{40}$/i.test(m.currencies![i].asset) && /^0x0{40}$/i.test(feed)) {
        reject("Native currency needs a price feed.");
      }
      fn = "setCurrency";
      args = [BigInt(i), feed, disabled];
      summary = `${m.currencies![i].symbol}: feed ${feed}; ${
        disabled ? "disabled (existing pledges stop counting)" : "enabled"
      }. Token and pledge quantities stay unchanged.`;
      break;
    }
    case "registerCurrency": {
      setup();
      const asset = address("asset"), feed = address("usdFeed");
      if (
        (m.currencies?.length ?? 0) >= 32 ||
        m.currencies?.slice(1).some((c) => c.asset.toLowerCase() === asset.toLowerCase())
      ) reject("Currency already registered or limit reached.");
      if (/^0x0{40}$/i.test(asset) && /^0x0{40}$/i.test(feed)) {
        reject("Native currency needs a price feed.");
      }
      fn = "registerCurrency";
      args = [asset, feed];
      summary =
        `Register token ${asset} with feed ${feed}. A zero feed values each whole token at $1.`;
      break;
    }
    case "group": {
      const i = id(m.groups.length), name = text("name", 100);
      if (!name || new TextEncoder().encode(name).length > 32) {
        reject("Use a group name of 1–32 UTF-8 bytes.");
      }
      fn = "setGroupName";
      args = [i, stringToHex(name, { size: 32 })];
      summary = `Rename ${m.groups[i]} → ${name}. Membership stays unchanged.`;
      break;
    }
    case "metadata": {
      const uri = text("uri", 2000);
      if (uri && !/^(https:\/\/|ipfs:\/\/|ar:\/\/)/i.test(uri)) {
        reject("Use an HTTPS, IPFS or Arweave URL.");
      }
      fn = "setBaseURI";
      args = [uri];
      summary = `NFT metadata base URL: ${uri || "empty"}. Voting rights stay unchanged.`;
      break;
    }
    case "schedule": {
      const opensAt = Number(uint("opensAt", BigInt(Number.MAX_SAFE_INTEGER)));
      const dates = body.firstTallyAt;
      if (
        !Array.isArray(dates) || dates.length !== 3 ||
        dates.some((d) => !Number.isSafeInteger(d) || d < 0)
      ) reject("Invalid tally dates.");
      const firstTallyAt = dates as [number, number, number];
      const initialWindow = Number(uint("initialWindow", BigInt(Number.MAX_SAFE_INTEGER)));
      const maxWindows = Number(uint("maxWindows", 64n));
      const s = { opensAt, firstTallyAt, initialWindow, maxWindows };
      const span = tierSpan(s);
      if (
        !initialWindow || !maxWindows || Math.floor(initialWindow / 2 ** (maxWindows - 1)) < 1 ||
        firstTallyAt[0] < opensAt || firstTallyAt[1] < firstTallyAt[0] + span ||
        firstTallyAt[2] < firstTallyAt[1] + span ||
        !Number.isSafeInteger(firstTallyAt[2] + span)
      ) reject("Windows must stay positive and tiers must not overlap.");
      if (v.now < m.opensAt) {
        if (opensAt <= v.now) reject("Opening must be in the future.");
        fn = "setSchedule";
        args = [{
          ...s,
          opensAt: BigInt(opensAt),
          initialWindow: BigInt(initialWindow),
          firstTallyAt: firstTallyAt.map(BigInt),
        }];
      } else {
        if (
          opensAt !== m.opensAt || initialWindow !== m.schedule.initialWindow ||
          maxWindows !== m.schedule.maxWindows
        ) reject("Opening and window parameters have frozen.");
        if (
          firstTallyAt.some((d, i) =>
            d !== m.schedule.firstTallyAt[i] && (d <= v.now || m.schedule.firstTallyAt[i] <= v.now)
          )
        ) reject("Only future tally dates can change.");
        fn = "setDates";
        args = [BigInt(opensAt), firstTallyAt.map(BigInt)];
      }
      summary =
        "Apply the reviewed dates and window lengths together. All dependent deadlines are recalculated.";
      break;
    }
    case "pool": {
      open();
      const amount = dollars("amountUsd");
      if (v.now >= m.schedule.firstTallyAt[0] && amount < BigInt(v.poolUsd)) {
        reject("The active pool cannot decrease after S-Tier's first tally.");
      }
      fn = v.now < m.schedule.firstTallyAt[0] ? "setPoolUsd" : "proposePoolUsd";
      args = [amount];
      summary = `${fn === "setPoolUsd" ? "Set" : "Propose"} a total pool of $${text("amountUsd")}.${
        fn === "proposePoolUsd"
          ? " It has no effect until separately activated in a later block."
          : " This also cancels any pending proposal."
      }`;
      break;
    }
    case "activatePool":
    case "cancelPool": {
      if (body.action === "activatePool") open();
      if (v.pendingPoolUsd === null) reject("No pool update is pending.");
      const nonce = uint("nonce");
      if (nonce.toString() !== v.poolUpdateNonce) {
        reject("The pending pool update changed. Review it again.");
      }
      fn = body.action === "activatePool" ? "activatePoolUpdate" : "cancelPoolUpdate";
      args = [nonce];
      summary = `${
        body.action === "activatePool" ? "Activate" : "Cancel"
      } the reviewed pool proposal ${nonce}: a total of $${
        formatUnits(BigInt(v.pendingPoolUsd!), 6)
      }.`;
      break;
    }
    default:
      return reject("Unknown correction.");
  }
  return {
    summary,
    batch: adminBatch(m, "Correct vote settings", [
      { fn: "requireConfigRevision", args: [BigInt(m.configRevision!)] },
      { fn, args },
    ]),
  };
}
