import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
        "too many messages, try again in an hour",
      )
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByRole("textbox", { name: "Message" })).toHaveValue("hello");
  });
});
