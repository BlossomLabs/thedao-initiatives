import { render } from "@testing-library/react";
import ShellSkeleton, { SHELL_SCRIPT } from "./ShellSkeleton";

describe("ShellSkeleton", () => {
  it("carries both page shapes for the head script to pick from", () => {
    const { container } = render(<ShellSkeleton />);
    expect(container.querySelector(".shell-detail main")).toBeInTheDocument();
    expect(container.querySelector(".shell-dashboard main")).toBeInTheDocument();
  });

  it("the head script marks the dashboard, and only the dashboard", () => {
    const run = (pathname: string) => {
      delete document.documentElement.dataset.shell;
      new Function("location", SHELL_SCRIPT)({ pathname });
      return document.documentElement.dataset.shell;
    };
    expect(run("/admin")).toBe("dashboard");
    expect(run("/admin/")).toBe("dashboard");
    expect(run("/admin/initiatives/some-slug")).toBeUndefined();
    expect(run("/admin/leads")).toBeUndefined();
    expect(run("/admin/maintenance")).toBeUndefined();
    expect(run("/initiative/some-slug")).toBeUndefined();
    expect(run("/administrator")).toBeUndefined();
  });
});
