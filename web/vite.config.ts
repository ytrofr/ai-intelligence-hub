import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

/**
 * There is no dev server here, on purpose.
 *
 * Only ports 5173-5175 are authorised as OAuth origins on this machine and all
 * three belong to other projects, so a Vite dev server would either take a port
 * it must not or bind one nobody can log in to. Instead the build writes into
 * `dist/`, which Express already serves on 4444 - one origin, no proxy, no CORS.
 * `npm run watch` gives a rebuild-on-save loop against that same origin, and
 * `vitest --watch` is the sub-second loop for components.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  build: {
    outDir: path.resolve(__dirname, "../dist"),
    emptyOutDir: true,
    sourcemap: true,
  },
});
