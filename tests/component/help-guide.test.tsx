// The help guide (FR-032, FR-037): opens from the header, says what is and is not kept, lists the
// known limits, and behaves as a dialog for keyboard users.

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../../src/App";

afterEach(cleanup);

const open = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole("button", { name: "Help & guide" }));
  return screen.getByRole("dialog", { name: "Help & guide" });
};

describe("the help guide", () => {
  it("opens from the header and says what stays on the device", async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const dialog = await open(user);
    expect(dialog).toHaveTextContent("Nothing is saved in the browser");
    expect(dialog).toHaveTextContent("never holds lists of IDs");
  });

  it("lists the known limits", async () => {
    const user = userEvent.setup();
    render(<App />);
    const dialog = await open(user);
    for (const limit of ["No cross-column logic.", "Joins across tables do not work.", "Labels are real.", "Memory limits table size.", "Not in this version."]) {
      expect(within(dialog).getByText(limit)).toBeInTheDocument();
    }
  });

  it("has no links, so it cannot send anyone or anything off the site", async () => {
    const user = userEvent.setup();
    render(<App />);
    const dialog = await open(user);
    expect(dialog.querySelectorAll("a[href]")).toHaveLength(0);
  });

  it("closes with Escape and returns focus to the Help button", async () => {
    const user = userEvent.setup();
    render(<App />);
    const button = screen.getByRole("button", { name: "Help & guide" });
    await open(user);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });

  it("moves focus into the dialog and keeps Tab inside it", async () => {
    const user = userEvent.setup();
    render(<App />);
    const dialog = await open(user);
    const close = within(dialog).getByRole("button", { name: "Close" });
    expect(dialog.contains(document.activeElement)).toBe(true);
    close.focus();
    await user.tab(); // from the last control, back into the dialog
    expect(dialog.contains(document.activeElement)).toBe(true);
    await user.tab({ shift: true });
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("closes from its Close button", async () => {
    const user = userEvent.setup();
    render(<App />);
    const dialog = await open(user);
    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
