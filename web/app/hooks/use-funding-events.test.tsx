import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { fundingEventsUrl, useFundingEvents } from "./use-funding-events";

/** A stand-in EventSource that lets the test dispatch named events. */
class FakeEventSource extends EventTarget {
  static instances: FakeEventSource[] = [];
  closed = false;
  constructor(public url: string, public init?: EventSourceInit) {
    super();
    FakeEventSource.instances.push(this);
  }
  close() {
    this.closed = true;
  }
  emit(version: string) {
    this.dispatchEvent(new MessageEvent("funding", { data: version }));
  }
}

describe("useFundingEvents", () => {
  let qc: QueryClient;
  let invalidate: ReturnType<typeof vi.spyOn>;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );

  beforeEach(() => {
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource);
    qc = new QueryClient();
    invalidate = vi.spyOn(qc, "invalidateQueries").mockResolvedValue(undefined);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("opens the stream, ignores the first (current) version, refetches on a later change", () => {
    const { unmount } = renderHook(() => useFundingEvents("vyper-compiler", true), { wrapper });
    expect(FakeEventSource.instances).toHaveLength(1);
    const es = FakeEventSource.instances[0];
    expect(es.url).toBe(fundingEventsUrl("vyper-compiler"));
    expect(es.init?.withCredentials).toBe(true);

    es.emit("3");
    expect(invalidate).not.toHaveBeenCalled();
    es.emit("3"); // a reconnect replays the same version: still nothing
    expect(invalidate).not.toHaveBeenCalled();
    es.emit("4");
    expect(invalidate).toHaveBeenCalledTimes(2);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["initiative", "vyper-compiler"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["board"] });

    unmount();
    expect(es.closed).toBe(true);
  });

  it("does nothing while disabled", () => {
    renderHook(() => useFundingEvents("vyper-compiler", false), { wrapper });
    expect(FakeEventSource.instances).toHaveLength(0);
  });
});
