import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { vi } from "vitest";
import Admins from "./Admins";
import type { AdminList } from "~/lib/api-types";

const api = vi.fn();
vi.mock("~/lib/api", async (orig) => ({
  ...(await orig<typeof import("~/lib/api")>()),
  api: (...args: unknown[]) => api(...args),
}));

const FIXED = "0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A";
const ADDED = "0x1563915e194D8CfBA1943570603F7606A3115508";
const NEW = "0x839395e20bbB182fa440d08F850E6c7A8f6F0780";

function mount(list: AdminList) {
  api.mockReset();
  api.mockImplementation((path: string, opts?: { method?: string; json?: { address: string } }) => {
    if (path === "/api/admin/admins" && !opts) return Promise.resolve(list);
    if (path === "/api/admin/admins" && opts?.json) {
      if (opts.json.address === "0xbad") return Promise.reject(new Error("that is not an Ethereum address"));
      return Promise.resolve({ ...list, admins: [...list.admins, { address: opts.json.address, fixed: false }] });
    }
    if (opts?.method === "DELETE") {
      const a = path.split("/").pop()!;
      return Promise.resolve({ ...list, admins: list.admins.filter((x) => x.address !== a) });
    }
    return Promise.reject(new Error("unexpected " + path));
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Admins />
    </QueryClientProvider>,
  );
}

test("fixed admins show a lock and no remove button; you cannot remove yourself", async () => {
  mount({ admins: [{ address: FIXED, fixed: true }, { address: ADDED, fixed: false }], you: ADDED });
  expect(await screen.findByText("0x19E7…ff2A")).toBeInTheDocument();
  expect(screen.getByTitle("Set in ADMIN_ADDRESSES")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Remove 0x19E7…ff2A" })).toBeNull();
  expect(screen.getByText("(you)")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Remove 0x1563…5508" })).toBeDisabled();
});

test("adding an address posts it and shows the new row; errors show inline", async () => {
  mount({ admins: [{ address: FIXED, fixed: true }], you: FIXED });
  await screen.findByText("0x19E7…ff2A");
  const input = screen.getByLabelText("Wallet address");
  fireEvent.change(input, { target: { value: NEW } });
  fireEvent.click(screen.getByRole("button", { name: /Add admin/ }));
  expect(await screen.findByText("0x8393…0780")).toBeInTheDocument();
  expect(api).toHaveBeenCalledWith("/api/admin/admins", { json: { address: NEW } });
  expect(screen.getByRole("status")).toHaveTextContent("0x8393…0780 is an admin now.");
  expect(input).toHaveValue("");

  fireEvent.change(input, { target: { value: "0xbad" } });
  fireEvent.click(screen.getByRole("button", { name: /Add admin/ }));
  expect(await screen.findByRole("alert")).toHaveTextContent("that is not an Ethereum address");
});

test("removing another admin deletes it and drops the row", async () => {
  mount({ admins: [{ address: FIXED, fixed: true }, { address: ADDED, fixed: false }], you: FIXED });
  await screen.findByText("0x1563…5508");
  fireEvent.click(screen.getByRole("button", { name: "Remove 0x1563…5508" }));
  await waitFor(() => expect(screen.queryByText("0x1563…5508")).toBeNull());
  expect(api).toHaveBeenCalledWith(`/api/admin/admins/${ADDED}`, { method: "DELETE" });
  expect(screen.getByRole("status")).toHaveTextContent("is no longer an admin");
});
