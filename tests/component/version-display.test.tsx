// The version of the app and of the spec file it writes is on the page and in the help guide
// (specs/004 FR-009), so a tester can match the running copy to a release and a saved spec to a release.

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../../src/App";
import { APP_VERSION, SPEC_VERSION, versionLabel } from "../../src/app/version";
import { SPEC_VERSION as WRITTEN_SPEC_VERSION } from "../../src/lib/spec/types";

afterEach(cleanup);

describe("versionLabel", () => {
  it("names the app and the spec version", () => {
    expect(versionLabel("0.2.0", 3)).toBe("v0.2.0 \u00b7 writes spec v3");
  });

  it("uses the package version and the spec version the app writes", () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+/);
    expect(SPEC_VERSION).toBe(WRITTEN_SPEC_VERSION);
    expect(versionLabel()).toBe(`v${APP_VERSION} \u00b7 writes spec v${WRITTEN_SPEC_VERSION}`);
  });
});

describe("the page", () => {
  it("shows the version in the header", () => {
    render(<App />);
    expect(screen.getByTestId("app-version")).toHaveTextContent(versionLabel());
  });

  it("repeats it in the help guide", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Help & guide" }));
    expect(screen.getByRole("dialog")).toHaveTextContent(versionLabel());
  });
});
