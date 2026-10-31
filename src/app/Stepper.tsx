// Three-step progress bar (Ingest, Review, Generate). Any reachable step can be clicked, so the
// user can go back; later steps are recomputed by the screens themselves.

import { isReachable, STEPS, type AppState, type StepId } from "./state";
import "./Stepper.css";

export interface StepperProps {
  state: AppState;
  onGoTo: (step: StepId) => void;
}

export function Stepper({ state, onGoTo }: StepperProps) {
  return (
    <nav aria-label="Progress" className="stepper">
      <ol className="stepper-list">
        {STEPS.map((step, index) => {
          const current = state.step === step.id;
          const reachable = isReachable(state, step.id);
          return (
            <li key={step.id} className="stepper-item">
              <button
                type="button"
                className={`stepper-button${current ? " stepper-button--current" : ""}`}
                aria-current={current ? "step" : undefined}
                disabled={!reachable}
                onClick={() => onGoTo(step.id)}
              >
                <span className="stepper-number" aria-hidden="true">
                  {index + 1}
                </span>
                <span className="stepper-label">{step.label}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
