import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@/App";
import "@/styles/globals.css";

const el = document.getElementById("root");
if (!el) throw new Error("no #root - index.html and main.tsx disagree");

createRoot(el).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
