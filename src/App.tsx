import { useEffect, useMemo, useReducer, useState } from "react";
import { AppHeader } from "./app/AppHeader";
import { downloadBlob } from "./app/download";
import { LocalNotice } from "./app/LocalNotice";
import { Session } from "./app/session";
import { Stepper } from "./app/Stepper";
import { initialState, reducer } from "./app/state";
import { GenerateScreen } from "./features/generate/GenerateScreen";
import { IngestScreen } from "./features/ingest/IngestScreen";
import { ReviewScreen } from "./features/review/ReviewScreen";

export function App() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const session = useMemo(() => new Session(), []);
  const [data, setData] = useState(session.state);

  useEffect(() => {
    const unsubscribe = session.subscribe(setData);
    session.onProfiled = (columns) => dispatch({ type: "columnsProfiled", columns });
    // Leaving the page drops the workers, and with them every byte of real data.
    return () => {
      unsubscribe();
      session.reset();
    };
  }, [session]);

  const startOver = () => {
    session.reset();
    dispatch({ type: "reset" });
  };

  return (
    <>
      <AppHeader />
      <main className="app-shell">
        <h1>Synthetic Data Generator</h1>
        <p className="page-subtitle">Turn one private table into a fake one, so AI coding agents never see real data.</p>
        <LocalNotice />
        <Stepper state={state} onGoTo={(step) => dispatch({ type: "goTo", step })} />

        {state.step === "ingest" && (
          <IngestScreen
            session={data}
            onChooseFile={(file) => session.openFile(file)}
            onEditSettings={(patch) => session.editSettings(patch)}
            onConfirm={() => session.confirmAndProfile()}
            onCancel={() => session.cancel()}
          />
        )}

        {state.step === "review" && (
          <ReviewScreen profiles={data.profiles} rowCount={data.rowCount} fileName={data.fileName} onContinue={() => dispatch({ type: "goTo", step: "generate" })} />
        )}

        {state.step === "generate" && (
          <GenerateScreen
            session={data}
            fakeFileName={session.fakeFileName()}
            onSeedChange={(text) => session.setSeedText(text)}
            onKeepNameChange={(keep) => session.setKeepOriginalName(keep)}
            onGenerate={() => session.generate()}
            onCancel={() => session.cancel()}
            onDownloadFake={() => {
              const blob = session.fakeBlob();
              if (blob) downloadBlob(blob, session.fakeFileName());
            }}
            onDownloadSpec={() => {
              const blob = session.specBlob();
              if (blob) downloadBlob(blob, session.specFileName());
            }}
          />
        )}

        {state.columnsReady && (
          <div className="actions-row">
            <button type="button" className="button button-secondary" onClick={startOver}>
              Start over
            </button>
          </div>
        )}
      </main>
    </>
  );
}
