import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@/styles/globals.css";

const el = document.getElementById("root");
if (!el) throw new Error("no #root - index.html and main.tsx disagree");

createRoot(el).render(
  <StrictMode>
    <div style={{ padding: 24, fontFamily: "Inter, system-ui, sans-serif" }}>
      <h1>Scaffold only</h1>
      <p>
        R1 builds and proves the toolchain. Nothing is served from here yet - Express still
        serves <code>public/</code>. The shell arrives in R3.
      </p>
    </div>
  </StrictMode>,
);
