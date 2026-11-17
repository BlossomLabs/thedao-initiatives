/** The words for the last change to TheDAO's ballot (#118): what caused it and what it
 * did, from the round's `live.lastChange`. */
import { tierName } from "../../shared/vote/ballot";
import type { LastChangeJson } from "../../shared/vote/replay-round";
import { plural, usdShort } from "~/lib/format";

const list = (parts: string[]) =>
  parts.length <= 1
    ? parts.join("")
    : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;

const micro = (v: string) => Number(BigInt(v) / 10_000n) / 100;

/** "a voter changed their ballot", "a donation to Foo and the pool changed to $900K". */
export function changeCause(c: LastChangeJson, titleOf: (slug: string) => string): string {
  const firsts = c.causes.filter((x) => x.kind === "ballot" && x.first).length;
  const revised = c.causes.filter((x) => x.kind === "ballot" && !x.first).length;
  const parts: string[] = [];
  if (firsts) {
    parts.push(firsts === 1 ? "a new voter sent a ballot" : `${firsts} new voters sent ballots`);
  }
  if (revised) {
    parts.push(
      revised === 1 ? "a voter changed their ballot" : `${revised} voters changed their ballots`,
    );
  }
  for (const x of c.causes) {
    if (x.kind === "revoked") parts.push("a ballot was taken back");
    else if (x.kind === "pool") parts.push(`the pool changed to ${usdShort(micro(x.to))}`);
    else if (x.kind === "settled") parts.push(`${tierName(x.tier)} settled`);
    else if (x.kind === "withdrawn") {
      parts.push(`${titleOf(x.slug)} was ${x.withdrawn ? "withdrawn" : "brought back"}`);
    } else if (x.kind === "ask") {
      const [from, to] = [BigInt(x.from), BigInt(x.to)];
      parts.push(
        from === 0n
          ? `${titleOf(x.slug)} joined the vote`
          : to === 0n
          ? `donations covered ${titleOf(x.slug)}`
          : to < from
          ? `a donation to ${titleOf(x.slug)}`
          : `${titleOf(x.slug)}'s ask went up`,
      );
    }
  }
  return list(parts) || "a change on-chain";
}

/** "moved 3 initiatives and changed 2 amounts". */
export function changeEffect(c: LastChangeJson): string {
  return list([
    ...(c.moved.length ? [`moved ${plural(c.moved.length, "initiative")}`] : []),
    ...(c.amounts.length ? [`changed ${plural(c.amounts.length, "amount")}`] : []),
  ]);
}

/** Each move on its own line, for a hover title: "Foo: S-Tier → not funded". */
export function changeMoves(c: LastChangeJson, titleOf: (slug: string) => string): string {
  const where = (t: LastChangeJson["moved"][number]["from"]) => t ? tierName(t) : "not funded";
  return c.moved.map((m) => `${titleOf(m.slug)}: ${where(m.from)} → ${where(m.to)}`).join("\n");
}

/** What a change did, for the vote results' toast (#126): "Foo is now included in A-Tier,
 * Bar was pushed out." At most three moves by name, then "and N more". Empty when nothing
 * moved. */
export function changeHeadline(c: LastChangeJson, titleOf: (slug: string) => string): string {
  const said = c.moved.map((m) =>
    !m.to
      ? `${titleOf(m.slug)} was pushed out`
      : !m.from
      ? `${titleOf(m.slug)} is now included in ${tierName(m.to)}`
      : `${titleOf(m.slug)} moved to ${tierName(m.to)}`
  );
  if (!said.length) return "";
  const shown = said.length > 3 ? [...said.slice(0, 3), `${said.length - 3} more moved`] : said;
  return `${list(shown)}.`;
}
