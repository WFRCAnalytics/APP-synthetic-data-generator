import { useEffect, useMemo, useReducer, useState } from "react";
import { AppHeader } from "./app/AppHeader";
import { HelpGuideModal } from "./app/HelpGuideModal";
import { NetworkCounter, OfflineChip } from "./app/NetworkCounter";
import { netCounter } from "./app/netMonitor";
import { downloadBlob } from "./app/download";
import {
  canSaveToFolder,
  saveToFolder,
  zipFileNameFor,
  zipOf,
  type NamedBlob,
} from "./app/saveAll";
import { LocalNotice } from "./app/LocalNotice";
import { Session } from "./app/session";
import { Stepper } from "./app/Stepper";
import { initialState, reducer } from "./app/state";
import { emptyDesign } from "./lib/design/defaults";
import { DesignScreen } from "./features/design/DesignScreen";
import { GenerateScreen } from "./features/generate/GenerateScreen";
import { IngestScreen } from "./features/ingest/IngestScreen";
import { ReviewScreen } from "./features/review/ReviewScreen";

/** The fake file, the spec and the README, or null when the run is not finished. */
async function allFilesOf(session: Session): Promise<NamedBlob[] | null> {
  const fake = await session.fakeFile();
  const spec = session.specBlob();
  const readme = session.readmeBlob();
  if (!fake || !spec || !readme) return null;
  return [
    { name: session.fakeFileName(), blob: fake.blob },
    { name: session.specFileName(), blob: spec },
    { name: session.readmeFileName(), blob: readme },
  ];
}

export function App() {
  const [state, dispatch] = useReducer(reducer, initialState);
  // The session reports to the reducer from the moment it exists, not from the first effect: a file or a spec
  // chosen before the first effect has run (a fast page, a slow browser) must not be lost.
  const session = useMemo(() => {
    const s = new Session();
    s.onProfiled = (columns) => dispatch({ type: "columnsProfiled", columns });
    s.onSpecLoaded = (columns, designed) =>
      dispatch({ type: designed ? "designBuilt" : "specLoaded", columns });
    return s;
  }, []);
  const [data, setData] = useState(session.state);
  const [helpOpen, setHelpOpen] = useState(false);
  const [savedTo, setSavedTo] = useState<string | null>(null);
  const [design, setDesign] = useState(emptyDesign);

  useEffect(() => {
    const unsubscribe = session.subscribe(setData);
    setData(session.state); // anything that happened between the first render and this effect
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
        steps={
          <Stepper
            state={state}
            onGoTo={(step) => dispatch({ type: "goTo", step })}
            onStartOver={state.columnsReady ? startOver : undefined}
          />
        }
      >
        <OfflineChip />
        <NetworkCounter counter={netCounter} held={{ fileName: data.fileName, bytes: data.fileSize, rows: data.rowCount }} />
      </AppHeader>
      <LocalNotice />
      <div className="shell-body">
        <main className="shell-main">
          {state.step === "ingest" && state.designing && (
            <DesignScreen
              design={design}
              onChange={setDesign}
              onBuild={(spec) => session.loadSpec(spec, true)}
            />
          )}

          {state.step === "ingest" && !state.designing && (
            <IngestScreen
              onStartDesign={() => dispatch({ type: "startDesign" })}
              session={data}
              onChooseFile={(file) => session.openFile(file)}
              onChooseSpec={(file) => void session.loadSpecFile(file)}
              onInspectSheet={(sheet) => session.inspectSheet(sheet)}
              onConfirmWorkbook={(choice) => session.confirmWorkbook(choice)}
              onConfirmParquet={() => session.confirmParquet()}
              onConfirmStat={() => session.confirmStat()}
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
                applyCodebook: (labels) => session.applyCodebook(labels),
                addRule: (rule) => session.addRule(rule),
                removeRule: (index) => session.removeRule(index),
                setSeedText: (text) => session.setSeedText(text),
                setPreset: (preset) => session.setPreset(preset),
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
              outputChoices={session.outputChoices()}
              onOutputKindChange={(kind) => session.setOutputKind(kind as Parameters<Session["setOutputKind"]>[0])}
              onDownloadFake={() => {
                void session.fakeFile().then((file) => {
                  if (file) downloadBlob(file.blob, session.fakeFileName());
                });
              }}
              onDownloadReadme={() => {
                const blob = session.readmeBlob();
                if (blob) downloadBlob(blob, session.readmeFileName());
              }}
              onDownloadSpec={() => {
                const blob = session.specBlob();
                if (blob) downloadBlob(blob, session.specFileName());
              }}
              onDownloadAll={() => {
                void allFilesOf(session).then((files) => {
                  if (files)
                    void zipOf(files).then((zip) =>
                      downloadBlob(zip, zipFileNameFor(session.fakeFileName())),
                    );
                });
              }}
              onSaveToFolder={
                canSaveToFolder()
                  ? () => {
                      // The folder picker needs the click that asked for it, so the files are made first.
                      void allFilesOf(session).then((files) => {
                        if (files) saveToFolder(files).then(setSavedTo, () => {});
                      });
                    }
                  : undefined
              }
              savedTo={savedTo}
            />
          )}
        </main>
      </div>
      <HelpGuideModal open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}
