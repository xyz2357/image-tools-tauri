import { test, expect } from "../fixtures.js";

// Tests share a worker-scoped Tauri app instance and therefore see each
// other's UI state. Each test that mutates state should reset to a known
// starting point (image-tools tab + mosaic pill) at the top.

async function gotoImageTools(page) {
  await page.locator("button[data-tab='image-tools']").click();
  await page.locator("#img-pill-bar .pill-btn[data-tool='mosaic']").click();
}

async function gotoConversion(page) {
  await page.locator("button[data-tab='conversion']").click();
  await page.locator("#conv-pill-bar .pill-btn[data-conv-tool='mosaic']").click();
}

// ── Launch & primary tabs ───────────────────────────────────────────────────

test("launches with the image-tools tab active", async ({ appPage: page }) => {
  await expect(page.locator("button[data-tab='image-tools']")).toHaveClass(/active/);
  await expect(page.locator("button[data-tab='conversion']")).toBeVisible();
});

test("switching to conversion tab activates the conversion content", async ({ appPage: page }) => {
  await gotoConversion(page);
  await expect(page.locator("#tab-conversion")).toHaveClass(/active/);
  await expect(page.locator("#tab-image-tools")).not.toHaveClass(/active/);
});

// ── Shared top toolbar ──────────────────────────────────────────────────────

test("top toolbar buttons are present in both tabs", async ({ appPage: page }) => {
  const ids = ["btn-open", "btn-undo", "btn-redo", "btn-reset", "btn-sel-rect", "btn-sel-lasso"];

  await gotoImageTools(page);
  for (const id of ids) await expect(page.locator(`#${id}`)).toBeVisible();

  await gotoConversion(page);
  for (const id of ids) await expect(page.locator(`#${id}`)).toBeVisible();
});

test("selection mode buttons toggle active class", async ({ appPage: page }) => {
  await gotoImageTools(page);
  await expect(page.locator("#btn-sel-rect")).toHaveClass(/active/);
  await page.locator("#btn-sel-lasso").click();
  await expect(page.locator("#btn-sel-lasso")).toHaveClass(/active/);
  await expect(page.locator("#btn-sel-rect")).not.toHaveClass(/active/);
  await page.locator("#btn-sel-rect").click(); // reset for following tests
});

// ── Right panel pills ───────────────────────────────────────────────────────

test("image-tools pills are mosaic, camera, save, text, blur in that order", async ({ appPage: page }) => {
  await gotoImageTools(page);
  const tools = await page.locator("#img-pill-bar .pill-btn").evaluateAll((els) => els.map((e) => e.dataset.tool));
  expect(tools).toEqual(["mosaic", "camera", "save", "text", "blur"]);
});

test("conversion pills are mosaic, camera, output sharing positions with image-tools", async ({ appPage: page }) => {
  await gotoConversion(page);
  const tools = await page.locator("#conv-pill-bar .pill-btn").evaluateAll((els) => els.map((e) => e.dataset.convTool));
  expect(tools).toEqual(["mosaic", "camera", "output"]);
});

test("clicking the text pill in image-tools reveals the text pane", async ({ appPage: page }) => {
  await gotoImageTools(page);
  await page.locator("#img-pill-bar .pill-btn[data-tool='text']").click();
  await expect(page.locator("#tool-text")).toHaveClass(/active/);
  await expect(page.locator("#tool-mosaic")).not.toHaveClass(/active/);
});

test("clicking the save pill in image-tools reveals format dropdown + save button", async ({ appPage: page }) => {
  await gotoImageTools(page);
  await page.locator("#img-pill-bar .pill-btn[data-tool='save']").click();
  await expect(page.locator("#tool-save")).toHaveClass(/active/);
  await expect(page.locator("#save-format")).toBeVisible();
  await expect(page.locator("#btn-save")).toBeVisible();
});

// ── Conversion: format-specific options ─────────────────────────────────────

test("selecting ugoira format reveals ugoira-specific options", async ({ appPage: page }) => {
  await gotoConversion(page);
  await page.locator("#conv-pill-bar .pill-btn[data-conv-tool='output']").click();
  await page.locator("#conv-format").selectOption("ugoira");
  await expect(page.locator("#conv-ugoira-options")).toBeVisible();
  await expect(page.locator("#conv-gif-options")).not.toBeVisible();
});

test("ugoira custom delay reveals the number input", async ({ appPage: page }) => {
  await gotoConversion(page);
  await page.locator("#conv-pill-bar .pill-btn[data-conv-tool='output']").click();
  await page.locator("#conv-format").selectOption("ugoira");
  await page.locator("#conv-ugoira-delay").selectOption("custom");
  await expect(page.locator("#conv-ugoira-delay-custom")).toBeVisible();
});

// ── Conversion: empty-state UX ──────────────────────────────────────────────

test("conversion tab shows empty hint when no file is loaded", async ({ appPage: page }) => {
  await gotoConversion(page);
  await expect(page.locator("#conv-preview-scroll")).toHaveClass(/empty/);
  await expect(page.locator("#conv-btn-export")).toBeDisabled();
  await expect(page.locator("#conv-btn-estimate")).toBeDisabled();
});

// ── Image-tools: empty-state click to open ─────────────────────────────────

test("image-tools empty canvas shows the click/drop hint and has pointer cursor", async ({ appPage: page }) => {
  await gotoImageTools(page);
  await expect(page.locator("#canvas-scroll")).toHaveClass(/empty/);
  const cursor = await page.locator("#canvas-scroll").evaluate((el) => getComputedStyle(el).cursor);
  expect(cursor).toBe("pointer");
});

test("clicking the empty image-tools canvas triggers the file picker", async ({ appPage: page }) => {
  await gotoImageTools(page);
  // The handler calls fileInput.click() — intercept that to verify
  // without actually opening a native OS dialog (which would hang CI).
  await page.evaluate(() => {
    window.__fileInputClicks = 0;
    const fi = document.getElementById("file-input");
    fi.click = () => { window.__fileInputClicks++; };
  });
  await page.locator("#canvas-scroll").click({ position: { x: 100, y: 100 } });
  const clicks = await page.evaluate(() => window.__fileInputClicks);
  expect(clicks).toBe(1);
});

// ── Thumb strip (uses test hook to simulate loaded frames) ─────────────────
// Regression for the clientWidth=0-at-render bug that caused the strip
// to show only a single thumb. With real layout, ~12-15 thumbs should
// fit; we assert "more than one" to keep the bound portable.

test("thumb strip renders multiple thumbs when many frames are loaded", async ({ appPage: page }) => {
  await gotoConversion(page);
  await page.evaluate(async () => {
    window.__convTest.populateFakeFrames(100);
    window.__convTest.renderThumbStrip();
    // Wait two rAFs so the renderThumbStrip's requestAnimationFrame fires
    // and the resulting DOM update is laid out.
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
  const count = await page.locator("#conv-thumb-strip canvas").count();
  expect(count).toBeGreaterThan(1);
  expect(count).toBeLessThanOrEqual(100);
  await page.evaluate(() => window.__convTest.reset());
});

test("thumb strip samples evenly and never shows more thumbs than frames", async ({ appPage: page }) => {
  await gotoConversion(page);
  // Tiny frame count: every frame should get its own thumb (capped by
  // total frames, not by fit count).
  await page.evaluate(async () => {
    window.__convTest.populateFakeFrames(3);
    window.__convTest.renderThumbStrip();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
  const indices = await page.locator("#conv-thumb-strip canvas").evaluateAll((els) =>
    els.map((e) => parseInt(e.dataset.frame))
  );
  expect(indices).toEqual([0, 1, 2]);
  await page.evaluate(() => window.__convTest.reset());
});

test("clicking a thumb seeks to that frame", async ({ appPage: page }) => {
  await gotoConversion(page);
  await page.evaluate(async () => {
    window.__convTest.populateFakeFrames(50);
    window.__convTest.renderThumbStrip();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
  // Click the last thumb.
  const last = page.locator("#conv-thumb-strip canvas").last();
  const targetFrame = parseInt(await last.getAttribute("data-frame"));
  await last.click();
  const current = await page.evaluate(() => window.__convTest.getCurrentFrame());
  expect(current).toBe(targetFrame);
  await expect(last).toHaveClass(/active/);
  await page.evaluate(() => window.__convTest.reset());
});

// ── Layout regressions (real rendering, not jsdom) ─────────────────────────

test("tall portrait video doesn't get its top clipped by flex centering", async ({ appPage: page }) => {
  // Regression for the `align-items: center` overflow bug: a 1080×1920
  // frame is taller than the preview area, so without `safe center`
  // the top half sits in un-scrollable negative margin and you can
  // never see frame.top in the viewport.
  await gotoConversion(page);
  await page.evaluate(async () => {
    window.__convTest.populateFakeFrames(2, 1080, 1920);
    window.__convTest.updatePreview();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
  const layout = await page.evaluate(() => {
    const c = document.querySelector("#conv-canvas");
    const s = document.querySelector("#conv-preview-scroll");
    s.scrollTop = 0;
    return {
      canvasH: c.height,
      scrollH: s.scrollHeight,
      clientH: s.clientHeight,
      canvasTopOffset: c.getBoundingClientRect().top - s.getBoundingClientRect().top,
    };
  });
  expect(layout.canvasH).toBe(1920);
  expect(layout.scrollH).toBeGreaterThan(layout.clientH); // it overflows
  // With safe-center fallback, the canvas top is at or below the scroll
  // viewport top (>= 0). Buggy `center` would put it at a negative offset.
  expect(layout.canvasTopOffset).toBeGreaterThanOrEqual(0);
  await page.evaluate(() => window.__convTest.reset());
});

// ── Window title ────────────────────────────────────────────────────────────

test("window title is 图片工具", async ({ appPage: page }) => {
  await expect(page).toHaveTitle("图片工具");
});
