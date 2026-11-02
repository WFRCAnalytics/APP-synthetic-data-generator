import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./theme/fonts";
import "./theme/tokens.css";
import "./styles/app.css";
import "./styles/features.css";
import { App } from "./App";
import { startOffline } from "./app/offline";

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Keep the app's own files, so it keeps working if the network goes away after the page has loaded.
startOffline();
