// The steps along the header: Ingest, Review, Generate, each a numbered tab. The current one is
// underlined in the brand yellow. Any reachable step can be clicked, so the user can go back; later
// steps are recomputed by the screens themselves. Start over sits at the end once there is something
// to start over from.

import { Check } from "lucide-react";
import { isReachable, STEPS, type AppState, type StepId } from "./state";
import "./Stepper.css";

export interface StepperProps {
  state: AppState;
  onGoTo: (step: StepId) => void;
  /** Shown after the steps when given. */
  onStartOver?: () => void;
}

const ORDER: StepId[] = ["ingest", "review", "generate"];

export function Stepper({ state, onGoTo, onStartOver }: StepperProps) {
  const at = ORDER.indexOf(state.step);
  return (
    <nav aria-label="Progress" className="stepper no-print">
      <ol className="stepper-list">
        {STEPS.map((step, index) => {
          const current = state.step === step.id;
          const done = index < at;
          const reachable = isReachable(state, step.id);
          // While a table is being designed, step 1 is Design: that is where its columns are changed.
          const designing = state.designing && step.id === "ingest";
          return (
            <li key={step.id} className="stepper-item">
              <button
                type="button"
                className={`stepper-button${current ? " stepper-button--current" : ""}${done ? " stepper-button--done" : ""}`}
                aria-current={current ? "step" : undefined}
                disabled={!reachable}
                onClick={() => onGoTo(step.id)}
              >
                <span className="stepper-number" aria-hidden="true">
                  {done ? <Check size={13} strokeWidth={2.5} /> : index + 1}
                </span>
                <span className="stepper-label">{designing ? "Design" : step.label}</span>
              </button>
            </li>
          );
        })}
      </ol>
      {onStartOver && (
        <button type="button" className="stepper-startover" onClick={onStartOver}>
          Start over
        </button>
      )}
    </nav>
  );
}
