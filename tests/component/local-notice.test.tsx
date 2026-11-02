// The privacy notice under the navbar can be closed, and nothing is written to browser storage when it is.
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { LocalNotice } from "../../src/app/LocalNotice";

afterEach(() => window.localStorage.clear());

describe("LocalNotice", () => {
  it("says the data stays on the device, and goes away when dismissed", async () => {
    render(<LocalNotice />);
    expect(screen.getByRole("note", { name: "Privacy" })).toHaveTextContent(/never uploaded/);
    await userEvent.click(screen.getByRole("button", { name: "Dismiss the privacy notice" }));
    expect(screen.queryByRole("note", { name: "Privacy" })).toBeNull();
    expect(window.localStorage.length).toBe(0);
  });
});
