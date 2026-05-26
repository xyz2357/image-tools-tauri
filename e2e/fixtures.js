import { test as base, chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const CDP_PORT = 9222;
const APP_BIN = path.join(
  projectRoot,
  "src-tauri", "target", "release",
  process.platform === "win32" ? "c-codeimage_tools_tauri.exe" : "c-codeimage_tools_tauri",
);

async function waitForCdp(url, timeoutMs = 20_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url}/json/version`);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Timed out waiting for CDP at ${url}`);
}

// One app instance per worker (we run with workers=1), shared across tests
// in that worker. Per-test relaunch hit a CDP "socket hang up" race when
// port 9222 hadn't released yet between tests.
export const test = base.extend({
  appPage: [
    async ({}, use) => {
      const proc = spawn(APP_BIN, [], { stdio: ["ignore", "ignore", "pipe"] });
      try {
        await waitForCdp(`http://127.0.0.1:${CDP_PORT}`);
        const browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
        const contexts = browser.contexts();
        const context = contexts[0] ?? (await browser.newContext());
        const pages = context.pages();
        let page = pages[0];
        if (!page) page = await context.waitForEvent("page", { timeout: 10_000 });
        await page.waitForLoadState("domcontentloaded");
        try {
          await use(page);
        } finally {
          await browser.close().catch(() => {});
        }
      } finally {
        proc.kill();
      }
    },
    { scope: "worker" },
  ],
});

export { expect } from "@playwright/test";
