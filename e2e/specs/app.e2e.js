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

// ── Window title ────────────────────────────────────────────────────────────

test("window title is 图片工具", async ({ appPage: page }) => {
  await expect(page).toHaveTitle("图片工具");
});
