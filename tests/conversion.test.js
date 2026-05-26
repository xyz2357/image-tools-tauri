import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { JSDOM } from "jsdom";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  drawCameraOverlay,
  getBatteryColor,
  GIF_PRESETS,
  addMsToTime,
} from "../src/effects.js";
import { parseSourcePath } from "../src/conversion.js";

// ── parseSourcePath ──────────────────────────────────────────────────────

describe("parseSourcePath", () => {
  it("splits a Windows absolute path into stem + parent dir", () => {
    const r = parseSourcePath("C:\\videos\\foo.mp4");
    expect(r.stem).toBe("foo");
    expect(r.parentDir).toBe("C:\\videos");
  });

  it("splits a POSIX path into stem + parent dir", () => {
    const r = parseSourcePath("/home/user/clip.gif");
    expect(r.stem).toBe("clip");
    expect(r.parentDir).toBe("/home/user");
  });

  it("returns null parentDir for a bare filename", () => {
    const r = parseSourcePath("viyo_00002.mp4");
    expect(r.stem).toBe("viyo_00002");
    expect(r.parentDir).toBeNull();
  });

  it("handles files with multiple dots (keeps everything before last dot)", () => {
    const r = parseSourcePath("/a/b/file.name.with.dots.mp4");
    expect(r.stem).toBe("file.name.with.dots");
  });

  it("handles empty / null input", () => {
    expect(parseSourcePath("").stem).toBe("");
    expect(parseSourcePath(null).stem).toBe("");
  });
});

// ── effects.js: drawCameraOverlay tests ────────────────────────────────────

describe("drawCameraOverlay", () => {
  it("is a function exported from effects.js", () => {
    expect(typeof drawCameraOverlay).toBe("function");
  });
});

// ── GIF_PRESETS tests ──────────────────────────────────────────────────────

describe("GIF_PRESETS", () => {
  it("has 5 named presets", () => {
    expect(Object.keys(GIF_PRESETS).length).toBe(5);
  });

  it("has all expected preset keys", () => {
    const keys = Object.keys(GIF_PRESETS);
    expect(keys).toContain("extreme");
    expect(keys).toContain("balanced");
    expect(keys).toContain("high");
    expect(keys).toContain("smallest");
    expect(keys).toContain("original");
  });

  it("extreme preset has correct values", () => {
    const p = GIF_PRESETS.extreme;
    expect(p.fps).toBe(10);
    expect(p.scale).toBe(50);
    expect(p.colors).toBe(128);
    expect(p.dither).toBe("sierra2_4a");
    expect(p.diffPalette).toBe(true);
  });

  it("balanced preset has correct values", () => {
    const p = GIF_PRESETS.balanced;
    expect(p.fps).toBe(15);
    expect(p.scale).toBe(50);
    expect(p.colors).toBe(256);
    expect(p.diffPalette).toBe(true);
  });

  it("high quality preset has correct values", () => {
    const p = GIF_PRESETS.high;
    expect(p.fps).toBe(15);
    expect(p.scale).toBe(75);
    expect(p.colors).toBe(256);
    expect(p.diffPalette).toBe(false);
  });

  it("smallest preset has correct values", () => {
    const p = GIF_PRESETS.smallest;
    expect(p.fps).toBe(8);
    expect(p.scale).toBe(33);
    expect(p.colors).toBe(64);
    expect(p.dither).toBe("none");
    expect(p.diffPalette).toBe(true);
  });

  it("original preset preserves quality", () => {
    const p = GIF_PRESETS.original;
    expect(p.fps).toBe(0);
    expect(p.scale).toBe(100);
    expect(p.colors).toBe(256);
    expect(p.diffPalette).toBe(false);
  });

  it("every preset has a label", () => {
    for (const [key, p] of Object.entries(GIF_PRESETS)) {
      expect(typeof p.label).toBe("string");
      expect(p.label.length).toBeGreaterThan(0);
    }
  });

  it("every preset has valid dither value", () => {
    const validDithers = ["sierra2_4a", "bayer", "none"];
    for (const [key, p] of Object.entries(GIF_PRESETS)) {
      expect(validDithers).toContain(p.dither);
    }
  });

  it("every preset colors are within valid range", () => {
    for (const [key, p] of Object.entries(GIF_PRESETS)) {
      expect(p.colors).toBeGreaterThanOrEqual(2);
      expect(p.colors).toBeLessThanOrEqual(256);
    }
  });

  it("every preset scale is within valid range", () => {
    for (const [key, p] of Object.entries(GIF_PRESETS)) {
      expect(p.scale).toBeGreaterThanOrEqual(10);
      expect(p.scale).toBeLessThanOrEqual(100);
    }
  });
});

// ── Conversion UI tests ────────────────────────────────────────────────────

const htmlPath = resolve(__dirname, "../src/index.html");
const htmlSource = readFileSync(htmlPath, "utf-8");

let dom, document;

function setup() {
  dom = new JSDOM(htmlSource, {
    url: "http://localhost",
    pretendToBeVisual: true,
    resources: "usable",
  });
  document = dom.window.document;
}

function teardown() {
  dom.window.close();
}

describe("conversion tab structure", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("conversion tab content exists", () => {
    expect(document.getElementById("tab-conversion")).not.toBeNull();
  });

  it("conversion canvas exists", () => {
    expect(document.getElementById("conv-canvas")).not.toBeNull();
  });

  it("open file button exists", () => {
    expect(document.getElementById("conv-btn-open")).not.toBeNull();
  });

  it("export button exists and starts disabled", () => {
    const btn = document.getElementById("conv-btn-export");
    expect(btn).not.toBeNull();
    expect(btn.disabled).toBe(true);
  });

  it("estimate button exists and starts disabled", () => {
    const btn = document.getElementById("conv-btn-estimate");
    expect(btn).not.toBeNull();
    expect(btn.disabled).toBe(true);
  });

  it("frame slider exists", () => {
    expect(document.getElementById("conv-frame-slider")).not.toBeNull();
  });

  it("prev/next buttons exist", () => {
    expect(document.getElementById("conv-btn-prev")).not.toBeNull();
    expect(document.getElementById("conv-btn-next")).not.toBeNull();
  });
});

describe("conversion format selector", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("format selector has 5 options", () => {
    const sel = document.getElementById("conv-format");
    expect(sel.options.length).toBe(5);
  });

  it("format selector has all expected formats", () => {
    const sel = document.getElementById("conv-format");
    const values = Array.from(sel.options).map((o) => o.value);
    expect(values).toContain("gif");
    expect(values).toContain("mp4");
    expect(values).toContain("webp");
    expect(values).toContain("apng");
    expect(values).toContain("ugoira");
  });

  it("ugoira quality slider exists with default 85", () => {
    const slider = document.getElementById("conv-ugoira-quality");
    expect(slider).not.toBeNull();
    expect(slider.value).toBe("85");
  });

  it("ugoira delay select has the four preset options", () => {
    const sel = document.getElementById("conv-ugoira-delay");
    expect(sel).not.toBeNull();
    const values = Array.from(sel.options).map((o) => o.value);
    expect(values).toEqual(["33", "50", "100", "custom"]);
    expect(sel.value).toBe("50");
  });

  it("ugoira options panel is hidden by default", () => {
    expect(document.getElementById("conv-ugoira-options").style.display).toBe("none");
  });

  it("default format is GIF", () => {
    const sel = document.getElementById("conv-format");
    expect(sel.value).toBe("gif");
  });
});

describe("conversion preset selector", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("preset selector has 6 options (5 named + custom)", () => {
    const sel = document.getElementById("conv-preset");
    expect(sel.options.length).toBe(6);
  });

  it("preset selector includes custom option", () => {
    const sel = document.getElementById("conv-preset");
    const values = Array.from(sel.options).map((o) => o.value);
    expect(values).toContain("custom");
  });

  it("default preset is extreme", () => {
    const sel = document.getElementById("conv-preset");
    expect(sel.value).toBe("extreme");
  });
});

describe("conversion GIF options", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("colors slider exists with correct range", () => {
    const el = document.getElementById("conv-colors");
    expect(el).not.toBeNull();
    expect(parseInt(el.min)).toBe(2);
    expect(parseInt(el.max)).toBe(256);
  });

  it("scale selector has 5 options", () => {
    const sel = document.getElementById("conv-scale");
    expect(sel.options.length).toBe(5);
  });

  it("dither selector has 3 options", () => {
    const sel = document.getElementById("conv-dither");
    expect(sel.options.length).toBe(3);
    const values = Array.from(sel.options).map((o) => o.value);
    expect(values).toContain("sierra2_4a");
    expect(values).toContain("bayer");
    expect(values).toContain("none");
  });

  it("diff palette checkbox exists and is checked by default", () => {
    const el = document.getElementById("conv-diff-palette");
    expect(el).not.toBeNull();
    expect(el.checked).toBe(true);
  });
});

describe("conversion FPS slider", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("FPS slider has correct range", () => {
    const el = document.getElementById("conv-fps");
    expect(parseInt(el.min)).toBe(1);
    expect(parseInt(el.max)).toBe(60);
  });

  it("FPS slider default is 15", () => {
    const el = document.getElementById("conv-fps");
    expect(parseInt(el.value)).toBe(15);
  });
});

describe("conversion frame range", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("start frame input exists", () => {
    expect(document.getElementById("conv-start-frame")).not.toBeNull();
  });

  it("end frame input exists", () => {
    expect(document.getElementById("conv-end-frame")).not.toBeNull();
  });
});

describe("conversion camera effect controls", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("camera enable checkbox exists", () => {
    expect(document.getElementById("conv-camera-enable")).not.toBeNull();
  });

  it("camera enable is unchecked by default", () => {
    expect(document.getElementById("conv-camera-enable").checked).toBe(false);
  });

  it("camera battery slider exists", () => {
    const el = document.getElementById("conv-camera-battery");
    expect(el).not.toBeNull();
    expect(parseInt(el.value)).toBe(100);
  });

  it("camera timer input exists", () => {
    const el = document.getElementById("conv-camera-timer");
    expect(el).not.toBeNull();
    expect(el.value).toBe("00:00:00.000");
  });

  it("camera options are hidden by default", () => {
    const el = document.getElementById("conv-camera-options");
    expect(el.style.display).toBe("none");
  });
});

describe("conversion progress elements", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("progress section exists and is hidden by default", () => {
    const el = document.getElementById("conv-progress-section");
    expect(el).not.toBeNull();
    expect(el.style.display).toBe("none");
  });

  it("progress fill element exists", () => {
    expect(document.getElementById("conv-progress-fill")).not.toBeNull();
  });

  it("status display exists", () => {
    expect(document.getElementById("conv-status")).not.toBeNull();
  });
});

// ── Timer with frame offset (used for camera overlay on frames) ────────────

describe("addMsToTime for frame-based timer", () => {
  it("calculates correct time for frame 0 at 10fps", () => {
    expect(addMsToTime("00:00:00.000", 0 * 100)).toBe("00:00:00.000");
  });

  it("calculates correct time for frame 10 at 10fps", () => {
    expect(addMsToTime("00:00:00.000", 10 * 100)).toBe("00:00:01.000");
  });

  it("calculates correct time with custom start time", () => {
    expect(addMsToTime("00:01:30.000", 150 * 100)).toBe("00:01:45.000");
  });
});

// ── Overlay canvas ─────────────────────────────────────────────────────────

describe("conversion overlay canvas", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("overlay canvas exists", () => {
    expect(document.getElementById("conv-overlay-canvas")).not.toBeNull();
  });

  it("canvas wrapper exists", () => {
    expect(document.getElementById("conv-canvas-wrapper")).not.toBeNull();
  });

  it("overlay canvas is inside canvas wrapper", () => {
    const wrapper = document.getElementById("conv-canvas-wrapper");
    const overlay = document.getElementById("conv-overlay-canvas");
    expect(wrapper.contains(overlay)).toBe(true);
  });

  it("main canvas is inside canvas wrapper", () => {
    const wrapper = document.getElementById("conv-canvas-wrapper");
    const main = document.getElementById("conv-canvas");
    expect(wrapper.contains(main)).toBe(true);
  });
});

// ── Mosaic controls ────────────────────────────────────────────────────────

describe("conversion mosaic controls", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("mosaic enable checkbox exists and is unchecked by default", () => {
    const el = document.getElementById("conv-mosaic-enable");
    expect(el).not.toBeNull();
    expect(el.checked).toBe(false);
  });

  it("mosaic size slider exists with correct range", () => {
    const el = document.getElementById("conv-mosaic-size");
    expect(el).not.toBeNull();
    expect(parseInt(el.min)).toBe(5);
    expect(parseInt(el.max)).toBe(50);
    expect(parseInt(el.value)).toBe(20);
  });

  it("mosaic options are hidden by default", () => {
    expect(document.getElementById("conv-mosaic-options").style.display).toBe("none");
  });

  it("mosaic apply-to-frame button exists and starts disabled", () => {
    const btn = document.getElementById("conv-btn-mosaic-frame");
    expect(btn).not.toBeNull();
    expect(btn.disabled).toBe(true);
  });

  it("mosaic apply-to-all button exists and starts disabled", () => {
    const btn = document.getElementById("conv-btn-mosaic-all");
    expect(btn).not.toBeNull();
    expect(btn.disabled).toBe(true);
  });
});

// ── Camera apply buttons ───────────────────────────────────────────────────

describe("conversion camera apply buttons", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("camera apply-to-frame button exists", () => {
    expect(document.getElementById("conv-btn-camera-frame")).not.toBeNull();
  });

  it("camera apply-to-all button exists", () => {
    expect(document.getElementById("conv-btn-camera-all")).not.toBeNull();
  });
});

// ── Camera auto-increment ──────────────────────────────────────────────────

describe("conversion camera auto-increment", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("auto-increment checkbox exists and is checked by default", () => {
    const el = document.getElementById("conv-camera-auto-inc");
    expect(el).not.toBeNull();
    expect(el.checked).toBe(true);
  });

  it("auto-increment ms input exists with default 100", () => {
    const el = document.getElementById("conv-camera-auto-inc-ms");
    expect(el).not.toBeNull();
    expect(parseInt(el.value)).toBe(100);
  });
});

// ── Reset effects ──────────────────────────────────────────────────────────

describe("conversion reset effects", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("reset effects button exists and starts disabled", () => {
    const btn = document.getElementById("conv-btn-reset-effects");
    expect(btn).not.toBeNull();
    expect(btn.disabled).toBe(true);
  });
});

// ── File info display ──────────────────────────────────────────────────────

describe("conversion file info display", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("file info section exists and is hidden by default", () => {
    const el = document.getElementById("conv-file-info");
    expect(el).not.toBeNull();
    expect(el.style.display).toBe("none");
  });

  it("file info grid container exists", () => {
    expect(document.getElementById("conv-info-grid")).not.toBeNull();
  });
});

// ── Loading progress ───────────────────────────────────────────────────────

describe("conversion loading progress", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("loading section exists and is hidden by default", () => {
    const el = document.getElementById("conv-loading-section");
    expect(el).not.toBeNull();
    expect(el.style.display).toBe("none");
  });

  it("loading progress fill element exists", () => {
    expect(document.getElementById("conv-loading-fill")).not.toBeNull();
  });

  it("loading text element exists", () => {
    expect(document.getElementById("conv-loading-text")).not.toBeNull();
  });
});

// ── Empty state ────────────────────────────────────────────────────────────

describe("conversion empty state", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("preview scroll area starts with empty class", () => {
    const el = document.getElementById("conv-preview-scroll");
    expect(el).not.toBeNull();
    expect(el.classList.contains("empty")).toBe(true);
  });
});
