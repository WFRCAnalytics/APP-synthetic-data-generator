// App-level state: which step the user is on, where the session came from, and the user's
// per-column overrides. Real rows never live here (constitution Principle I); only column names,
// types and settings do. Nothing in this module touches browser storage.

export type StepId = "ingest" | "review" | "generate";

export const STEPS: readonly { id: StepId; label: string }[] = [
  { id: "ingest", label: "Ingest" },
  { id: "review", label: "Review" },
  { id: "generate", label: "Generate" },
];

export type SessionSource = "none" | "file" | "spec";

/** A user's overrides for one column, remembered with the type they were made against. */
export interface ColumnOverride {
  baseType: string;
  settings: Record<string, unknown>;
}

export interface AppState {
  step: StepId;
  source: SessionSource;
  /** True once columns are profiled (from a file) or loaded (from a spec). */
  columnsReady: boolean;
  /** The person is designing a table from scratch: step 1 is Design, not Ingest. */
  designing: boolean;
  overrides: Record<string, ColumnOverride>;
}

export const initialState: AppState = {
  step: "ingest",
  source: "none",
  columnsReady: false,
  designing: false,
  overrides: {},
};

export type AppAction =
  | { type: "goTo"; step: StepId }
  | { type: "columnsProfiled"; columns: { name: string; type: string }[] }
  | { type: "specLoaded"; columns: { name: string; type: string }[] }
  | { type: "startDesign" }
  | { type: "designBuilt"; columns: { name: string; type: string }[] }
  | { type: "setOverride"; name: string; baseType: string; settings: Record<string, unknown> }
  | { type: "reset" };

/** Review and Generate need profiled or loaded columns; Ingest is always reachable. */
export function isReachable(state: AppState, step: StepId): boolean {
  return step === "ingest" || state.columnsReady;
}

// Keep an override only if its column still exists with the same type it was made against.
function keepMatchingOverrides(
  previous: Record<string, ColumnOverride>,
  columns: { name: string; type: string }[],
): Record<string, ColumnOverride> {
  const kept: Record<string, ColumnOverride> = {};
  for (const col of columns) {
    const old = previous[col.name];
    if (old && old.baseType === col.type) kept[col.name] = old;
  }
  return kept;
}

export function reducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "goTo":
      return isReachable(state, action.step) ? { ...state, step: action.step } : state;

    case "startDesign":
      return { ...state, step: "ingest", designing: true };

    // A designed table is reviewed like a loaded spec; Design stays reachable as step 1.
    case "designBuilt":
      return { ...state, source: "spec", columnsReady: true, designing: true, step: "review", overrides: {} };

    case "columnsProfiled":
      return {
        ...state,
        designing: false,
        source: "file",
        columnsReady: true,
        step: "review",
        overrides: keepMatchingOverrides(state.overrides, action.columns),
      };

    // A spec replaces any open file and goes straight to Review; the two are never combined.
    case "specLoaded":
      return { ...state, source: "spec", columnsReady: true, designing: false, step: "review", overrides: {} };

    case "setOverride":
      return {
        ...state,
        overrides: {
          ...state.overrides,
          [action.name]: { baseType: action.baseType, settings: action.settings },
        },
      };

    case "reset":
      return initialState;
  }
}
