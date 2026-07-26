import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app/App.js";
import "./styles/tokens.css";
import "./styles/global.css";

const rootElement = document.getElementById("root");
if (rootElement === null) {
  throw new Error("Application root is missing");
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>
);
