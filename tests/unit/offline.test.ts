// The offline copy (specs/034): when a page keeps one, which build of the engine it asks for, and that the hosted page and a local copy differ.
import { describe, expect, it } from "vitest";
import { engineVariant, offlineWanted } from "../../src/app/offline";

const at = (protocol: string, hostname: string, search = "") => ({ protocol, hostname, search });

describe("offlineWanted", () => {
  it("keeps a copy on the hosted page", () => {
    expect(offlineWanted(at("https:", "wfrcanalytics.github.io"))).toBe(true);
  });
  it("keeps none for a copy running from a folder on this computer", () => {
    expect(offlineWanted(at("http:", "127.0.0.1"))).toBe(false);
    expect(offlineWanted(at("http:", "localhost"))).toBe(false);
    expect(offlineWanted(at("https:", "localhost"))).toBe(false);
  });
  it("keeps one when a test asks for it", () => {
    expect(offlineWanted(at("http:", "localhost", "?cache"))).toBe(true);
  });
});

describe("engineVariant", () => {
  it("is one of the two builds the site serves", () => {
    expect(["eh", "mvp"]).toContain(engineVariant());
  });
});
