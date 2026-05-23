// Pure image-processing and utility functions — no DOM dependencies.
// All pixel functions operate on Uint8ClampedArray (ImageData.data format: RGBA).

/**
 * Apply mosaic (pixelation) to masked region of pixel data.
 * Mutates `data` in place.
 */
export function mosaicPixels(data, width, height, mask, bounds, blockSize) {
  for (let by = bounds.y; by < bounds.y + bounds.h; by += blockSize) {
    for (let bx = bounds.x; bx < bounds.x + bounds.w; bx += blockSize) {
      let r = 0, g = 0, b = 0, count = 0;
      const endY = Math.min(by + blockSize, bounds.y + bounds.h, height);
      const endX = Math.min(bx + blockSize, bounds.x + bounds.w, width);

      for (let y = by; y < endY; y++) {
        for (let x = bx; x < endX; x++) {
          const mi = (y * width + x) * 4;
          if (mask[mi] === 0) continue;
          r += data[mi]; g += data[mi + 1]; b += data[mi + 2];
          count++;
        }
      }
      if (count === 0) continue;
      r = Math.round(r / count);
      g = Math.round(g / count);
      b = Math.round(b / count);

      for (let y = by; y < endY; y++) {
        for (let x = bx; x < endX; x++) {
          const mi = (y * width + x) * 4;
          if (mask[mi] === 0) continue;
          data[mi] = r; data[mi + 1] = g; data[mi + 2] = b;
        }
      }
    }
  }
}

/**
 * Apply directional motion blur to masked region of pixel data.
 * Reads from `src`, writes into `data`.
 */
export function blurPixels(data, src, width, height, mask, bounds, intensity, angleDeg) {
  const angleRad = (angleDeg - 45) * Math.PI / 180;
  const dx = Math.cos(angleRad);
  const dy = Math.sin(angleRad);
  const half = Math.floor(intensity / 2);

  for (let y = bounds.y; y < bounds.y + bounds.h; y++) {
    for (let x = bounds.x; x < bounds.x + bounds.w; x++) {
      const mi = (y * width + x) * 4;
      if (mask[mi] === 0) continue;

      let r = 0, g = 0, b = 0, count = 0;
      for (let k = -half; k <= half; k++) {
        const sx = Math.round(x + k * dx);
        const sy = Math.round(y + k * dy);
        if (sx < 0 || sx >= width || sy < 0 || sy >= height) continue;
        const si = (sy * width + sx) * 4;
        r += src[si]; g += src[si + 1]; b += src[si + 2];
        count++;
      }
      if (count > 0) {
        data[mi] = Math.round(r / count);
        data[mi + 1] = Math.round(g / count);
        data[mi + 2] = Math.round(b / count);
      }
    }
  }
}

/**
 * Compute bounding box of a polygon (array of {x, y}).
 * Returns {x, y, w, h} clamped to image dimensions, or null.
 */
export function getPolyBounds(poly, imgWidth, imgHeight) {
  if (!poly || poly.length < 3) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of poly) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const x = Math.max(0, Math.floor(minX));
  const y = Math.max(0, Math.floor(minY));
  return {
    x, y,
    w: Math.min(imgWidth, Math.ceil(maxX)) - x,
    h: Math.min(imgHeight, Math.ceil(maxY)) - y,
  };
}

// ── Time helpers (mirrors Python utils/time_utils.py) ───────────────────────

/**
 * Parse "HH:MM:SS.mmm" → {h, m, s, ms}. Returns zeros on invalid input.
 */
export function parseTimeString(timeStr) {
  try {
    const parts = timeStr.trim().split(":");
    if (parts.length !== 3) return { h: 0, m: 0, s: 0, ms: 0 };
    const h = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    const secParts = parts[2].split(".");
    const s = parseInt(secParts[0], 10);
    const ms = secParts.length > 1 ? parseInt(secParts[1], 10) : 0;
    if ([h, m, s, ms].some(isNaN)) return { h: 0, m: 0, s: 0, ms: 0 };
    return { h, m, s, ms };
  } catch {
    return { h: 0, m: 0, s: 0, ms: 0 };
  }
}

/**
 * Format {h, m, s, ms} → "HH:MM:SS.mmm"
 */
export function formatTime(h, m, s, ms) {
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
}

/**
 * Add milliseconds to a time string. Returns new time string.
 */
export function addMsToTime(timeStr, msToAdd) {
  const { h, m, s, ms } = parseTimeString(timeStr);
  let total = h * 3600000 + m * 60000 + s * 1000 + ms + msToAdd;
  const nh = Math.floor(total / 3600000); total %= 3600000;
  const nm = Math.floor(total / 60000); total %= 60000;
  const ns = Math.floor(total / 1000);
  const nms = total % 1000;
  return formatTime(nh, nm, ns, nms);
}

/**
 * Get battery indicator color based on level (0-1).
 */
export function getBatteryColor(level) {
  if (level <= 0.3) return "rgb(255,0,0)";
  if (level <= 0.6) return "rgb(255,191,0)";
  return "rgb(0,255,127)";
}

/**
 * Draw camera overlay (corner frames, battery, REC, timer) onto a canvas context.
 */
export function drawCameraOverlay(ctx, w, h, batteryLevel, timerText) {
  const minDim = Math.min(w, h);
  const margin = Math.floor(0.05 * minDim);
  const lineW = Math.max(1, Math.floor(0.01 * minDim));
  const batLineW = Math.max(1, Math.floor(0.005 * minDim));
  const cornerLen = Math.floor(0.1 * minDim);
  const arcR = Math.floor(0.025 * minDim);

  ctx.save();
  ctx.strokeStyle = "white";
  ctx.lineWidth = lineW;
  ctx.lineCap = "round";

  const corners = [
    { x: margin, y: margin, dx: 1, dy: 1 },
    { x: w - margin, y: margin, dx: -1, dy: 1 },
    { x: margin, y: h - margin, dx: 1, dy: -1 },
    { x: w - margin, y: h - margin, dx: -1, dy: -1 },
  ];
  for (const c of corners) {
    ctx.beginPath();
    ctx.moveTo(c.x + c.dx * arcR, c.y);
    ctx.lineTo(c.x + c.dx * cornerLen, c.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(c.x, c.y + c.dy * arcR);
    ctx.lineTo(c.x, c.y + c.dy * cornerLen);
    ctx.stroke();
    ctx.beginPath();
    const startAngle = c.dx === 1 && c.dy === 1 ? Math.PI : c.dx === -1 && c.dy === 1 ? 1.5 * Math.PI : c.dx === 1 && c.dy === -1 ? 0.5 * Math.PI : 0;
    ctx.arc(c.x + c.dx * arcR, c.y + c.dy * arcR, arcR, startAngle, startAngle + 0.5 * Math.PI);
    ctx.stroke();
  }

  const iconOff = batLineW * 4;
  const bodyW = 16 * batLineW;
  const bodyH = 8 * batLineW;
  const headW = 3 * batLineW;
  const headH = 3 * batLineW;
  const bx = margin + iconOff;
  const by = margin + iconOff;

  ctx.lineWidth = batLineW;
  ctx.strokeRect(bx, by, bodyW, bodyH);
  ctx.fillStyle = "white";
  ctx.fillRect(bx + bodyW, by + (bodyH - headH) / 2, headW, headH);

  const level = Math.max(batteryLevel, 0.2);
  ctx.fillStyle = getBatteryColor(batteryLevel);
  ctx.fillRect(bx + batLineW, by + batLineW, level * bodyW - 2 * batLineW, bodyH - 2 * batLineW);

  const recSize = Math.floor(0.04 * minDim);
  const circR = Math.floor(0.01 * minDim);
  const recX = w - margin - cornerLen + iconOff;
  const recY = margin + iconOff + circR + 2;
  ctx.fillStyle = "rgb(255,0,0)";
  ctx.beginPath();
  ctx.arc(recX, recY, circR, 0, 2 * Math.PI);
  ctx.fill();
  ctx.font = `${recSize}px Arial`;
  ctx.fillStyle = "rgb(255,0,0)";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText("REC", recX + circR + iconOff, recY);

  if (timerText) {
    ctx.font = `${recSize}px Arial`;
    ctx.fillStyle = "white";
    ctx.strokeStyle = "gray";
    ctx.lineWidth = 2;
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.strokeText(timerText, margin + iconOff, h - margin - iconOff);
    ctx.fillText(timerText, margin + iconOff, h - margin - iconOff);
  }

  ctx.restore();
}

/**
 * GIF conversion presets (from experimental/mp4_to_gif_ui.py).
 */
export const GIF_PRESETS = {
  "extreme": { label: "极致压缩 (推荐)", fps: 10, scale: 50, colors: 128, dither: "sierra2_4a", diffPalette: true },
  "balanced": { label: "平衡画质", fps: 15, scale: 50, colors: 256, dither: "sierra2_4a", diffPalette: true },
  "high": { label: "高质量", fps: 15, scale: 75, colors: 256, dither: "sierra2_4a", diffPalette: false },
  "smallest": { label: "最小体积", fps: 8, scale: 33, colors: 64, dither: "none", diffPalette: true },
  "original": { label: "原始质量", fps: 0, scale: 100, colors: 256, dither: "sierra2_4a", diffPalette: false },
};
