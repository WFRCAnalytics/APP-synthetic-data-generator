import { useReducer } from "react";
import { FileUp, ListChecks, Shuffle } from "lucide-react";
import { AppHeader } from "./app/AppHeader";
import { LocalNotice } from "./app/LocalNotice";
import { Stepper } from "./app/Stepper";
import { initialState, reducer } from "./app/state";
import { EmptyState } from "./components/EmptyState";

export function App() {
  const [state, dispatch] = useReducer(reducer, initialState);

  return (
    <>
      <AppHeader />
      <main className="app-shell">
        <h1>Synthetic Data Generator</h1>
        <p className="page-subtitle">
          Turn one private table into a fake one, so AI coding agents never see real data.
        </p>
        <LocalNotice />
        <Stepper state={state} onGoTo={(step) => dispatch({ type: "goTo", step })} />

        {/* Screens arrive with the user stories; these placeholders keep the shell navigable. */}
        {state.step === "ingest" && (
          <EmptyState
            icon={FileUp}
            message="Choose a CSV file to begin."
            hint="The file picker and parse settings arrive with the ingest screen."
          />
        )}
        {state.step === "review" && (
          <EmptyState icon={ListChecks} message="Column review will appear here." />
        )}
        {state.step === "generate" && (
          <EmptyState icon={Shuffle} message="Generation and export will appear here." />
        )}
      </main>
    </>
  );
}
