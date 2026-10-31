// FR-033: profiling and generating show progress and can be cancelled; a large file shows a warning.

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GenerateProgress } from "../../src/features/generate/GenerateProgress";
import { ProfileProgress } from "../../src/features/ingest/ProfileProgress";
import { SizeWarning } from "../../src/features/ingest/SizeWarning";

afterEach(cleanup);

describe("ProfileProgress", () => {
  it("shows a percentage and cancels", async () => {
    const onCancel = vi.fn();
    render(<ProfileProgress progress={{ job: "profile", done: 30, total: 120 }} label="Profiling columns" onCancel={onCancel} />);
    expect(screen.getByRole("status")).toHaveTextContent("Profiling columns (25%)");
    expect(screen.getByRole("progressbar")).toHaveAttribute("value", "25");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("shows a working bar, with no made-up percentage, while the total is unknown", () => {
    render(<ProfileProgress progress={null} label="Reading the file" />);
    expect(screen.getByRole("status")).toHaveTextContent(/^Reading the file$/);
    expect(screen.getByRole("progressbar")).not.toHaveAttribute("value");
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
  });
});

describe("GenerateProgress", () => {
  it("shows rows done, a percentage, and cancels", async () => {
    const onCancel = vi.fn();
    render(<GenerateProgress progress={{ job: "generate", done: 2500, total: 10000 }} onCancel={onCancel} />);
    expect(screen.getByRole("status")).toHaveTextContent("Generating (25%)");
    expect(screen.getByText("2,500 of 10,000 rows")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("starts at 0%", () => {
    render(<GenerateProgress progress={null} onCancel={() => {}} />);
    expect(screen.getByRole("status")).toHaveTextContent("Generating (0%)");
  });
});

describe("SizeWarning", () => {
  it("is absent for a small file and present for a large one", () => {
    const { rerender } = render(<SizeWarning fileSize={1024} encoding="utf-8" />);
    expect(screen.queryByTestId("size-warning")).not.toBeInTheDocument();
    rerender(<SizeWarning fileSize={400 * 1024 * 1024} encoding="windows-1252" />);
    expect(screen.getByTestId("size-warning")).toHaveTextContent(/400 MB/);
    expect(screen.getByTestId("size-warning")).toHaveTextContent(/twice the file size/);
  });
});
