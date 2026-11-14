import { afterEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import Sponsors from "~/components/board/Sponsors";
import PledgeRequestLink from "~/components/initiative/PledgeRequestLink";
import { SupportPanel } from "./SupportWidget";

const board = vi.hoisted(() => ({
  data: {
    cards: [
      { initiative: { id: "grant-id", title: "Compiler security", status: "approved" } },
      { initiative: { id: "rfp-id", title: "Wallet review", status: "approved" } },
      { initiative: { id: "private-id", title: "Private draft", status: "pending" } },
    ],
  },
  isPending: false,
  isError: false,
  refetch: vi.fn(),
}));
vi.mock("~/hooks/use-board", () => ({ useBoard: () => board }));
vi.mock("~/hooks/use-site-settings", () => ({
  useSiteSettings: () => ({ data: { support: true } }),
}));

afterEach(() => vi.unstubAllGlobals());

function openForm() {
  render(
    <>
      <Sponsors sponsors={[{ company: "Acme", totalUsd: 5000, logoUrl: "", url: "" }]} canPledge />
      <SupportPanel />
    </>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Pledge to an Initiative" }));
  expect(screen.getByRole("dialog")).toHaveTextContent("Pledge to an Initiative");
}

async function fillForm() {
  fireEvent.click(screen.getByRole("button", { name: "Show initiatives" }));
  expect(screen.queryByRole("option", { name: "Private draft" })).not.toBeInTheDocument();
  const option = await screen.findByRole("option", { name: "Compiler security" });
  // The portaled options belong to Support: selecting one must not dismiss the form.
  fireEvent.pointerDown(option);
  fireEvent.click(option);
  fireEvent.change(screen.getByRole("textbox", { name: "Pledge Amount (USD)" }), {
    target: { value: "$25,000.50" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: "Pledge Organization" }), {
    target: { value: " Acme " },
  });
  fireEvent.change(screen.getByRole("textbox", { name: "Pledge Contact Email" }), {
    target: { value: " donor@example.com " },
  });
  fireEvent.change(screen.getByRole("textbox", { name: "Who are we talking with?" }), {
    target: { value: " Alex " },
  });
  fireEvent.change(screen.getByRole("textbox", { name: "Message" }), {
    target: { value: " We would like to fund this work. " },
  });
}

it("opens from Sponsors and sends the selected initiative and all pledge contact details", async () => {
  const fetchMock = vi.fn(() => Promise.resolve(new Response('{"ok":true}')));
  vi.stubGlobal("fetch", fetchMock);
  openForm();
  expect(screen.getByRole("combobox", { name: "Initiative" })).toHaveFocus();
  expect(screen.getByRole("button", { name: "Send pledge request" })).toBeDisabled();
  expect(fetchMock).not.toHaveBeenCalled();
  await fillForm();
  fireEvent.click(screen.getByRole("button", { name: "Send pledge request" }));
  await screen.findByText("Your pledge request has been sent. We’ll be in touch.");
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("/api/support");
  expect(JSON.parse(String(init.body))).toEqual({
    category: "pledge",
    initiativeId: "grant-id",
    pledgeAmount: 25000.5,
    pledgeOrg: "Acme",
    email: "donor@example.com",
    pledgeContact: "Alex",
    message: "We would like to fund this work.",
    page: "/",
  });
});

it("validates amount and email, and preserves pledge details after failed delivery", async () => {
  const fetchMock = vi.fn(() =>
    Promise.resolve(new Response('{"error":"delivery failed"}', { status: 502 }))
  );
  vi.stubGlobal("fetch", fetchMock);
  openForm();
  await fillForm();
  fireEvent.change(screen.getByRole("textbox", { name: "Pledge Amount (USD)" }), {
    target: { value: "-1" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: "Pledge Contact Email" }), {
    target: { value: "not-an-email" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send pledge request" }));
  expect(screen.getByText(/Enter a pledge amount/)).toBeInTheDocument();
  expect(screen.getByText("Enter a valid pledge contact email.")).toBeInTheDocument();
  expect(fetchMock).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole("textbox", { name: "Pledge Amount (USD)" }), {
    target: { value: "25000" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: "Pledge Contact Email" }), {
    target: { value: "donor@example.com" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send pledge request" }));
  await screen.findByRole("alert");
  expect(screen.getByRole("combobox", { name: "Initiative" })).toHaveValue("Compiler security");
  expect(screen.getByRole("textbox", { name: "Pledge Organization" })).toHaveValue(" Acme ");
  expect(screen.getByRole("textbox", { name: "Who are we talking with?" })).toHaveValue(" Alex ");
  expect(screen.getByRole("button", { name: "Send pledge request" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  fireEvent.click(screen.getByRole("button", { name: "Pledge to an Initiative" }));
  expect(screen.getByRole("textbox", { name: "Pledge Organization" })).toHaveValue("");
});

it("searches initiatives and closes the choices on Escape while keeping the form open", async () => {
  openForm();
  await fillForm();
  const input = screen.getByRole("combobox", { name: "Initiative" });
  fireEvent.input(input, { target: { value: "Wallet" }, inputType: "insertText" });
  await screen.findByRole("option", { name: "Wallet review" });
  expect(screen.queryByRole("option", { name: "Compiler security" })).not.toBeInTheDocument();
  expect(screen.getByText("Send pledge request").closest("button")).toBeDisabled();
  fireEvent.keyDown(input, { key: "Escape" });
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  expect(input).toHaveValue("Compiler security");
});

it("preselects the initiative from its support form link and updates when opened for another initiative", () => {
  const view = (initiativeId: string) => (
    <>
      <PledgeRequestLink initiativeId={initiativeId} />
      <SupportPanel />
    </>
  );
  const { rerender } = render(view("grant-id"));
  fireEvent.click(screen.getByRole("button", { name: "support form" }));
  expect(screen.getByRole("combobox", { name: "Initiative" })).toHaveValue("Compiler security");
  expect(screen.getByRole("textbox", { name: "Pledge Amount (USD)" })).toHaveFocus();
  rerender(view("rfp-id"));
  fireEvent.click(screen.getByRole("button", { name: "support form" }));
  expect(screen.getByRole("combobox", { name: "Initiative" })).toHaveValue("Wallet review");
  expect(screen.getByRole("textbox", { name: "Pledge Amount (USD)" })).toHaveFocus();
});
