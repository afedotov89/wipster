import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./base.css";
import { isTauri } from "@tauri-apps/api/core";

document.addEventListener("contextmenu", e => { if (isTauri()) e.preventDefault(); });

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
