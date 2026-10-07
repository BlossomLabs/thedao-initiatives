import { act, fireEvent, render, screen } from "@testing-library/react";
import { createMemoryRouter, Link, Outlet, RouterProvider } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import AppUpgrade from "./AppUpgrade";
import { noteServerVersion, page, resetUpgrade, upgradeOrTell } from "~/lib/app-upgrade";

const manifest = globalThis as { __reactRouterManifest?: { version?: string } };
let reload: ReturnType<typeof vi.fn>;
beforeEach(() => {
  resetUpgrade();
  sessionStorage.clear();
  manifest.__reactRouterManifest = { version: "old" };
  reload = vi.fn();
  page.reload = reload as unknown as () => void;
});
afterEach(() => {
  manifest.__reactRouterManifest = undefined;
});

function show() {
  const router = createMemoryRouter([{
    path: "/",
    element: (
      <>
        <AppUpgrade />
        <Link to="/submit">Submit</Link>
        <textarea aria-label="Comment" />
        <Outlet />
      </>
    ),
    children: [{ index: true, element: null }, { path: "submit", element: null }],
  }]);
  render(<RouterProvider router={router} />);
}
const behind = () =>
  act(() => {
    noteServerVersion(new Response("{}", { headers: { "X-App-Version": "new" } }));
    upgradeOrTell();
  });

it("in front of a reader it only says a refresh is due, and keeps saying it", () => {
  show();
  behind();
  expect(reload).not.toHaveBeenCalled();
  const notice = screen.getByRole("status");
  expect(notice).toHaveTextContent(
    "A new version of this site is available. Refresh the page to get it.",
  );
  expect(notice.querySelector("button")).toBeNull();
  behind();
  expect(screen.getByRole("status")).toBeInTheDocument();
});

it("coming back to the tab with nothing to lose, it reloads without a word", () => {
  show();
  act(() => {
    noteServerVersion(new Response("{}", { headers: { "X-App-Version": "new" } }));
    upgradeOrTell(true);
  });
  expect(reload).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("status")).toBeNull();
});

it("with text typed it does not reload even on coming back", () => {
  show();
  fireEvent.input(screen.getByLabelText("Comment"), { target: { value: "half a comment" } });
  act(() => {
    noteServerVersion(new Response("{}", { headers: { "X-App-Version": "new" } }));
    upgradeOrTell(true);
  });
  expect(reload).not.toHaveBeenCalled();
  expect(screen.getByRole("status")).toBeInTheDocument();
  expect(screen.getByLabelText("Comment")).toHaveValue("half a comment");
});

it("moving to another page reloads there, notice or not", () => {
  show();
  fireEvent.input(screen.getByLabelText("Comment"), { target: { value: "half a comment" } });
  behind();
  expect(screen.getByRole("status")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("link", { name: "Submit" }));
  expect(reload).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("status")).toBeNull();
});
