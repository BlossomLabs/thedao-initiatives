import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import TermsChangeNotice from "./TermsChangeNotice";
import { materialNoticeActive } from "~/hooks/use-terms";

const DAY = 86400;
const v = (material: boolean, ageDays: number) => ({
  id: "a".repeat(64),
  effectiveDate: "2026-10-01",
  material,
  publishedAt: Date.now() / 1000 - ageDays * DAY,
});

describe("TermsChangeNotice", () => {
  it("shows for 30 days after a material change, then stops", () => {
    expect(materialNoticeActive(v(true, 1))).toBe(true);
    expect(materialNoticeActive(v(true, 29))).toBe(true);
    expect(materialNoticeActive(v(true, 31))).toBe(false);
    expect(materialNoticeActive(v(false, 1))).toBe(false);
    expect(materialNoticeActive({ ...v(true, 1), publishedAt: null })).toBe(false);
    expect(materialNoticeActive(undefined)).toBe(false);
  });

  it("renders the banner on the page and the one-liner under the widget", () => {
    render(<TermsChangeNotice terms={v(true, 2)} />);
    expect(screen.getByRole("status").textContent).toContain(
      "These donation terms changed on October 1, 2026",
    );
    render(<TermsChangeNotice terms={v(true, 2)} compact />);
    expect(screen.getByRole("link", { name: "Read the current terms" })).toHaveAttribute(
      "href",
      "/donation-terms",
    );
  });

  it("renders nothing for a non-material or old version", () => {
    const { container } = render(<TermsChangeNotice terms={v(true, 40)} />);
    expect(container).toBeEmptyDOMElement();
  });
});
