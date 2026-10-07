import { afterEach, expect, it } from "vitest";
import { rememberSponsorsHeight, SPONSORS_SCRIPT } from "./sponsors-height";

const root = document.documentElement;
afterEach(() => {
  localStorage.clear();
  root.style.removeProperty("--sponsors-h");
});

const run = (pathname: string, innerWidth: number) => {
  root.style.removeProperty("--sponsors-h");
  new Function("location", "innerWidth", SPONSORS_SCRIPT)({ pathname }, innerWidth);
  return root.style.getPropertyValue("--sponsors-h");
};

it("the head script sizes the placeholder to the panel this device last drew at this width", () => {
  expect(run("/", 390)).toBe(""); // a first visit: the placeholder's own height
  rememberSponsorsHeight(390, 353);
  expect(run("/", 390)).toBe("353px");
  expect(run("/", 1280)).toBe(""); // another width lays the panel out differently
  expect(run("/submit", 390)).toBe(""); // the board only
  rememberSponsorsHeight(1280, 120);
  expect(run("/", 1280)).toBe("120px");
});

it("junk in storage leaves the placeholder as it is", () => {
  localStorage.setItem("thedao:sponsors-height", "nope");
  expect(run("/", 390)).toBe("");
  localStorage.setItem("thedao:sponsors-height", '[390,"1px;color:red"]');
  expect(run("/", 390)).toBe("");
});
