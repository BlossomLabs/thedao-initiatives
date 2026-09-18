/** Content sync never cuts a file's text: every capped field past its cap is
 * a sync error to fix in git. */
import { assertEquals, assertThrows } from "@std/assert";
import { parseContentBackers, parseInitiativeFile } from "../services/content.ts";
import { LIMITS, tooLong } from "../../shared/draft/mod.ts";
import { grantBody } from "./fixtures.ts";

const HEAD = "---\ntitle: Capped grant\n" +
  "summary: A grant whose file trips one cap at a time.\n" +
  "goal: 300000\ntype: grant\nduration: 6\nrecipient: Team Y\n";

const file = (extraHead: string, body = grantBody(300_000)) => HEAD + extraHead + "---\n" + body;

Deno.test("content: a section past its cap is a sync error, not a cut", () => {
  const body = grantBody(300_000).replace(
    "Because it closes a gap.",
    "w".repeat(LIMITS.SECTION_CHARS + 1),
  );
  assertThrows(
    () => parseInitiativeFile(file("", body)),
    Error,
    tooLong("Why this matters", LIMITS.SECTION_CHARS),
  );
});

Deno.test("content: a milestone link or a page link past the cap is a sync error", () => {
  const long = "https://y.example/" + "a".repeat(LIMITS.LINK_CHARS);
  const withMsLink = grantBody(300_000).replace(
    "- Released.",
    `Delivered: ${long}\n\n- Released.`,
  );
  assertThrows(
    () => parseInitiativeFile(file("", withMsLink)),
    Error,
    tooLong("milestone A link", LIMITS.LINK_CHARS),
  );
  const withPageLink = grantBody(300_000) + `\n## Links\n\n${long}\n`;
  assertThrows(
    () => parseInitiativeFile(file("", withPageLink)),
    Error,
    tooLong("link 1", LIMITS.LINK_CHARS),
  );
});

Deno.test("content: the recipient link has the same cap as the form", () => {
  const long = "https://y.example/" + "a".repeat(LIMITS.LINK_CHARS);
  assertThrows(() => parseInitiativeFile(file(`recipient_url: ${long}\n`)), Error, "too long");
  const ok = parseInitiativeFile(file("recipient_url: https://y.example/\n"));
  assertEquals(ok.recipientUrl, "https://y.example/");
});

Deno.test("content: a backer organisation past the cap uses the shared wording", () => {
  assertThrows(
    () => parseContentBackers("o".repeat(LIMITS.BACKER_ORG + 1) + " | $10"),
    Error,
    tooLong("backers: the organization name", LIMITS.BACKER_ORG),
  );
  assertEquals(parseContentBackers("o".repeat(LIMITS.BACKER_ORG) + " | $10").length, 1);
});
