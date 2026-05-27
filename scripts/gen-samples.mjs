// Drives the real release exe via Playwright/CDP, applies each effect
// to sample.png, dumps the resulting canvas. ffmpeg compresses the
// PNGs into small JPGs for the README.
//
// Run via:   node scripts/gen-samples.mjs
// Requires:  cargo build --release  (done by playwright-config globalSetup)
//            ffmpeg in PATH

import { spawn, spawnSync } from "node:child_process";
import { chromium } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const sampleImg = path.join(root, "sample.png");
const outDir = path.join(root, "docs", "samples");
fs.mkdirSync(outDir, { recursive: true });

const APP_BIN = path.join(
  root, "src-tauri", "target", "release",
  process.platform === "win32" ? "c-codeimage_tools_tauri.exe" : "c-codeimage_tools_tauri",
);
const CDP_PORT = 9222;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function waitForCdp(url, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { const r = await fetch(`${url}/json/version`); if (r.ok) return; } catch {}
    await sleep(200);
  }
  throw new Error("CDP timeout");
}

function buildRelease() {
  console.log("Building release...");
  const r = spawnSync("cargo", ["build", "--release", "--manifest-path", path.join(root, "src-tauri", "Cargo.toml")],
    { stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) throw new Error("cargo build --release failed");
}

async function withApp(fn) {
  const proc = spawn(APP_BIN, [], { stdio: ["ignore", "ignore", "pipe"] });
  try {
    await waitForCdp(`http://127.0.0.1:${CDP_PORT}`);
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
    const context = browser.contexts()[0] ?? await browser.newContext();
    const page = context.pages()[0] ?? await context.waitForEvent("page");
    await page.waitForLoadState("domcontentloaded");
    try { await fn(page); }
    finally { await browser.close().catch(() => {}); }
  } finally { proc.kill(); }
}

async function saveDataUrlPng(dataUrl, outPath) {
  const b64 = dataUrl.split(",")[1];
  fs.writeFileSync(outPath, Buffer.from(b64, "base64"));
}

function compressPng(srcPath, dstPath, longSide = 800) {
  // Re-encode to JPG, scale longest side to longSide.
  const r = spawnSync("ffmpeg", [
    "-y", "-i", srcPath,
    "-vf", `scale='if(gt(iw,ih),${longSide},-1)':'if(gt(iw,ih),-1,${longSide})'`,
    "-q:v", "5",
    dstPath,
  ], { stdio: ["ignore", "ignore", "pipe"] });
  if (r.status !== 0) throw new Error(`ffmpeg failed for ${srcPath}`);
}

async function genSample(page, srcPath, outPrefix, name, setupFn) {
  console.log(`  -> ${outPrefix}-${name}`);
  const srcB64 = fs.readFileSync(srcPath).toString("base64");
  await page.evaluate((b64) => window.__mainTest.loadImage(b64), srcB64);
  await page.evaluate(() => window.__mainTest.setSelectionFull());
  await setupFn(page);
  await sleep(300);
  const dataUrl = await page.evaluate(() => window.__mainTest.getCompositeDataURL());
  const tmpPath = path.join(os.tmpdir(), `gen-${outPrefix}-${name}.png`);
  await saveDataUrlPng(dataUrl, tmpPath);
  const finalPath = path.join(outDir, `${outPrefix}-${name}.jpg`);
  compressPng(tmpPath, finalPath);
  fs.unlinkSync(tmpPath);
}

const EFFECTS = {
  original: async () => {},
  mosaic: async (p) => {
    await p.locator("#img-pill-bar .pill-btn[data-tool='mosaic']").click();
    await p.locator("#mosaic-size").evaluate((el) => { el.value = "40"; el.dispatchEvent(new Event("input")); });
    await p.locator("#btn-apply-mosaic").click();
  },
  text: async (p) => {
    await p.locator("#img-pill-bar .pill-btn[data-tool='text']").click();
    await p.locator("#text-input").fill("Image Tools");
    await p.locator("#text-color").evaluate((el) => { el.value = "#ff4444"; el.dispatchEvent(new Event("input")); });
    await p.locator("#text-size").evaluate((el) => { el.value = "200"; el.dispatchEvent(new Event("input")); });
    await p.locator("#text-auto-fit").evaluate((el) => { if (!el.checked) el.click(); });
    await p.locator("#btn-apply-text").click();
  },
  blur: async (p) => {
    await p.locator("#img-pill-bar .pill-btn[data-tool='blur']").click();
    await p.locator("#blur-intensity").evaluate((el) => { el.value = "40"; el.dispatchEvent(new Event("input")); });
    await p.locator("#btn-apply-blur").click();
  },
  camera: async (p) => {
    await p.locator("#img-pill-bar .pill-btn[data-tool='camera']").click();
    await p.locator("#camera-battery").evaluate((el) => { el.value = "78"; el.dispatchEvent(new Event("input")); });
    await p.locator("#camera-timer").fill("00:01:23.456");
    await p.locator("#btn-apply-camera").click();
  },
};

async function generate() {
  buildRelease();

  // Extract a representative single frame from sample.mp4 so we can run
  // the same app-driven effect pipeline on it (rather than approximating
  // with ffmpeg filters). This way both `img-*` and `vid-*` samples are
  // genuine app output.
  console.log("extracting video frame");
  const vidFrame = path.join(os.tmpdir(), "gen-video-frame.png");
  spawnSyncOrThrow("ffmpeg", [
    "-y", "-ss", "00:00:02", "-i", path.join(root, "sample.mp4"),
    "-frames:v", "1", vidFrame,
  ]);

  await withApp(async (page) => {
    await page.locator("button[data-tab='image-tools']").click();
    console.log("image samples");
    for (const [name, fn] of Object.entries(EFFECTS)) {
      await genSample(page, sampleImg, "img", name, fn);
    }
    console.log("video-frame samples");
    for (const [name, fn] of Object.entries(EFFECTS)) {
      await genSample(page, vidFrame, "vid", name, fn);
    }
  });

  fs.unlinkSync(vidFrame);
  console.log("Wrote " + outDir);
}

function spawnSyncOrThrow(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
  if (r.status !== 0) throw new Error(`${cmd} failed: ${r.stderr?.toString().slice(0, 500)}`);
}

generate().catch((e) => { console.error(e); process.exit(1); });
