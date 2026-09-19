import { afterEach, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MotionGlobalConfig } from "motion/react";
import { useState } from "react";
import Reveal from "./Reveal";
import Pop from "./Pop";

function Toggles() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen((o) => !o)}>toggle</button>
      <Reveal show={open} className="mt-2">
        <p>in-flow panel</p>
      </Reveal>
      <Pop show={open} as="nav" aria-label="Floating">
        <p>floating panel</p>
      </Pop>
    </>
  );
}

afterEach(() => {
  cleanup();
  MotionGlobalConfig.skipAnimations = true;
});

it("mounts on show and unmounts on hide in the same tick when animations are skipped", () => {
  render(<Toggles />);
  expect(screen.queryByText("in-flow panel")).not.toBeInTheDocument();
  fireEvent.click(screen.getByText("toggle"));
  expect(screen.getByText("in-flow panel").parentElement).toHaveClass("mt-2");
  expect(screen.getByRole("navigation", { name: "Floating" })).toHaveTextContent("floating panel");
  fireEvent.click(screen.getByText("toggle"));
  expect(screen.queryByText("in-flow panel")).not.toBeInTheDocument();
  expect(screen.queryByText("floating panel")).not.toBeInTheDocument();
});

it("keeps a closing panel mounted until its exit animation ends", async () => {
  MotionGlobalConfig.skipAnimations = false;
  render(<Toggles />);
  fireEvent.click(screen.getByText("toggle"));
  expect(screen.getByText("in-flow panel")).toBeInTheDocument();
  fireEvent.click(screen.getByText("toggle"));
  expect(screen.getByText("in-flow panel")).toBeInTheDocument();
  expect(screen.getByText("floating panel")).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByText("in-flow panel")).not.toBeInTheDocument());
  await waitFor(() => expect(screen.queryByText("floating panel")).not.toBeInTheDocument());
});

it("with a peek, a folded panel keeps its content mounted, clipped and inert", () => {
  function Box() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button type="button" onClick={() => setOpen((o) => !o)}>toggle</button>
        <Reveal show={open} peek={120} id="box">
          <p>long text</p>
        </Reveal>
      </>
    );
  }
  render(<Box />);
  const box = document.getElementById("box")!;
  expect(screen.getByText("long text")).toBeInTheDocument();
  expect(box).toHaveAttribute("inert");
  expect(box).toHaveStyle({ height: "120px", overflow: "hidden" });
  fireEvent.click(screen.getByText("toggle"));
  expect(box).not.toHaveAttribute("inert");
  expect(box.style.height).toBe("");
});
