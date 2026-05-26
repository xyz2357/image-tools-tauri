import { defineConfig } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  testDir: "./specs",
  testMatch: "**/*.e2e.js",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  timeout: 60_000,
  use: {
    actionTimeout: 10_000,
  },
  // Build the release binary once before any test runs.
  globalSetup: path.resolve(__dirname, "global-setup.js"),
});
