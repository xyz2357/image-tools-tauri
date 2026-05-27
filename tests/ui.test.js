/**
 * UI / DOM tests — mirrors tests/test_widgets_automated.py and
 * tests/ui/test_button_stability.py from the PyQt5 version.
 *
 * Uses jsdom to simulate the browser environment.
 * Canvas operations are stubbed since jsdom lacks a real Canvas impl.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { JSDOM } from "jsdom";
import { readFileSync } from "fs";
import { resolve } from "path";

const htmlPath = resolve(__dirname, "../src/index.html");
const htmlSource = readFileSync(htmlPath, "utf-8");

let dom;
let document;
let window;

function setup() {
  dom = new JSDOM(htmlSource, {
    url: "http://localhost",
    pretendToBeVisual: true,
    resources: "usable",
  });
  document = dom.window.document;
  window = dom.window;
}

function teardown() {
  dom.window.close();
}

// ── Window initialization (mirrors test_window_initialization) ──────────────

describe("window initialization", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("has correct title", () => {
    expect(document.title).toBe("图片工具");
  });

  it("loads without errors", () => {
    expect(document.querySelector(".app")).not.toBeNull();
  });
});

// ── Tab structure (mirrors test_all_tabs_exist) ─────────────────────────────

describe("primary tabs", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("has Image Tools and Conversion tabs", () => {
    const tabs = document.querySelectorAll(".primary-tabs .tab-btn");
    expect(tabs.length).toBe(2);
    expect(tabs[0].textContent).toContain("图片工具");
    expect(tabs[1].textContent).toContain("格式转换");
  });

  it("Image Tools tab is active by default", () => {
    const activeTab = document.querySelector(".primary-tabs .tab-btn.active");
    expect(activeTab.dataset.tab).toBe("image-tools");
  });

  it("Image Tools content is visible by default", () => {
    expect(document.getElementById("tab-image-tools").classList.contains("active")).toBe(true);
    expect(document.getElementById("tab-conversion").classList.contains("active")).toBe(false);
  });
});

// ── Tool pills (image-tools right panel) ────────────────────────────────────

describe("image-tools tool pills", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("has 5 tool pills with shared-first ordering", () => {
    // Order: shared positions (1-3) match the conversion tab's pills;
    // the image-only effects (text, blur) trail in positions 4-5.
    const pills = document.querySelectorAll("#img-pill-bar .pill-btn");
    expect(pills.length).toBe(5);
    const tools = Array.from(pills).map((p) => p.dataset.tool);
    expect(tools).toEqual(["mosaic", "camera", "save", "text", "blur"]);
  });

  it("mosaic pill is active by default", () => {
    const active = document.querySelector("#img-pill-bar .pill-btn.active");
    expect(active.dataset.tool).toBe("mosaic");
  });

  it("mosaic tool content is visible by default", () => {
    expect(document.getElementById("tool-mosaic").classList.contains("active")).toBe(true);
    expect(document.getElementById("tool-text").classList.contains("active")).toBe(false);
    expect(document.getElementById("tool-blur").classList.contains("active")).toBe(false);
    expect(document.getElementById("tool-camera").classList.contains("active")).toBe(false);
    expect(document.getElementById("tool-save").classList.contains("active")).toBe(false);
  });
});

// ── Tab switching (mirrors test_tab_switching) ──────────────────────────────
// main.js isn't loaded in jsdom, so we wire up the tab logic manually.

function initTabs(doc, barSelector, contentPrefix) {
  const bar = doc.querySelector(barSelector);
  if (!bar) return;
  bar.addEventListener("click", (e) => {
    const btn = e.target.closest(".tab-btn, .pill-btn");
    if (!btn) return;
    bar.querySelectorAll(".tab-btn, .pill-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const key = btn.dataset.tab || btn.dataset.tool;
    const parent = bar.parentElement;
    parent.querySelectorAll(`:scope > [id^="${contentPrefix}"]`).forEach((el) => {
      el.classList.toggle("active", el.id === `${contentPrefix}${key}`);
    });
  });
}

describe("tab switching", () => {
  beforeEach(() => {
    setup();
    initTabs(document, ".primary-tabs", "tab-");
    initTabs(document, "#img-pill-bar", "tool-");
  });
  afterEach(teardown);

  it("switching primary tab updates active content", () => {
    const conversionBtn = document.querySelector('.primary-tabs .tab-btn[data-tab="conversion"]');
    conversionBtn.click();

    expect(conversionBtn.classList.contains("active")).toBe(true);
    expect(document.getElementById("tab-conversion").classList.contains("active")).toBe(true);
    expect(document.getElementById("tab-image-tools").classList.contains("active")).toBe(false);
  });

  it("switching tool pill updates active content", () => {
    const textBtn = document.querySelector('#img-pill-bar .pill-btn[data-tool="text"]');
    textBtn.click();

    expect(textBtn.classList.contains("active")).toBe(true);
    expect(document.getElementById("tool-text").classList.contains("active")).toBe(true);
    expect(document.getElementById("tool-mosaic").classList.contains("active")).toBe(false);
  });
});

// ── Image buttons exist (mirrors test_image_buttons_clickable) ──────────────

describe("image control buttons", () => {
  beforeEach(setup);
  afterEach(teardown);

  const buttonIds = [
    "btn-open",
    "btn-save",
    "btn-undo",
    "btn-redo",
    "btn-reset",
    "btn-sel-rect",
    "btn-sel-lasso",
  ];

  for (const id of buttonIds) {
    it(`button #${id} exists`, () => {
      expect(document.getElementById(id)).not.toBeNull();
    });

    it(`button #${id} is clickable without error`, () => {
      expect(() => document.getElementById(id).click()).not.toThrow();
    });
  }
});

// ── Apply buttons exist (mirrors test_image_buttons_clickable continued) ────

describe("apply buttons", () => {
  beforeEach(setup);
  afterEach(teardown);

  const applyIds = [
    "btn-apply-mosaic",
    "btn-apply-text",
    "btn-apply-blur",
    "btn-apply-camera",
  ];

  for (const id of applyIds) {
    it(`button #${id} exists`, () => {
      expect(document.getElementById(id)).not.toBeNull();
    });

    it(`button #${id} is clickable without error`, () => {
      expect(() => document.getElementById(id).click()).not.toThrow();
    });
  }
});

// ── Sliders (mirrors test_sliders_adjustable) ───────────────────────────────

describe("sliders", () => {
  beforeEach(setup);
  afterEach(teardown);

  const sliders = [
    { id: "mosaic-size", min: 5, max: 50, defaultVal: 20 },
    { id: "text-size", min: 8, max: 200, defaultVal: 20 },
    { id: "text-angle", min: -90, max: 90, defaultVal: 0 },
    { id: "blur-intensity", min: 5, max: 50, defaultVal: 20 },
    { id: "blur-angle", min: 0, max: 180, defaultVal: 90 },
    { id: "camera-battery", min: 0, max: 100, defaultVal: 100 },
  ];

  for (const s of sliders) {
    it(`slider #${s.id} has correct range`, () => {
      const el = document.getElementById(s.id);
      expect(parseInt(el.min)).toBe(s.min);
      expect(parseInt(el.max)).toBe(s.max);
    });

    it(`slider #${s.id} has correct default value`, () => {
      const el = document.getElementById(s.id);
      expect(parseInt(el.value)).toBe(s.defaultVal);
    });

    it(`slider #${s.id} value can be changed`, () => {
      const el = document.getElementById(s.id);
      el.value = s.min;
      expect(parseInt(el.value)).toBe(s.min);
      el.value = s.max;
      expect(parseInt(el.value)).toBe(s.max);
      const mid = Math.floor((s.min + s.max) / 2);
      el.value = mid;
      expect(parseInt(el.value)).toBe(mid);
    });
  }
});

// ── Text controls (mirrors text widget specifics) ───────────────────────────

describe("text controls", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("text input exists with placeholder", () => {
    const input = document.getElementById("text-input");
    expect(input).not.toBeNull();
    expect(input.placeholder).toBe("在此输入文字...");
  });

  it("font selector has options", () => {
    const select = document.getElementById("text-font");
    expect(select.options.length).toBeGreaterThan(0);
    const fonts = Array.from(select.options).map((o) => o.value);
    expect(fonts).toContain("Arial");
    expect(fonts).toContain("Times New Roman");
  });

  it("color picker exists", () => {
    const colorInput = document.getElementById("text-color");
    expect(colorInput).not.toBeNull();
    expect(colorInput.type).toBe("color");
    expect(colorInput.value).toBe("#000000");
  });
});

// ── Camera controls ─────────────────────────────────────────────────────────

describe("camera controls", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("battery slider defaults to 100", () => {
    expect(parseInt(document.getElementById("camera-battery").value)).toBe(100);
  });

  it("timer input exists with placeholder", () => {
    const input = document.getElementById("camera-timer");
    expect(input).not.toBeNull();
    expect(input.placeholder).toBe("HH:MM:SS.mmm");
  });
});

// ── Selection mode toggle (mirrors test_shortcuts_work partially) ───────────

describe("selection mode buttons", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("rect button is active by default", () => {
    expect(document.getElementById("btn-sel-rect").classList.contains("active")).toBe(true);
    expect(document.getElementById("btn-sel-lasso").classList.contains("active")).toBe(false);
  });
});

// ── Undo / redo buttons (mirrors test_undo_redo_buttons_state) ──────────────

describe("undo/redo buttons", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("undo button exists", () => {
    expect(document.getElementById("btn-undo")).not.toBeNull();
  });

  it("redo button exists", () => {
    expect(document.getElementById("btn-redo")).not.toBeNull();
  });

  it("undo button title contains Ctrl+Z", () => {
    expect(document.getElementById("btn-undo").title).toContain("Ctrl+Z");
  });

  it("redo button title contains Ctrl+Shift+Z", () => {
    expect(document.getElementById("btn-redo").title).toContain("Ctrl+Shift+Z");
  });

  it("undo button shows Chinese label", () => {
    expect(document.getElementById("btn-undo").textContent).toContain("撤销");
  });

  it("redo button shows Chinese label", () => {
    expect(document.getElementById("btn-redo").textContent).toContain("重做");
  });
});

// ── Conversion tab (mirrors test_conversion_widget) ─────────────────────────

describe("conversion tab", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("conversion tab content exists", () => {
    expect(document.getElementById("tab-conversion")).not.toBeNull();
  });

  it("conversion tab is hidden by default", () => {
    expect(document.getElementById("tab-conversion").classList.contains("active")).toBe(false);
  });
});

// ── Canvas elements (mirrors image_and_selection_widget structure) ───────────

describe("canvas elements", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("main canvas exists", () => {
    expect(document.getElementById("main-canvas")).not.toBeNull();
  });

  it("overlay canvas exists", () => {
    expect(document.getElementById("overlay-canvas")).not.toBeNull();
  });

  it("canvas scroll container exists", () => {
    expect(document.getElementById("canvas-scroll")).not.toBeNull();
  });
});

// ── File input (mirrors open image functionality) ───────────────────────────

describe("file input", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("hidden file input exists", () => {
    const input = document.getElementById("file-input");
    expect(input).not.toBeNull();
    expect(input.type).toBe("file");
    expect(input.style.display).toBe("none");
  });

  it("accepts image formats", () => {
    const input = document.getElementById("file-input");
    expect(input.accept).toContain("image/png");
    expect(input.accept).toContain("image/jpeg");
  });
});

// ── Preview canvases ────────────────────────────────────────────────────────

describe("preview canvases", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("text preview canvas exists", () => {
    const c = document.getElementById("text-preview");
    expect(c).not.toBeNull();
    expect(c.width).toBe(60);
    expect(c.height).toBe(60);
  });

  it("blur preview canvas exists", () => {
    const c = document.getElementById("blur-preview");
    expect(c).not.toBeNull();
    expect(c.width).toBe(60);
    expect(c.height).toBe(60);
  });
});

// ── Text layer system ──────────────────────────────────────────────────────

describe("text layer UI elements", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("text canvas exists", () => {
    expect(document.getElementById("text-canvas")).not.toBeNull();
  });

  it("text canvas is positioned between main and overlay", () => {
    const wrapper = document.getElementById("canvas-wrapper");
    const children = Array.from(wrapper.children);
    const mainIdx = children.findIndex((c) => c.id === "main-canvas");
    const textIdx = children.findIndex((c) => c.id === "text-canvas");
    const overlayIdx = children.findIndex((c) => c.id === "overlay-canvas");
    expect(textIdx).toBeGreaterThan(mainIdx);
    expect(textIdx).toBeLessThan(overlayIdx);
  });

  it("auto-fit checkbox exists", () => {
    const cb = document.getElementById("text-auto-fit");
    expect(cb).not.toBeNull();
    expect(cb.type).toBe("checkbox");
  });

  it("vertical text checkbox exists", () => {
    const cb = document.getElementById("text-vertical");
    expect(cb).not.toBeNull();
    expect(cb.type).toBe("checkbox");
  });

  it("text layer list container exists", () => {
    expect(document.getElementById("text-layer-list")).not.toBeNull();
  });

  it("text layer section exists", () => {
    expect(document.getElementById("text-layer-section")).not.toBeNull();
  });

  it("add text layer button says 添加文字图层", () => {
    const btn = document.getElementById("btn-apply-text");
    expect(btn.textContent).toBe("添加文字图层");
  });
});
