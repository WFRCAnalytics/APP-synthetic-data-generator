// The rail down the left edge: the three steps (Ingest, Review, Generate) as icon buttons, and Start
// over at the bottom once there is something to start over from. Any reachable step can be clicked, so
// the user can go back; later steps are recomputed by the screens themselves.

import { FileUp, ListChecks, PencilRuler, Play, RotateCcw, type LucideIcon } from "lucide-react";
import { isReachable, STEPS, type AppState, type StepId } from "./state";
import "./Stepper.css";

export interface StepperProps {
  state: AppState;
  onGoTo: (step: StepId) => void;
  /** Shown as a button under the steps when given. */
  onStartOver?: () => void;
}

const ICONS: Record<StepId, LucideIcon> = { ingest: FileUp, review: ListChecks, generate: Play };

export function Stepper({ state, onGoTo, onStartOver }: StepperProps) {
  return (
    <nav aria-label="Progress" className="stepper no-print">
      <ol className="stepper-list">
        {STEPS.map((step, index) => {
          const current = state.step === step.id;
          const reachable = isReachable(state, step.id);
          // While a table is being designed, step 1 is Design: that is where its columns are changed.
          const designing = state.designing && step.id === "ingest";
          const Icon = designing ? PencilRuler : ICONS[step.id];
          return (
            <li key={step.id} className="stepper-item">
              <button
                type="button"
                className={`stepper-button${current ? " stepper-button--current" : ""}`}
                aria-current={current ? "step" : undefined}
                disabled={!reachable}
                onClick={() => onGoTo(step.id)}
              >
                <span className="stepper-icon" aria-hidden="true">
                  <Icon size={20} strokeWidth={1.75} />
                </span>
                <span className="stepper-label">
                  <span className="stepper-number" aria-hidden="true">
                    {index + 1}
                  </span>{" "}
                  {designing ? "Design" : step.label}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      {onStartOver && (
        <button type="button" className="stepper-button stepper-startover" onClick={onStartOver}>
          <span className="stepper-icon" aria-hidden="true">
            <RotateCcw size={18} strokeWidth={1.75} />
          </span>
          <span className="stepper-label">Start over</span>
        </button>
      )}
    </nav>
  );
}
