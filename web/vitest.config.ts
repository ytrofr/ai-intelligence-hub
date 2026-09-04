import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  test: {
    // Rooted at web/ on purpose: the server's ~590 node:test cells live in
    // ../tests and must keep running under their own runner, untouched.
    root: __dirname,
    globals: true,
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
