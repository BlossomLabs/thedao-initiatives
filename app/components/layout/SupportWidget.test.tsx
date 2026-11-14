import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { SUPPORT_MESSAGE_MAX, SUPPORT_TRANSACTION_URL_MAX } from "@shared/support";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import SupportWidget, { SupportPanel } from "./SupportWidget";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

afterEach(() => {
  vi.unstubAllGlobals();
});

function openPicker() {
  render(<SupportPanel />);
  fireEvent.click(screen.getByRole("button", { name: /support/i }));
  return screen.getByRole("dialog");
}

/** The gate reads configuration without loading the funding board. */
function renderGated(support: boolean) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) =>
      Promise.resolve(
        url === "/api/board/settings" ? json(200, { support }) : json(404, { error: "no" }),
      )
    ),
  );
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <SupportWidget />
    </QueryClientProvider>,
  );
}

describe("SupportWidget gate", () => {
  it("shows no button until the board says support is configured", async () => {
    renderGated(false);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: /support/i })).not.toBeInTheDocument();
  });

  it("shows the button once the board says support is configured", async () => {
    renderGated(true);
    expect(await screen.findByRole("button", { name: /support/i })).toBeInTheDocument();
  });
});

describe("SupportPanel", () => {
  it("opens to the category picker and closes on Escape", () => {
    const dialog = openPicker();
    expect(dialog).toHaveTextContent("How can we help?");
    expect(screen.getByRole("button", { name: "Report a problem" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Suggest an improvement" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Request a donation receipt" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Something else" })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("back returns to the picker from the form", () => {
    openPicker();
    fireEvent.click(screen.getByRole("button", { name: "Suggest an improvement" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Suggest an improvement");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("How can we help?");
  });

  it("sends the category, email, message and page to /api/support, then thanks", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(json(200, { ok: true })));
    vi.stubGlobal("fetch", fetchMock);
    openPicker();
    fireEvent.click(screen.getByRole("button", { name: "Report a problem" }));
    const message = screen.getByRole("textbox", { name: "Message" });
    expect(message).toHaveFocus();
    fireEvent.change(screen.getByRole("textbox", { name: /email/i }), {
      target: { value: "me@example.com" },
    });
    fireEvent.change(message, { target: { value: "The donate button does nothing." } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(screen.getByRole("dialog")).toHaveTextContent("Thanks"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/support");
    expect(JSON.parse(String(init.body))).toEqual({
      category: "problem",
      email: "me@example.com",
      message: "The donate button does nothing.",
      page: "/",
    });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("send stays disabled until there is a message", () => {
    openPicker();
    fireEvent.click(screen.getByRole("button", { name: "Something else" }));
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: "Message" }), {
      target: { value: "hi" },
    });
    expect(screen.getByRole("button", { name: "Send" })).toBeEnabled();
  });

  it("shows the server's error and keeps the message for a retry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(json(429, { error: "too many messages, try again in an hour" }))),
    );
    openPicker();
    fireEvent.click(screen.getByRole("button", { name: "Something else" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Message" }), {
      target: { value: "hello" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() =>
      expect(screen.getByRole("dialog")).toHaveTextContent(
        "Too many messages, try again in an hour.",
      )
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByRole("textbox", { name: "Message" })).toHaveValue("hello");
  });
});

describe("SupportPanel receipt requests", () => {
  const transactionUrl = `https://etherscan.io/tx/0x${"ab".repeat(32)}`;

  function openReceipt() {
    openPicker();
    fireEvent.click(screen.getByRole("button", { name: "Request a donation receipt" }));
    return {
      email: screen.getByRole("textbox", { name: "Email" }),
      transaction: screen.getByRole("textbox", { name: "Transaction link" }),
      send: screen.getByRole("button", { name: "Send request" }),
    };
  }

  it("requires an email and transaction link, with no message needed", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(json(200, { ok: true })));
    vi.stubGlobal("fetch", fetchMock);
    const { email, transaction, send } = openReceipt();
    expect(email).toHaveFocus();
    expect(email).toBeRequired();
    expect(transaction).toBeRequired();
    expect(screen.getByRole("textbox", { name: "Message (optional)" })).not.toBeRequired();
    expect(send).toBeDisabled();
    fireEvent.change(email, { target: { value: " donor@example.com " } });
    expect(send).toBeDisabled();
    fireEvent.change(transaction, { target: { value: ` ${transactionUrl} ` } });
    expect(send).toBeEnabled();
    fireEvent.click(send);
    await screen.findByText("Your donation receipt request has been sent.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/support");
    expect(JSON.parse(String(init.body))).toEqual({
      category: "receipt",
      email: "donor@example.com",
      transactionUrl,
      message: "",
      page: "/",
    });
  });

  it("shows field errors and refuses an invalid email or transaction link", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { email, transaction, send } = openReceipt();
    fireEvent.change(email, { target: { value: "not-an-email" } });
    fireEvent.change(transaction, { target: { value: "javascript:alert(1)" } });
    fireEvent.click(send);
    expect(screen.getByText("Enter a valid email for the receipt.")).toBeInTheDocument();
    expect(screen.getByText("Enter a valid https transaction link.")).toBeInTheDocument();
    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(transaction).toHaveAttribute("aria-invalid", "true");
    fireEvent.change(email, { target: { value: "donor@example.com" } });
    fireEvent.change(transaction, {
      target: { value: `https://etherscan.io/${"x".repeat(SUPPORT_TRANSACTION_URL_MAX)}` },
    });
    fireEvent.click(send);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The transaction link is too long (500 characters at most).",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps receipt details for a failed delivery, then clears them on close", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(json(502, { error: "delivery failed" }))));
    const { email, transaction, send } = openReceipt();
    fireEvent.change(email, { target: { value: "donor@example.com" } });
    fireEvent.change(transaction, { target: { value: transactionUrl } });
    fireEvent.click(send);
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    expect(screen.getByRole("textbox", { name: "Email" })).toHaveValue("donor@example.com");
    expect(screen.getByRole("textbox", { name: "Transaction link" })).toHaveValue(transactionUrl);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: /support/i }));
    fireEvent.click(screen.getByRole("button", { name: "Request a donation receipt" }));
    expect(screen.getByRole("textbox", { name: "Email" })).toHaveValue("");
    expect(screen.getByRole("textbox", { name: "Transaction link" })).toHaveValue("");
  });

  it("does not include a transaction link after switching to another support category", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(json(200, { ok: true })));
    vi.stubGlobal("fetch", fetchMock);
    const { transaction } = openReceipt();
    fireEvent.change(transaction, { target: { value: transactionUrl } });
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(screen.getByRole("button", { name: "Something else" }));
    expect(screen.queryByRole("textbox", { name: "Transaction link" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Message" }), {
      target: { value: "Another question" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByText("Thanks for writing. We read every message.");
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).not.toHaveProperty("transactionUrl");
  });
});

describe("SupportWidget message cap", () => {
  it("names an over-long message under the box and will not send it", () => {
    const dialog = openPicker();
    fireEvent.click(within(dialog).getByRole("button", { name: /problem/i }));
    const box = within(dialog).getByLabelText("Message");
    // jsdom does not enforce maxLength: this is the paste that lands past the cap
    fireEvent.change(box, { target: { value: "m".repeat(SUPPORT_MESSAGE_MAX + 1) } });
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "The message is too long (4,000 characters at most).",
    );
    expect(within(dialog).getByRole("button", { name: /send/i })).toBeDisabled();
    expect(box).toHaveAttribute("maxlength", String(SUPPORT_MESSAGE_MAX + 2));
  });
});
