import { ballotClosed, DEFAULT_VOTE, readVoteSettings } from "./vote.ts";

const base = { show: true, floorPct: 25, capUsd: 200_000 };

test("no deadline by default", () => {
  expect(DEFAULT_VOTE.qualifyBy).toBeNull();
});

test("the deadline to qualify is null or whole unix seconds", () => {
  expect(readVoteSettings({ ...base, qualifyBy: null })).toEqual([
    { ...base, qualifyBy: null },
    null,
  ]);
  expect(readVoteSettings({ ...base, qualifyBy: 1_795_420_800 })).toEqual([
    { ...base, qualifyBy: 1_795_420_800 },
    null,
  ]);
  // 1_795_420_800_000 is the same moment in milliseconds: a mistake, refused.
  for (
    const bad of ["1795420800", -5, 0, 1_795_420_800.5, true, Number.NaN, 1_795_420_800_000, 1e11]
  ) {
    const [v, err] = readVoteSettings({ ...base, qualifyBy: bad });
    expect(v).toBeNull();
    expect(err).toBe("The deadline to qualify is a moment in unix seconds, or none.");
  }
});

test("settings saved before the deadline existed read as no deadline", () => {
  expect(readVoteSettings(base)).toEqual([{ ...base, qualifyBy: null }, null]);
});

test("the ballot closes at the deadline, never without one", () => {
  const s = { ...DEFAULT_VOTE, qualifyBy: 1000 };
  expect(ballotClosed(s, 999)).toBe(false);
  expect(ballotClosed(s, 1000)).toBe(true);
  expect(ballotClosed({ ...s, qualifyBy: null }, 1e12)).toBe(false);
});
