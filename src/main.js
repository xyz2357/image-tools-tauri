import {
  mosaicPixels, blurPixels, getPolyBounds, drawCameraOverlay,
} from "./effects.js";
import { initConversion } from "./conversion.js";
import { initTabs as initTabsShared } from "./tab-init.js";

// ── State ────────────────────────────────────────────────────────────────────

const state = {
  image: null,
  history: [],
  redoHistory: [],
  selectionMode: "RECT",
  selectionPoly: [],
  isSelecting: false,
  selStart: null,
  sourceFileName: null,
  textLayers: [],
  selectedTextId: null,
  nextTextId: 1,
};

// ── DOM refs ────────────────────────────────────────────────────────────────

const $ = (s) => document.querySelector(s);
const mainCanvas = $("#main-canvas");
const textCanvas = $("#text-canvas");
const overlayCanvas = $("#overlay-canvas");
const mainCtx = mainCanvas.getContext("2d", { willReadFrequently: true });
const textCtx = textCanvas.getContext("2d");
const overlayCtx = overlayCanvas.getContext("2d");
const canvasScroll = $("#canvas-scroll");
const fileInput = $("#file-input");

// ── Tab switching ───────────────────────────────────────────────────────────

// Thin wrapper so main.js doesn't have to pass `document` every time;
// the shared implementation lives in ./tab-init.js so tests can import
// the exact same code instead of maintaining a parallel copy.
function initTabs(barSelector, contentPrefix) {
  return initTabsShared(document, barSelector, contentPrefix);
}

// ── Canvas helpers ──────────────────────────────────────────────────────────

function resizeCanvases(w, h) {
  mainCanvas.width = w;
  mainCanvas.height = h;
  textCanvas.width = w;
  textCanvas.height = h;
  overlayCanvas.width = w;
  overlayCanvas.height = h;
  canvasScroll.classList.toggle("empty", w === 0);
}

function drawImage(img) {
  resizeCanvases(img.width, img.height);
  mainCtx.drawImage(img, 0, 0);
  clearOverlay();
  state.textLayers = [];
  state.selectedTextId = null;
  renderTextLayerList();
  drawTextLayers();
}

function getImageData() {
  return mainCtx.getImageData(0, 0, mainCanvas.width, mainCanvas.height);
}

function putImageData(data) {
  mainCanvas.width = data.width;
  mainCanvas.height = data.height;
  textCanvas.width = data.width;
  textCanvas.height = data.height;
  overlayCanvas.width = data.width;
  overlayCanvas.height = data.height;
  mainCtx.putImageData(data, 0, 0);
  drawTextLayers();
}

// ── Undo / Redo ─────────────────────────────────────────────────────────────

function pushUndo() {
  if (mainCanvas.width === 0) return;
  state.history.push(getImageData());
  state.redoHistory = [];
  if (state.history.length > 50) state.history.shift();
}

function undo() {
  if (!state.history.length) return;
  state.redoHistory.push(getImageData());
  putImageData(state.history.pop());
  clearOverlay();
}

function redo() {
  if (!state.redoHistory.length) return;
  state.history.push(getImageData());
  putImageData(state.redoHistory.pop());
  clearOverlay();
}

// ── File I/O ────────────────────────────────────────────────────────────────

function openImage() {
  fileInput.click();
}

fileInput.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  state.sourceFileName = file.name;
  updateTopFilename();
  const img = new Image();
  img.onload = () => {
    state.image = img;
    state.history = [];
    state.redoHistory = [];
    state.selectionPoly = [];
    drawImage(img);
  };
  img.src = URL.createObjectURL(file);
  fileInput.value = "";
});

async function saveImage() {
  if (mainCanvas.width === 0) return;

  const composite = document.createElement("canvas");
  composite.width = mainCanvas.width;
  composite.height = mainCanvas.height;
  const cctx = composite.getContext("2d");
  cctx.drawImage(mainCanvas, 0, 0);
  cctx.drawImage(textCanvas, 0, 0);

  const invoke = window.__TAURI__?.core?.invoke;
  if (invoke) {
    const dataUrl = composite.toDataURL("image/png");
    const base64Data = dataUrl.split(",")[1];
    const sourceName = state.sourceFileName || "";
    try {
      const path = await invoke("save_image", { base64Data, sourceName });
      if (path) console.log("Saved to", path);
    } catch (e) {
      console.error("Save failed:", e);
    }
  } else {
    composite.toBlob((blob) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "image_tools_output.png";
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }, "image/png");
  }
}

// ── Drag & drop ─────────────────────────────────────────────────────────────

canvasScroll.addEventListener("click", (e) => {
  // Empty preview area is clickable to open a file (same UX as the
  // conversion tab). Only triggers when nothing is loaded and the click
  // is on the scroll area itself (not on a child canvas).
  if (!state.image && e.target === canvasScroll) openImage();
});

canvasScroll.addEventListener("dragover", (e) => { e.preventDefault(); });
canvasScroll.addEventListener("drop", (e) => {
  e.preventDefault();
  const file = e.dataTransfer.files[0];
  if (!file || !file.type.startsWith("image/")) return;
  state.sourceFileName = file.name;
  updateTopFilename();
  const img = new Image();
  img.onload = () => {
    state.image = img;
    state.history = [];
    state.redoHistory = [];
    state.selectionPoly = [];
    drawImage(img);
  };
  img.src = URL.createObjectURL(file);
});

// ── Selection overlay ───────────────────────────────────────────────────────

function clearOverlay() {
  overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
}

function drawSelection(poly) {
  clearOverlay();
  if (poly.length < 2) return;
  overlayCtx.beginPath();
  overlayCtx.moveTo(poly[0].x, poly[0].y);
  for (let i = 1; i < poly.length; i++) overlayCtx.lineTo(poly[i].x, poly[i].y);
  overlayCtx.closePath();
  overlayCtx.strokeStyle = "rgba(255, 0, 0, 0.8)";
  overlayCtx.lineWidth = 2;
  overlayCtx.stroke();
  overlayCtx.fillStyle = "rgba(255, 0, 0, 0.08)";
  overlayCtx.fill();
}

// ── Mouse selection on overlay canvas ───────────────────────────────────────

overlayCanvas.style.pointerEvents = "auto";

function canvasCoords(e) {
  const r = overlayCanvas.getBoundingClientRect();
  const sx = mainCanvas.width / r.width;
  const sy = mainCanvas.height / r.height;
  return {
    x: Math.max(0, Math.min(mainCanvas.width, (e.clientX - r.left) * sx)),
    y: Math.max(0, Math.min(mainCanvas.height, (e.clientY - r.top) * sy)),
  };
}

overlayCanvas.addEventListener("mousedown", (e) => {
  if (mainCanvas.width === 0) return;
  state.isSelecting = true;
  state.selStart = canvasCoords(e);
  state.selectionPoly = [{ ...state.selStart }];
});

document.addEventListener("mousemove", (e) => {
  if (!state.isSelecting) return;
  const cur = canvasCoords(e);

  if (state.selectionMode === "RECT") {
    const s = state.selStart;
    state.selectionPoly = [
      { x: s.x, y: s.y },
      { x: cur.x, y: s.y },
      { x: cur.x, y: cur.y },
      { x: s.x, y: cur.y },
    ];
  } else {
    state.selectionPoly.push(cur);
  }
  drawSelection(state.selectionPoly);
});

document.addEventListener("mouseup", () => {
  state.isSelecting = false;
});

function setSelectionMode(mode) {
  state.selectionMode = mode;
  $("#btn-sel-rect").classList.toggle("active", mode === "RECT");
  $("#btn-sel-lasso").classList.toggle("active", mode === "LASSO");
}

function toggleSelectionMode() {
  setSelectionMode(state.selectionMode === "RECT" ? "LASSO" : "RECT");
}

function resetImage() {
  // Revert to the originally loaded image — discards every effect / text
  // layer. History is also wiped because the previous-state snapshots
  // refer to a now-replaced image.
  if (!state.image) return;
  state.history = [];
  state.redoHistory = [];
  state.selectionPoly = [];
  drawImage(state.image);
}

function updateTopFilename() {
  const el = document.getElementById("top-filename");
  if (!el) return;
  const label = el.querySelector(".label") || el;
  label.textContent = state.sourceFileName || "未加载文件";
  el.classList.toggle("loaded", !!state.sourceFileName);
}

// ── Selection mask helper ───────────────────────────────────────────────────

function createSelectionMask() {
  const poly = state.selectionPoly;
  if (poly.length < 3) return null;
  const w = mainCanvas.width, h = mainCanvas.height;
  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = w;
  maskCanvas.height = h;
  const ctx = maskCanvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.moveTo(poly[0].x, poly[0].y);
  for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
  ctx.closePath();
  ctx.fill();
  return ctx.getImageData(0, 0, w, h).data;
}

function getSelectionBounds() {
  return getPolyBounds(state.selectionPoly, mainCanvas.width, mainCanvas.height);
}

// ── Effects ─────────────────────────────────────────────────────────────────

function applyMosaic() {
  const mask = createSelectionMask();
  if (!mask) return;
  const bounds = getSelectionBounds();
  const blockSize = parseInt($("#mosaic-size").value);

  pushUndo();
  const imageData = getImageData();
  mosaicPixels(imageData.data, imageData.width, imageData.height, mask, bounds, blockSize);
  putImageData(imageData);
}

function applyBlur() {
  const mask = createSelectionMask();
  if (!mask) return;
  const bounds = getSelectionBounds();
  const intensity = parseInt($("#blur-intensity").value);
  const angleDeg = parseInt($("#blur-angle").value);

  pushUndo();
  const imageData = getImageData();
  const src = new Uint8ClampedArray(imageData.data);
  blurPixels(imageData.data, src, imageData.width, imageData.height, mask, bounds, intensity, angleDeg);
  putImageData(imageData);
}

function applyCameraEffect() {
  if (mainCanvas.width === 0) return;
  pushUndo();
  const batteryLevel = parseInt($("#camera-battery").value) / 100;
  const timerText = $("#camera-timer").value.trim();
  drawCameraOverlay(mainCtx, mainCanvas.width, mainCanvas.height, batteryLevel, timerText);
}

// ── Text layers ─────────────────────────────────────────────────────────────

function drawTextOnCtx(ctx, layer) {
  ctx.save();
  ctx.translate(layer.cx, layer.cy);
  ctx.rotate(layer.angle * Math.PI / 180);
  ctx.font = `${layer.size}px "${layer.font}"`;
  ctx.fillStyle = layer.color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  if (layer.vertical) {
    const chars = [...layer.text];
    const lineHeight = layer.size * 1.3;
    const totalHeight = chars.length * lineHeight;
    let y = -totalHeight / 2 + lineHeight / 2;
    for (const ch of chars) {
      ctx.fillText(ch, 0, y);
      y += lineHeight;
    }
  } else {
    ctx.fillText(layer.text, 0, 0);
  }
  ctx.restore();
}

function drawTextLayers() {
  textCtx.clearRect(0, 0, textCanvas.width, textCanvas.height);
  for (const layer of state.textLayers) {
    drawTextOnCtx(textCtx, layer);
  }
  const sel = state.textLayers.find((l) => l.id === state.selectedTextId);
  if (sel) drawTextHighlight(textCtx, sel);
}

function drawTextHighlight(ctx, layer) {
  ctx.save();
  ctx.translate(layer.cx, layer.cy);
  ctx.rotate(layer.angle * Math.PI / 180);
  ctx.font = `${layer.size}px "${layer.font}"`;

  let w, h;
  if (layer.vertical) {
    const chars = [...layer.text];
    w = Math.max(...chars.map((ch) => ctx.measureText(ch).width));
    h = layer.size * chars.length * 1.3;
  } else {
    w = ctx.measureText(layer.text).width;
    h = layer.size * 1.2;
  }

  ctx.strokeStyle = "rgba(137, 180, 250, 0.8)";
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 4]);
  ctx.strokeRect(-w / 2 - 4, -h / 2 - 4, w + 8, h + 8);
  ctx.restore();
}

function calculateAutoFitSize(text, font, bounds, vertical) {
  if (!bounds || bounds.w <= 0 || bounds.h <= 0 || !text) return 20;
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d");

  let lo = 1, hi = 500;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    ctx.font = `${mid}px "${font}"`;
    let fits;
    if (vertical) {
      const chars = [...text];
      const charW = Math.max(...chars.map((ch) => ctx.measureText(ch).width));
      fits = charW <= bounds.w && mid * chars.length * 1.3 <= bounds.h;
    } else {
      fits = ctx.measureText(text).width <= bounds.w && mid * 1.2 <= bounds.h;
    }
    if (fits) lo = mid; else hi = mid - 1;
  }
  return lo;
}

function addTextLayer() {
  const text = $("#text-input").value;
  if (!text || mainCanvas.width === 0) return;

  const poly = state.selectionPoly;
  let cx, cy;
  if (poly.length >= 3) {
    cx = 0; cy = 0;
    for (const p of poly) { cx += p.x; cy += p.y; }
    cx /= poly.length; cy /= poly.length;
  } else {
    cx = mainCanvas.width / 2;
    cy = mainCanvas.height / 2;
  }

  const font = $("#text-font").value;
  const color = $("#text-color").value;
  const angle = parseInt($("#text-angle").value);
  const vertical = $("#text-vertical").checked;
  const autoFit = $("#text-auto-fit").checked;

  let size;
  if (autoFit) {
    const bounds = poly.length >= 3
      ? getPolyBounds(poly, mainCanvas.width, mainCanvas.height)
      : { x: 0, y: 0, w: mainCanvas.width, h: mainCanvas.height };
    size = calculateAutoFitSize(text, font, bounds, vertical);
  } else {
    size = parseInt($("#text-size").value);
  }

  const layer = { id: state.nextTextId++, text, font, size, color, angle, cx, cy, autoFit, vertical };
  state.textLayers.push(layer);
  selectTextLayer(layer.id);
}

function selectTextLayer(id) {
  if (state.selectedTextId === id) {
    state.selectedTextId = null;
  } else {
    state.selectedTextId = id;
    const layer = state.textLayers.find((l) => l.id === id);
    if (layer) {
      $("#text-input").value = layer.text;
      $("#text-font").value = layer.font;
      $("#text-color").value = layer.color;
      $("#text-size").value = layer.size;
      $("#text-size-val").textContent = layer.size;
      $("#text-angle").value = layer.angle;
      $("#text-angle-val").textContent = layer.angle;
      $("#text-auto-fit").checked = layer.autoFit;
      $("#text-vertical").checked = layer.vertical;
      $("#text-size").disabled = layer.autoFit;
    }
  }
  renderTextLayerList();
  drawTextLayers();
}

function deleteTextLayer(id) {
  state.textLayers = state.textLayers.filter((l) => l.id !== id);
  if (state.selectedTextId === id) state.selectedTextId = null;
  renderTextLayerList();
  drawTextLayers();
}

function onTextControlChange() {
  if (state.selectedTextId === null) return;
  const layer = state.textLayers.find((l) => l.id === state.selectedTextId);
  if (!layer) return;

  layer.text = $("#text-input").value;
  layer.font = $("#text-font").value;
  layer.color = $("#text-color").value;
  layer.angle = parseInt($("#text-angle").value);
  layer.vertical = $("#text-vertical").checked;
  layer.autoFit = $("#text-auto-fit").checked;

  if (layer.autoFit) {
    const poly = state.selectionPoly;
    const bounds = poly.length >= 3
      ? getPolyBounds(poly, mainCanvas.width, mainCanvas.height)
      : { x: 0, y: 0, w: mainCanvas.width, h: mainCanvas.height };
    layer.size = calculateAutoFitSize(layer.text, layer.font, bounds, layer.vertical);
    $("#text-size").value = layer.size;
    $("#text-size-val").textContent = layer.size;
  } else {
    layer.size = parseInt($("#text-size").value);
  }

  renderTextLayerList();
  drawTextLayers();
}

function renderTextLayerList() {
  const list = $("#text-layer-list");
  if (!list) return;
  list.innerHTML = "";
  for (const layer of state.textLayers) {
    const item = document.createElement("div");
    item.className = "text-layer-item" + (layer.id === state.selectedTextId ? " selected" : "");

    const preview = document.createElement("span");
    preview.className = "text-layer-preview";
    preview.textContent = layer.text.length > 12 ? layer.text.slice(0, 12) + "…" : layer.text;

    const del = document.createElement("button");
    del.className = "text-layer-delete";
    del.textContent = "×";
    del.title = "删除";
    del.addEventListener("click", (e) => { e.stopPropagation(); deleteTextLayer(layer.id); });

    item.addEventListener("click", () => selectTextLayer(layer.id));
    item.appendChild(preview);
    item.appendChild(del);
    list.appendChild(item);
  }
}

// ── Preview canvases ────────────────────────────────────────────────────────

function updateTextPreview() {
  const c = $("#text-preview");
  const ctx = c.getContext("2d");
  const size = 60;
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = "#ddd";
  ctx.strokeRect(0, 0, size - 1, size - 1);

  const font = $("#text-font").value;
  const color = $("#text-color").value;
  const angle = parseInt($("#text-angle").value) * Math.PI / 180;
  const vertical = $("#text-vertical").checked;

  ctx.save();
  ctx.translate(size / 2, size / 2);
  ctx.rotate(angle);
  ctx.font = `12px "${font}"`;
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  if (vertical) {
    ctx.fillText("A", 0, -8);
    ctx.fillText("a", 0, 8);
  } else {
    ctx.fillText("Aa", 0, 0);
  }
  ctx.restore();
}

function updateBlurPreview() {
  const c = $("#blur-preview");
  const ctx = c.getContext("2d");
  const size = 60;
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, size, size);

  ctx.strokeStyle = "#ddd";
  ctx.strokeRect(0, 0, size - 1, size - 1);

  const angle = parseInt($("#blur-angle").value) * Math.PI / 180;
  const lineLen = size * 0.7;

  ctx.save();
  ctx.translate(size / 2, size / 2);
  ctx.rotate(angle);
  ctx.strokeStyle = "#000";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-lineLen / 2, 0);
  ctx.lineTo(lineLen / 2, 0);
  ctx.stroke();

  const a = 5;
  ctx.beginPath();
  ctx.moveTo(lineLen / 2, 0);
  ctx.lineTo(lineLen / 2 - a, -a);
  ctx.moveTo(lineLen / 2, 0);
  ctx.lineTo(lineLen / 2 - a, a);
  ctx.moveTo(-lineLen / 2, 0);
  ctx.lineTo(-lineLen / 2 + a, -a);
  ctx.moveTo(-lineLen / 2, 0);
  ctx.lineTo(-lineLen / 2 + a, a);
  ctx.stroke();
  ctx.restore();
}

// ── Slider value display ────────────────────────────────────────────────────

function bindSlider(sliderId, displayId, suffix, onChange) {
  const slider = $(sliderId);
  const display = $(displayId);
  slider.addEventListener("input", () => {
    display.textContent = slider.value + (suffix || "");
    if (onChange) onChange();
  });
}

// ── Keyboard shortcuts ──────────────────────────────────────────────────────

document.addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;

  if (e.ctrlKey && e.key === "o") { e.preventDefault(); openImage(); }
  else if (e.ctrlKey && e.key === "s") { e.preventDefault(); saveImage(); }
  else if (e.ctrlKey && e.shiftKey && (e.key === "Z" || e.key === "z")) { e.preventDefault(); redo(); }
  else if (e.ctrlKey && e.key === "z") { e.preventDefault(); undo(); }
  else if (e.ctrlKey && e.key === "m") { e.preventDefault(); applyMosaic(); }
  else if (e.ctrlKey && e.key === "b") { e.preventDefault(); applyBlur(); }
  else if (e.key === "Tab") { e.preventDefault(); toggleSelectionMode(); }
  else if (e.key === "Delete" && state.selectedTextId !== null) { deleteTextLayer(state.selectedTextId); }
});

// ── Init ────────────────────────────────────────────────────────────────────

window.addEventListener("DOMContentLoaded", () => {
  // Primary tabs: also toggles a body class so the toolbar can show/hide
  // tab-specific buttons (selection-mode, redo for image only; rest shared).
  document.body.classList.add("tab-image");
  const primaryBar = $(".primary-tabs");
  primaryBar.addEventListener("click", (e) => {
    const btn = e.target.closest(".tab-btn");
    if (!btn) return;
    document.body.classList.toggle("tab-image", btn.dataset.tab === "image-tools");
    document.body.classList.toggle("tab-video", btn.dataset.tab === "conversion");
  });
  initTabs(".primary-tabs", "tab-");
  initTabs("#img-pill-bar", "tool-");

  // Toolbar buttons — these dispatch to whichever tab is active.
  $("#btn-open").addEventListener("click", () => {
    if (document.body.classList.contains("tab-image")) openImage();
    else if (window.__convOpenFile) window.__convOpenFile();
  });
  $("#btn-undo").addEventListener("click", () => {
    if (document.body.classList.contains("tab-image")) undo();
    else if (window.__convUndo) window.__convUndo();
  });
  $("#btn-redo").addEventListener("click", () => {
    if (document.body.classList.contains("tab-image")) redo();
    else if (window.__convRedo) window.__convRedo();
  });
  $("#btn-reset").addEventListener("click", () => {
    if (document.body.classList.contains("tab-image")) resetImage();
    else if (window.__convReset) window.__convReset();
  });
  $("#btn-sel-rect").addEventListener("click", () => setSelectionMode("RECT"));
  $("#btn-sel-lasso").addEventListener("click", () => setSelectionMode("LASSO"));

  // Save (in image-tools "保存到" pane) + format/quality controls
  $("#btn-save").addEventListener("click", saveImage);
  $("#save-format").addEventListener("change", (e) => {
    $("#save-quality-field").style.display = e.target.value === "jpg" ? "" : "none";
  });
  bindSlider("#save-quality", "#save-quality-val");

  $("#btn-apply-mosaic").addEventListener("click", applyMosaic);
  $("#btn-apply-text").addEventListener("click", addTextLayer);
  $("#btn-apply-blur").addEventListener("click", applyBlur);
  $("#btn-apply-camera").addEventListener("click", applyCameraEffect);

  // Sliders
  bindSlider("#mosaic-size", "#mosaic-size-val");
  bindSlider("#text-size", "#text-size-val", null, onTextControlChange);
  bindSlider("#text-angle", "#text-angle-val", null, () => { onTextControlChange(); updateTextPreview(); });
  bindSlider("#blur-intensity", "#blur-intensity-val");
  bindSlider("#blur-angle", "#blur-angle-val", null, updateBlurPreview);
  bindSlider("#camera-battery", "#camera-battery-val");

  // Text controls — live update selected layer
  $("#text-input").addEventListener("input", onTextControlChange);
  $("#text-font").addEventListener("change", () => { onTextControlChange(); updateTextPreview(); });
  $("#text-color").addEventListener("input", () => { onTextControlChange(); updateTextPreview(); });
  $("#text-auto-fit").addEventListener("change", () => {
    $("#text-size").disabled = $("#text-auto-fit").checked;
    onTextControlChange();
  });
  $("#text-vertical").addEventListener("change", () => { onTextControlChange(); updateTextPreview(); });

  // Initial previews
  updateTextPreview();
  updateBlurPreview();

  // Start with empty canvas hint
  canvasScroll.classList.add("empty");
  resizeCanvases(0, 0);

  // Conversion tab
  const convApi = initConversion();
  window.__convUndo = convApi.undo;
  window.__convRedo = convApi.redo;
  window.__convReset = convApi.resetEffects;
  window.__convOpenFile = convApi.openFile;

  // Test / sample-generation hooks. Lets scripts drive the image-tools
  // tab without going through the native file dialog: inject a base64
  // PNG, set a full-canvas selection, then trigger the normal apply
  // buttons. Used by scripts/gen-samples.mjs.
  window.__mainTest = {
    loadImage(base64) {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          state.image = img;
          state.history = [];
          state.redoHistory = [];
          state.selectionPoly = [];
          state.textLayers = [];
          state.selectedTextId = null;
          drawImage(img);
          resolve();
        };
        img.onerror = reject;
        img.src = "data:image/png;base64," + base64;
      });
    },
    setSelectionFull() {
      const w = mainCanvas.width, h = mainCanvas.height;
      state.selectionPoly = [{x:0,y:0},{x:w,y:0},{x:w,y:h},{x:0,y:h}];
    },
    getCompositeDataURL() {
      const comp = document.createElement("canvas");
      comp.width = mainCanvas.width;
      comp.height = mainCanvas.height;
      const cc = comp.getContext("2d");
      cc.drawImage(mainCanvas, 0, 0);
      cc.drawImage(textCanvas, 0, 0);
      return comp.toDataURL("image/png");
    },
  };
});
