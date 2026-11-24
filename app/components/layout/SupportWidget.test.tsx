import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

describe("the floating button and the footer", () => {
  it("rests right above the legal bar once the bar reaches it, and back down after", () => {
    let seen: ((entries: { isIntersecting: boolean }[]) => void) | undefined;
    let margin = "";
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(cb: typeof seen, opts: { rootMargin: string }) {
          seen = cb;
          margin = opts.rootMargin;
        }
        observe() {}
        disconnect() {}
      },
    );
    vi.stubGlobal("scrollY", 1000);
    const footer = document.createElement("div");
    footer.setAttribute("data-site-footer", "");
    footer.getBoundingClientRect = () => ({ top: 700 } as DOMRect);
    document.body.append(footer);
    const page = vi.spyOn(document.documentElement, "scrollHeight", "get").mockReturnValue(1900);
    try {
      render(<SupportPanel />);
      const button = screen.getByRole("button", { name: /support/i });
      const mover = button.parentElement!;
      expect(mover.style.bottom).toBe("16px");
      expect(margin).toBe("0px 0px -60px 0px"); // the strip the button stands in
      // The legal bar: 1900 − (700 + 1000) = 200px to the page's end.
      act(() => seen!([{ isIntersecting: true }]));
      expect(mover.style.bottom).toBe("216px");
      expect(mover.className).toContain("transition-[bottom]");
      fireEvent.click(button);
      expect(screen.getByRole("dialog").style.bottom).toBe("266px");
      act(() => seen!([{ isIntersecting: false }]));
      expect(mover.style.bottom).toBe("16px");
    } finally {
      page.mockRestore();
      footer.remove();
    }
  });
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

  /** The receipt details the issue asks for: who it's issued to, legal name, country. */
  function fillDetails(address = "") {
    fireEvent.click(screen.getByRole("radio", { name: "Organization" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Legal name" }), {
      target: { value: " Acme Foundation " },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Country" }), {
      target: { value: "Switzerland" },
    });
    if (address) {
      fireEvent.change(screen.getByRole("textbox", { name: "Address (optional)" }), {
        target: { value: address },
      });
    }
  }

  it("requires an email, transaction link and receipt details, with no message needed", async () => {
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
    expect(screen.getByRole("textbox", { name: "Legal name" })).toBeRequired();
    expect(screen.getByRole("textbox", { name: "Country" })).toBeRequired();
    expect(screen.getByRole("textbox", { name: "Address (optional)" })).not.toBeRequired();
    expect(
      screen.getByText(
        "We'll email your receipt once the donation is confirmed and the initiative funding goal is reached.",
      ),
    ).toBeInTheDocument();
    expect(send).toBeDisabled();
    fillDetails("1 Main St, Zug");
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
      receiptIssuedTo: "organization",
      receiptName: "Acme Foundation",
      receiptCountry: "Switzerland",
      receiptAddress: "1 Main St, Zug",
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
    fillDetails();
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
    fillDetails();
    fireEvent.click(send);
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    expect(screen.getByRole("textbox", { name: "Email" })).toHaveValue("donor@example.com");
    expect(screen.getByRole("textbox", { name: "Transaction link" })).toHaveValue(transactionUrl);
    expect(screen.getByRole("textbox", { name: "Legal name" })).toHaveValue(" Acme Foundation ");
    expect(screen.getByRole("radio", { name: "Organization" })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: /support/i }));
    fireEvent.click(screen.getByRole("button", { name: "Request a donation receipt" }));
    expect(screen.getByRole("textbox", { name: "Email" })).toHaveValue("");
    expect(screen.getByRole("textbox", { name: "Transaction link" })).toHaveValue("");
    expect(screen.getByRole("textbox", { name: "Legal name" })).toHaveValue("");
    expect(screen.getByRole("radio", { name: "Organization" })).not.toBeChecked();
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
    expect(JSON.parse(String(init.body))).not.toHaveProperty("receiptName");
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
