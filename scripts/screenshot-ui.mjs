// Launches the release exe, loads sample.png, screenshots the full
// webview, and writes docs/samples/ui.jpg.

import { spawn, spawnSync } from "node:child_process";
import { chromium } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
// Use the already-compressed long-side-800 sample so it fits the canvas
// area in the screenshot without scrolling.
const sampleImg = path.join(root, "docs", "samples", "img-original.jpg");
const outDir = path.join(root, "docs", "samples");
const finalPath = path.join(outDir, "ui.jpg");
fs.mkdirSync(outDir, { recursive: true });

const APP_BIN = path.join(
  root, "src-tauri", "target", "release",
  process.platform === "win32" ? "c-codeimage_tools_tauri.exe" : "c-codeimage_tools_tauri",
);
const CDP_PORT = 9222;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForCdp(url, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { const r = await fetch(`${url}/json/version`); if (r.ok) return; } catch {}
    await sleep(200);
  }
  throw new Error("CDP timeout");
}

const proc = spawn(APP_BIN, [], { stdio: ["ignore", "ignore", "pipe"] });
try {
  await waitForCdp(`http://127.0.0.1:${CDP_PORT}`);
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
  const context = browser.contexts()[0] ?? await browser.newContext();
  const page = context.pages()[0] ?? await context.waitForEvent("page");
  await page.waitForLoadState("domcontentloaded");
  await page.waitForFunction(() => !!window.__mainTest, null, { timeout: 10000 });
  await page.evaluate(() => document.fonts.ready);

  const srcB64 = fs.readFileSync(sampleImg).toString("base64");
  await page.evaluate((b64) => window.__mainTest.loadImage(b64), srcB64);
  await page.evaluate(() => window.__mainTest.setSelectionFull());
  // Filename pill shows "未加载文件" until something sets it. The test hook
  // doesn't, so do it here so the screenshot shows the loaded state.
  await page.evaluate(() => {
    const el = document.getElementById("top-filename");
    if (el) {
      (el.querySelector(".label") || el).textContent = "sample.png";
      el.classList.add("loaded");
    }
  });
  await sleep(400);

  const tmp = path.join(os.tmpdir(), "ui-screenshot.png");
  await page.screenshot({ path: tmp, fullPage: false });

  const r = spawnSync("ffmpeg", [
    "-y", "-i", tmp,
    "-vf", "scale='if(gt(iw,1600),1600,-1)':-1",
    "-q:v", "4",
    finalPath,
  ], { stdio: ["ignore", "ignore", "pipe"] });
  if (r.status !== 0) throw new Error("ffmpeg compress failed: " + r.stderr?.toString().slice(0, 400));
  fs.unlinkSync(tmp);

  await browser.close().catch(() => {});
  console.log("Wrote " + finalPath);
} finally {
  proc.kill();
}
