import { useEffect, useMemo, useReducer, useState } from "react";
import { AppHeader } from "./app/AppHeader";
import { HelpGuideModal } from "./app/HelpGuideModal";
import { NetworkCounter } from "./app/NetworkCounter";
import { netCounter } from "./app/netMonitor";
import { downloadBlob } from "./app/download";
import { LocalNotice } from "./app/LocalNotice";
import { Session } from "./app/session";
import { Stepper } from "./app/Stepper";
import { initialState, reducer } from "./app/state";
import { emptyDesign } from "./lib/design/defaults";
import { DesignScreen } from "./features/design/DesignScreen";
import { GenerateScreen } from "./features/generate/GenerateScreen";
import { IngestScreen } from "./features/ingest/IngestScreen";
import { ReviewScreen } from "./features/review/ReviewScreen";

export function App() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const session = useMemo(() => new Session(), []);
  const [data, setData] = useState(session.state);
  const [helpOpen, setHelpOpen] = useState(false);
  const [design, setDesign] = useState(emptyDesign);

  useEffect(() => {
    const unsubscribe = session.subscribe(setData);
    session.onProfiled = (columns) => dispatch({ type: "columnsProfiled", columns });
    session.onSpecLoaded = (columns, designed) => dispatch({ type: designed ? "designBuilt" : "specLoaded", columns });
    // Leaving the page drops the workers, and with them every byte of real data.
    return () => {
      unsubscribe();
      session.reset();
    };
  }, [session]);

  const startOver = () => {
    session.reset();
    setDesign(emptyDesign());
    dispatch({ type: "reset" });
  };

  return (
    <div className="shell">
      <AppHeader
        onOpenHelp={() => setHelpOpen(true)}
        steps={<Stepper state={state} onGoTo={(step) => dispatch({ type: "goTo", step })} onStartOver={state.columnsReady ? startOver : undefined} />}
      >
        <NetworkCounter counter={netCounter} />
      </AppHeader>
      <div className="shell-body">
      <main className="shell-main">

        {state.step === "ingest" && state.designing && <DesignScreen design={design} onChange={setDesign} onBuild={(spec) => session.loadSpec(spec, true)} />}

        {state.step === "ingest" && !state.designing && (
          <IngestScreen
            onStartDesign={() => dispatch({ type: "startDesign" })}
            session={data}
            onChooseFile={(file) => session.openFile(file)}
            onChooseSpec={(file) => void session.loadSpecFile(file)}
            onInspectSheet={(sheet) => session.inspectSheet(sheet)}
            onConfirmWorkbook={(choice) => session.confirmWorkbook(choice)}
            onConfirmParquet={() => session.confirmParquet()}
            onConfirmJson={() => session.confirmJson()}
            onEditSettings={(patch) => session.editSettings(patch)}
            onConfirm={() => session.confirmAndProfile()}
            onCancel={() => session.cancel()}
          />
        )}

        {state.step === "review" && (
          <ReviewScreen
            session={data}
            actions={{
              editColumn: (name, patch) => session.editColumn(name, patch),
              overrideColumn: (name, patch) => session.overrideColumn(name, patch),
              checkDatePattern: (name, pattern) => session.checkDatePattern(name, pattern),
              requestSamples: (name, description) => session.requestSamples(name, description),
              setThreshold: (n) => session.setThreshold(n),
              onContinue: () => dispatch({ type: "goTo", step: "generate" }),
              onSaveSpec: () => {
                const blob = session.specBlob();
                if (blob) downloadBlob(blob, session.specFileName());
              },
            }}
          />
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

      </main>
      </div>
      <LocalNotice />
      <HelpGuideModal open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}
