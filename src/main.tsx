import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./theme/fonts";
import "./theme/tokens.css";
import "./styles/app.css";
import "./styles/features.css";
import { App } from "./App";

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
