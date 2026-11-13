# Agents

## Writing the vote tiers

In prose, comments, docs, UI copy and test names, a tier is always written
**S-Tier**, **A-Tier** or **B-Tier**: a capital tier letter, a hyphen, then "Tier".
Several at once are spelled out in full: "S-Tier, A-Tier and B-Tier".

Never write "S tier", "S-tier", "s-tier", "tier S", "S-TIER", "Tier-S", "Tier-A",
"Tier-B", "S/A/B" or "S, A and B tiers".

The bare letter stands alone only where it is data or the tier table itself:
the `Tier` type (`"S" | "A" | "B"`), ballot bytes and fixtures, and the row
labels in the tier table. In code that renders a tier in running text, use
`tierName()` from `shared/vote/ballot.ts`.

## Writing dates

Dates read like "Nov 1, 14:00": short month, day without a leading zero, a
24-hour clock. No weekday, no time zone name, no seconds. Add the year only
when it isn't obvious: "Nov 1, 2026" for past records (`dt()`).

Use the helpers in `app/lib/format.ts`: `dayTime()` ("Nov 1, 14:00"),
`shortDay()` ("Nov 1"), `clock()` ("14:00") and `dt()` ("Nov 1, 2026").
Times show in the reader's own time zone. UTC appears only in a hover title
(`<When>` in `app/components/vote/When.tsx`). Feeds written for agents
(`api/services/vote-llms.ts`) keep their ISO-style UTC times.
