import { render, screen } from "@testing-library/react";
import { Suspense } from "react";
import { expect, it, vi } from "vitest";
import { lazyPart } from "./lazy-part";

const StandIn = ({ label }: { label: string }) => <button type="button">{label} (stand-in)</button>;
const Real = ({ label }: { label: string }) => <button type="button">{label} (real)</button>;

it("shows the loaded part once its chunk arrives", async () => {
  const part = lazyPart(() => Promise.resolve({ default: Real }), StandIn);
  render(
    <Suspense fallback={<StandIn label="Menu" />}>
      <part.Component label="Menu" />
    </Suspense>,
  );
  expect(await screen.findByText("Menu (real)")).toBeInTheDocument();
});

it("keeps the stand-in when the chunk fails, and a later preload tries again", async () => {
  const load = vi.fn()
    .mockRejectedValueOnce(new Error("chunk failed"))
    .mockResolvedValue({ default: Real });
  const part = lazyPart(load, StandIn);
  render(
    <Suspense fallback={null}>
      <part.Component label="Menu" />
    </Suspense>,
  );
  expect(await screen.findByText("Menu (stand-in)")).toBeInTheDocument();
  await expect(part.preload()).resolves.toEqual({ default: Real });
  expect(load).toHaveBeenCalledTimes(2);
});
