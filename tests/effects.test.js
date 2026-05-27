/**
 * Pure function tests — mirrors tests/test_webp_to_gif_widget.py::TestPureFunctions
 * and the pixel-processing logic from test_widgets_automated.py.
 *
 * No DOM or Canvas required.
 */
import { describe, it, expect } from "vitest";
import {
  mosaicPixels,
  blurPixels,
  getPolyBounds,
  parseTimeString,
  formatTime,
  addMsToTime,
  getBatteryColor,
} from "../src/effects.js";

// ── helpers ─────────────────────────────────────────────────────────────────

function solidPixels(w, h, r, g, b) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
  }
  return data;
}

function gradientPixels(w, h) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      data[i] = x;           // R varies per column
      data[i + 1] = y;       // G varies per row
      data[i + 2] = 0;
      data[i + 3] = 255;
    }
  }
  return data;
}

function fullMask(w, h) {
  const mask = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < mask.length; i += 4) {
    mask[i] = 255; mask[i + 1] = 255; mask[i + 2] = 255; mask[i + 3] = 255;
  }
  return mask;
}

// ── mosaic ──────────────────────────────────────────────────────────────────

describe("mosaicPixels", () => {
  it("produces a valid output array of same length", () => {
    const w = 100, h = 100;
    const data = gradientPixels(w, h);
    const mask = fullMask(w, h);
    const bounds = { x: 10, y: 10, w: 40, h: 40 };
    mosaicPixels(data, w, h, mask, bounds, 10);
    expect(data.length).toBe(w * h * 4);
  });

  it("modifies target area (pixels within block become uniform)", () => {
    const w = 100, h = 100;
    const data = gradientPixels(w, h);
    const mask = fullMask(w, h);
    const bounds = { x: 0, y: 0, w: 20, h: 20 };
    mosaicPixels(data, w, h, mask, bounds, 10);
    // All pixels in the first block should share the same colour
    const p00 = [data[0], data[1], data[2]];
    const idx99 = (9 * w + 9) * 4;
    const p99 = [data[idx99], data[idx99 + 1], data[idx99 + 2]];
    expect(p00).toEqual(p99);
  });

  it("does not mutate pixels outside the mask", () => {
    const w = 50, h = 50;
    const data = gradientPixels(w, h);
    const original = new Uint8ClampedArray(data);
    // Empty mask — nothing selected
    const mask = new Uint8ClampedArray(w * h * 4);
    const bounds = { x: 0, y: 0, w: 50, h: 50 };
    mosaicPixels(data, w, h, mask, bounds, 10);
    expect(data).toEqual(original);
  });

  it("handles block size larger than bounds", () => {
    const w = 20, h = 20;
    const data = gradientPixels(w, h);
    const mask = fullMask(w, h);
    const bounds = { x: 0, y: 0, w: 10, h: 10 };
    // block size 100 > bounds — should still work (one big block)
    expect(() => mosaicPixels(data, w, h, mask, bounds, 100)).not.toThrow();
  });
});

// ── blur ────────────────────────────────────────────────────────────────────

describe("blurPixels", () => {
  it("produces a valid output array of same length", () => {
    const w = 60, h = 60;
    const data = gradientPixels(w, h);
    const src = new Uint8ClampedArray(data);
    const mask = fullMask(w, h);
    const bounds = { x: 10, y: 10, w: 30, h: 30 };
    blurPixels(data, src, w, h, mask, bounds, 10, 90);
    expect(data.length).toBe(w * h * 4);
  });

  it("modifies pixels within the masked area", () => {
    const w = 60, h = 60;
    // Vertical step pattern: left half black, right half white
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const v = x < 30 ? 0 : 255;
        data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = 255;
      }
    }
    const original = new Uint8ClampedArray(data);
    const src = new Uint8ClampedArray(data);
    const mask = fullMask(w, h);
    // Bounds covering the boundary region; angle=45 → horizontal blur
    const bounds = { x: 20, y: 10, w: 20, h: 40 };
    blurPixels(data, src, w, h, mask, bounds, 10, 45);
    // Pixels near x=30 boundary should now have intermediate values
    let changed = false;
    for (let y = 15; y < 45; y++) {
      const i = (y * w + 30) * 4;
      if (data[i] !== original[i]) { changed = true; break; }
    }
    expect(changed).toBe(true);
  });

  it("does not modify pixels outside the mask", () => {
    const w = 40, h = 40;
    const data = gradientPixels(w, h);
    const original = new Uint8ClampedArray(data);
    const src = new Uint8ClampedArray(data);
    const mask = new Uint8ClampedArray(w * h * 4); // empty
    const bounds = { x: 0, y: 0, w: 40, h: 40 };
    blurPixels(data, src, w, h, mask, bounds, 10, 90);
    expect(data).toEqual(original);
  });
});

// ── getPolyBounds ───────────────────────────────────────────────────────────

describe("getPolyBounds", () => {
  it("returns null for fewer than 3 points", () => {
    expect(getPolyBounds([], 100, 100)).toBeNull();
    expect(getPolyBounds([{ x: 0, y: 0 }], 100, 100)).toBeNull();
    expect(getPolyBounds([{ x: 0, y: 0 }, { x: 10, y: 10 }], 100, 100)).toBeNull();
  });

  it("returns null for null input", () => {
    expect(getPolyBounds(null, 100, 100)).toBeNull();
  });

  it("computes correct bounding box", () => {
    const poly = [{ x: 10, y: 20 }, { x: 50, y: 20 }, { x: 50, y: 60 }, { x: 10, y: 60 }];
    const b = getPolyBounds(poly, 100, 100);
    expect(b.x).toBe(10);
    expect(b.y).toBe(20);
    expect(b.w).toBe(40);
    expect(b.h).toBe(40);
  });

  it("clamps to image dimensions", () => {
    const poly = [{ x: -10, y: -5 }, { x: 200, y: -5 }, { x: 200, y: 300 }];
    const b = getPolyBounds(poly, 80, 60);
    expect(b.x).toBe(0);
    expect(b.y).toBe(0);
    expect(b.w).toBeLessThanOrEqual(80);
    expect(b.h).toBeLessThanOrEqual(60);
  });
});

// ── time helpers (mirrors Python tests/test_webp_to_gif_widget.py) ──────────

describe("parseTimeString", () => {
  it("parses normal time string", () => {
    expect(parseTimeString("01:02:03.456")).toEqual({ h: 1, m: 2, s: 3, ms: 456 });
  });

  it("parses time string without milliseconds", () => {
    expect(parseTimeString("00:00:05")).toEqual({ h: 0, m: 0, s: 5, ms: 0 });
  });

  it("returns zeros for invalid input", () => {
    expect(parseTimeString("garbage")).toEqual({ h: 0, m: 0, s: 0, ms: 0 });
    expect(parseTimeString("")).toEqual({ h: 0, m: 0, s: 0, ms: 0 });
  });
});

describe("formatTime", () => {
  it("formats time correctly", () => {
    expect(formatTime(1, 2, 3, 456)).toBe("01:02:03.456");
    expect(formatTime(0, 0, 0, 0)).toBe("00:00:00.000");
  });
});

describe("addMsToTime", () => {
  it("adds milliseconds correctly", () => {
    expect(addMsToTime("00:00:00.000", 1500)).toBe("00:00:01.500");
  });

  it("handles rollover (59s + 2s = 1m01s)", () => {
    expect(addMsToTime("00:00:59.000", 2000)).toBe("00:01:01.000");
  });

  it("handles zero delta", () => {
    const t = "01:23:45.678";
    expect(addMsToTime(t, 0)).toBe(t);
  });

  it("handles large additions crossing hour boundary", () => {
    const result = addMsToTime("00:59:59.999", 1);
    expect(result).toBe("01:00:00.000");
  });

  // ── Boundary regressions ─────────────────────────────────────────────────
  // The "00:00:00.066666666666666667" formatting bug shipped because
  // every test above used integer ms. msToAdd is in practice 1000/fps,
  // which is fractional whenever fps doesn't divide 1000 evenly. Make
  // sure each frame index at common fractional fps formats to whole ms.

  it("rounds fractional msToAdd to whole milliseconds (15fps)", () => {
    // 1000/15 ≈ 66.666… — frame 1 should be ~67ms, not 66.6666….
    const out = addMsToTime("00:00:00.000", 1000 / 15);
    expect(out).toMatch(/^\d{2}:\d{2}:\d{2}\.\d{3}$/);
    expect(out).not.toContain("6666");
  });

  it("handles a long sequence of fractional adds at 24fps", () => {
    // Frame 100 at 24fps = ~4166.666ms — must format cleanly.
    const out = addMsToTime("00:00:00.000", (100 * 1000) / 24);
    expect(out).toMatch(/^00:00:0[34]\.\d{3}$/);
  });

  it("never produces more than 3 fractional digits", () => {
    for (const fps of [15, 23.976, 24, 29.97, 60]) {
      for (const frame of [1, 7, 13, 99, 1234]) {
        const out = addMsToTime("00:00:00.000", (frame * 1000) / fps);
        const ms = out.split(".")[1];
        expect(ms.length).toBe(3);
        expect(/^\d{3}$/.test(ms)).toBe(true);
      }
    }
  });

  it("handles a tiny fractional delta near zero", () => {
    expect(addMsToTime("00:00:00.000", 0.4)).toBe("00:00:00.000");
    expect(addMsToTime("00:00:00.000", 0.6)).toBe("00:00:00.001");
  });

  it("handles a huge delta (multi-hour) without overflow", () => {
    // 5h25m13.500s
    expect(addMsToTime("00:00:00.000", 5 * 3600000 + 25 * 60000 + 13500)).toBe("05:25:13.500");
  });
});

// ── getBatteryColor ─────────────────────────────────────────────────────────

describe("getBatteryColor", () => {
  it("returns red for low battery (<=0.3)", () => {
    expect(getBatteryColor(0)).toContain("255,0,0");
    expect(getBatteryColor(0.3)).toContain("255,0,0");
  });

  it("returns yellow for medium battery (<=0.6)", () => {
    expect(getBatteryColor(0.5)).toContain("255,191,0");
  });

  it("returns green for high battery (>0.6)", () => {
    expect(getBatteryColor(1.0)).toContain("0,255,127");
  });
});
