import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import TermsPage from "./terms";
import { formatEffectiveDate, TERMS, TERMS_VERSIONS } from "~/data/terms";

test("the terms page shows the version in force and links every earlier one", () => {
  render(
    <MemoryRouter>
      <TermsPage />
    </MemoryRouter>,
  );
  expect(screen.getByText("Effective " + formatEffectiveDate(TERMS.effectiveDate)))
    .toBeInTheDocument();
  const links = screen.queryAllByRole("link", { name: /^Effective / });
  expect(links).toHaveLength(TERMS_VERSIONS.length - 1);
  if (!links.length) expect(screen.getByText(/No earlier versions/)).toBeInTheDocument();
});
