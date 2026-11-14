/** The live tally's inputs as the round's JSON carries them, so the browser can re-run
 * the tally (a donation's preview, as an amount is typed) on exactly the server's numbers.
 * Ballots go as their bytes, as `accepted` does; their ranks are derived again here. */
import type { ChainInputs } from "./chain.ts";
import { effectiveRanks } from "../../vote/shared/ranks.ts";

export type LiveInputsJson = {
  /** The first open tier (index): the tally starts there. */
  first: number;
  /** Each initiative's need, micro-USD, by manifest index. */
  costs: string[];
  /** The voters (tokenIds, sorted), their remaining shares and their ballots (hex). */
  voters: string[];
  weights: string[];
  ballots: string[];
  poolUsd: string;
  spent: string;
  /** Settled initiatives (manifest indices). */
  done: number[];
};

const hex = (b: number[]) => `0x${b.map((x) => x.toString(16).padStart(2, "0")).join("")}`;
const bytes = (h: string) =>
  Array.from({ length: (h.length - 2) / 2 }, (_, i) => parseInt(h.slice(2 + 2 * i, 4 + 2 * i), 16));

export function liveInputsJson(inp: ChainInputs, first: number): LiveInputsJson {
  return {
    first,
    costs: inp.costs.map(String),
    voters: inp.voters,
    weights: inp.weights.map(String),
    ballots: inp.ballots.map(hex),
    poolUsd: String(inp.poolUsd),
    spent: String(inp.spent),
    done: [...inp.done].sort((a, b) => a - b),
  };
}

export function liveInputsFrom(j: LiveInputsJson): { inp: ChainInputs; first: number } {
  const m = j.costs.length;
  const ballots = j.ballots.map(bytes);
  return {
    first: j.first,
    inp: {
      m,
      costs: j.costs.map(BigInt),
      voters: j.voters,
      weights: j.weights.map(BigInt),
      ranks: ballots.map((b) => effectiveRanks(b, m)),
      ballots,
      poolUsd: BigInt(j.poolUsd),
      spent: BigInt(j.spent),
      done: new Set(j.done),
    },
  };
}
