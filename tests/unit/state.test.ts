import { describe, expect, it } from "vitest";
import { initialState, isReachable, reducer, type AppState } from "../../src/app/state";

const cols = [
  { name: "mode", type: "categorical" },
  { name: "dist", type: "float" },
];

describe("app state", () => {
  it("starts on Ingest with nothing profiled", () => {
    expect(initialState.step).toBe("ingest");
    expect(initialState.columnsReady).toBe(false);
  });

  it("blocks Review and Generate until columns are ready", () => {
    expect(isReachable(initialState, "review")).toBe(false);
    expect(reducer(initialState, { type: "goTo", step: "generate" })).toBe(initialState);
    expect(isReachable(initialState, "ingest")).toBe(true);
  });

  it("moves to Review when columns are profiled", () => {
    const next = reducer(initialState, { type: "columnsProfiled", columns: cols });
    expect(next.step).toBe("review");
    expect(next.source).toBe("file");
    expect(isReachable(next, "generate")).toBe(true);
  });

  it("lets the user go back to an earlier step", () => {
    const review = reducer(initialState, { type: "columnsProfiled", columns: cols });
    expect(reducer(review, { type: "goTo", step: "ingest" }).step).toBe("ingest");
  });

  it("keeps overrides for columns whose name and type are unchanged when profiling again", () => {
    let s: AppState = reducer(initialState, { type: "columnsProfiled", columns: cols });
    s = reducer(s, { type: "setOverride", name: "mode", baseType: "categorical", settings: { k: 5 } });
    s = reducer(s, { type: "setOverride", name: "dist", baseType: "float", settings: { decimals: 1 } });
    s = reducer(s, { type: "goTo", step: "ingest" });

    // Re-profile: "mode" is unchanged, "dist" is now an integer, "extra" is new.
    s = reducer(s, {
      type: "columnsProfiled",
      columns: [
        { name: "mode", type: "categorical" },
        { name: "dist", type: "integer" },
        { name: "extra", type: "integer" },
      ],
    });

    expect(s.overrides.mode?.settings).toEqual({ k: 5 });
    expect(s.overrides.dist).toBeUndefined();
    expect(s.overrides.extra).toBeUndefined();
  });

  it("drops overrides for columns that disappeared", () => {
    let s = reducer(initialState, { type: "columnsProfiled", columns: cols });
    s = reducer(s, { type: "setOverride", name: "mode", baseType: "categorical", settings: {} });
    s = reducer(s, { type: "columnsProfiled", columns: [{ name: "dist", type: "float" }] });
    expect(s.overrides).toEqual({});
  });

  it("a loaded spec replaces any open file and clears file overrides", () => {
    let s = reducer(initialState, { type: "columnsProfiled", columns: cols });
    s = reducer(s, { type: "setOverride", name: "mode", baseType: "categorical", settings: { k: 2 } });
    s = reducer(s, { type: "specLoaded", columns: cols });
    expect(s.source).toBe("spec");
    expect(s.step).toBe("review");
    expect(s.overrides).toEqual({});
  });

  it("reset returns the initial state", () => {
    const s = reducer(initialState, { type: "columnsProfiled", columns: cols });
    expect(reducer(s, { type: "reset" })).toEqual(initialState);
  });
});
