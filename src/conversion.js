import { drawCameraOverlay, addMsToTime, GIF_PRESETS, mosaicPixels } from "./effects.js";

const $ = (s) => document.querySelector(s);
const invoke = window.__TAURI__?.core?.invoke;

// ── State ───────────────────────────────────────────────────────────────────

const state = {
  frames: [],
  originalFrames: [],
  currentFrame: 0,
  fps: 15,
  sourceFps: 30,
  sourceFile: null,
  sourcePath: null,
  sourceInfo: null,
  tempDir: null,
  isExporting: false,
  mosaicSelection: null,
  isSelectingMosaic: false,
  mosaicStart: null,
};

// ── DOM refs ────────────────────────────────────────────────────────────────

let canvas, ctx, overlayCanvas, overlayCtx;

// ── Init ────────────────────────────────────────────────────────────────────

export function initConversion() {
  canvas = $("#conv-canvas");
  ctx = canvas.getContext("2d");
  overlayCanvas = $("#conv-overlay-canvas");
  overlayCtx = overlayCanvas.getContext("2d");

  $("#conv-btn-open").addEventListener("click", openFile);
  $("#conv-btn-export").addEventListener("click", exportAnimation);
  $("#conv-btn-estimate").addEventListener("click", estimateSize);
  $("#conv-btn-prev").addEventListener("click", () => seekFrame(state.currentFrame - 1));
  $("#conv-btn-next").addEventListener("click", () => seekFrame(state.currentFrame + 1));
  $("#conv-frame-slider").addEventListener("input", (e) => seekFrame(parseInt(e.target.value)));

  $("#conv-format").addEventListener("change", onFormatChange);
  $("#conv-preset").addEventListener("change", onPresetChange);
  $("#conv-camera-enable").addEventListener("change", (e) => {
    $("#conv-camera-options").style.display = e.target.checked ? "" : "none";
    updatePreview();
  });
  $("#conv-camera-battery").addEventListener("input", (e) => {
    $("#conv-camera-battery-val").textContent = e.target.value;
    updatePreview();
  });
  $("#conv-camera-timer").addEventListener("change", updatePreview);

  $("#conv-fps").addEventListener("input", (e) => {
    $("#conv-fps-val").textContent = e.target.value;
    switchToCustomPreset();
  });
  $("#conv-colors").addEventListener("input", (e) => {
    $("#conv-colors-val").textContent = e.target.value;
    switchToCustomPreset();
  });
  $("#conv-scale").addEventListener("change", switchToCustomPreset);
  $("#conv-dither").addEventListener("change", switchToCustomPreset);
  $("#conv-diff-palette").addEventListener("change", switchToCustomPreset);

  $("#conv-ugoira-quality").addEventListener("input", (e) => {
    $("#conv-ugoira-quality-val").textContent = e.target.value;
  });
  $("#conv-ugoira-delay").addEventListener("change", onUgoiraDelayChange);
  $("#conv-ugoira-scale").addEventListener("change", onUgoiraScaleChange);

  // Mosaic controls
  $("#conv-mosaic-enable").addEventListener("change", (e) => {
    $("#conv-mosaic-options").style.display = e.target.checked ? "" : "none";
    if (!e.target.checked) {
      state.mosaicSelection = null;
      clearConvOverlay();
    }
  });
  $("#conv-mosaic-size").addEventListener("input", (e) => {
    $("#conv-mosaic-size-val").textContent = e.target.value;
  });
  $("#conv-btn-mosaic-frame").addEventListener("click", () => applyMosaicToFrames(false));
  $("#conv-btn-mosaic-all").addEventListener("click", () => applyMosaicToFrames(true));

  // Camera apply buttons
  $("#conv-btn-camera-frame").addEventListener("click", () => applyCameraToFrames(false));
  $("#conv-btn-camera-all").addEventListener("click", () => applyCameraToFrames(true));

  // Reset effects
  $("#conv-btn-reset-effects").addEventListener("click", resetEffects);

  // Overlay canvas mouse events for mosaic selection
  overlayCanvas.addEventListener("mousedown", onOverlayMouseDown);
  document.addEventListener("mousemove", onOverlayMouseMove);
  document.addEventListener("mouseup", onOverlayMouseUp);

  // Drag & drop
  const scroll = $("#conv-preview-scroll");
  scroll.addEventListener("dragover", (e) => e.preventDefault());
  scroll.addEventListener("drop", (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) loadFromFile(file);
  });

  applyPreset("extreme");
  onFormatChange();
}

// ── File loading ────────────────────────────────────────────────────────────

async function openFile() {
  if (invoke) {
    try {
      const path = await invoke("pick_open_file");
      if (path) {
        state.sourcePath = path;
        setStatus("加载中...");
        await loadFromPath(path);
      }
    } catch (e) {
      setStatus(`错误: ${e}`);
    }
  } else {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "video/*,image/gif,image/webp,image/png,image/apng";
    input.onchange = () => {
      if (input.files[0]) loadFromFile(input.files[0]);
    };
    input.click();
  }
}

async function loadFromPath(path) {
  try {
    const info = await invoke("get_video_info", { path });
    state.sourceInfo = info;
    state.sourceFps = info.fps;
    displayFileInfo(info, path.split(/[/\\]/).pop());

    const tempDir = await invoke("create_temp_dir");
    state.tempDir = tempDir;

    const fps = Math.min(info.fps, 30);
    const framePaths = await invoke("extract_frames", { path, fps, tempDir });

    state.frames = [];
    showLoading(true);
    for (let i = 0; i < framePaths.length; i++) {
      const img = await loadImageFromPath(framePaths[i]);
      state.frames.push(img);
      setLoadingProgress(Math.round(((i + 1) / framePaths.length) * 100));
    }
    showLoading(false);

    state.fps = fps;
    $("#conv-fps").value = fps;
    $("#conv-fps-val").textContent = fps;

    onFramesLoaded();
    setStatus(`已加载 ${state.frames.length} 帧，来自 ${path.split(/[/\\]/).pop()}`);
  } catch (e) {
    showLoading(false);
    setStatus(`加载失败: ${e}`);
  }
}

async function loadImageFromPath(filePath) {
  const base64 = await invoke("read_frame_base64", { path: filePath });
  const img = new Image();
  img.src = `data:image/png;base64,${base64}`;
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
  });
  return img;
}

async function loadFromFile(file) {
  state.sourceFile = file;
  state.sourcePath = file.name;
  setStatus("加载帧中...");
  showLoading(true);

  try {
    if (file.type.startsWith("video/")) {
      await loadVideoFrames(file);
    } else {
      await loadAnimatedFrames(file);
    }
    showLoading(false);

    if (state.frames.length > 0) {
      const first = state.frames[0];
      const w = first.width || first.naturalWidth;
      const h = first.height || first.naturalHeight;
      const syntheticInfo = {
        width: w, height: h, fps: state.fps,
        duration_ms: Math.round((state.frames.length / state.fps) * 1000),
        file_size: file.size,
      };
      state.sourceInfo = syntheticInfo;
      displayFileInfo(syntheticInfo, file.name);
    }

    onFramesLoaded();
    setStatus(`已加载 ${state.frames.length} 帧，来自 ${file.name}`);
  } catch (e) {
    showLoading(false);
    setStatus(`加载失败: ${e}`);
  }
}

async function loadVideoFrames(file) {
  const video = document.createElement("video");
  video.muted = true;
  video.preload = "auto";
  const url = URL.createObjectURL(file);
  video.src = url;

  await new Promise((resolve, reject) => {
    video.onloadedmetadata = resolve;
    video.onerror = reject;
  });

  const duration = video.duration;
  const fps = Math.min(30, state.sourceFps || 30);
  const totalFrames = Math.floor(duration * fps);
  const interval = 1 / fps;
  state.frames = [];

  const frameLimit = Math.min(totalFrames, 600);
  for (let i = 0; i < frameLimit; i++) {
    video.currentTime = i * interval;
    await new Promise((resolve) => {
      video.onseeked = resolve;
    });
    const c = document.createElement("canvas");
    c.width = video.videoWidth;
    c.height = video.videoHeight;
    c.getContext("2d").drawImage(video, 0, 0);
    const img = new Image();
    img.src = c.toDataURL("image/png");
    await new Promise((resolve) => { img.onload = resolve; });
    state.frames.push(img);
    setLoadingProgress(Math.round(((i + 1) / frameLimit) * 100));
  }

  state.fps = fps;
  $("#conv-fps").value = fps;
  $("#conv-fps-val").textContent = fps;
  URL.revokeObjectURL(url);
}

async function loadAnimatedFrames(file) {
  const buffer = await file.arrayBuffer();

  if (typeof ImageDecoder !== "undefined") {
    try {
      const decoder = new ImageDecoder({ data: buffer, type: file.type });
      await decoder.completed;

      state.frames = [];
      const count = decoder.tracks.selectedTrack.frameCount;
      const frameLimit = Math.min(count, 600);
      for (let i = 0; i < frameLimit; i++) {
        const result = await decoder.decode({ frameIndex: i });
        const frame = result.image;
        const c = document.createElement("canvas");
        c.width = frame.displayWidth;
        c.height = frame.displayHeight;
        c.getContext("2d").drawImage(frame, 0, 0);
        frame.close();
        const img = new Image();
        img.src = c.toDataURL("image/png");
        await new Promise((resolve) => { img.onload = resolve; });
        state.frames.push(img);
        setLoadingProgress(Math.round(((i + 1) / frameLimit) * 100));
      }
      decoder.close();
      return;
    } catch {
      // fall through to fallback
    }
  }

  // Fallback: load as static image
  const img = new Image();
  img.src = URL.createObjectURL(file);
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
  });
  state.frames = [img];
}

function onFramesLoaded() {
  if (state.frames.length === 0) return;

  $("#conv-preview-scroll").classList.remove("empty");

  state.originalFrames = state.frames.map((img) => {
    const copy = new Image();
    copy.src = img.src;
    return copy;
  });

  const last = state.frames.length - 1;
  state.currentFrame = 0;
  $("#conv-frame-slider").max = last;
  $("#conv-frame-slider").value = 0;
  $("#conv-start-frame").value = 0;
  $("#conv-start-frame").max = last;
  $("#conv-end-frame").value = last;
  $("#conv-end-frame").max = last;

  $("#conv-btn-export").disabled = false;
  $("#conv-btn-estimate").disabled = false;
  $("#conv-btn-reset-effects").disabled = false;

  updatePreview();
}

// ── Frame navigation ────────────────────────────────────────────────────────

function seekFrame(idx) {
  if (state.frames.length === 0) return;
  state.currentFrame = Math.max(0, Math.min(idx, state.frames.length - 1));
  $("#conv-frame-slider").value = state.currentFrame;
  updatePreview();
}

function updatePreview() {
  if (state.frames.length === 0) {
    $("#conv-frame-info").textContent = "未加载文件";
    return;
  }

  const frame = state.frames[state.currentFrame];
  canvas.width = frame.width || frame.naturalWidth;
  canvas.height = frame.height || frame.naturalHeight;
  overlayCanvas.width = canvas.width;
  overlayCanvas.height = canvas.height;
  ctx.drawImage(frame, 0, 0);

  if (state.mosaicSelection) {
    drawMosaicSelection(state.mosaicSelection);
  }

  if ($("#conv-camera-enable").checked) {
    const battery = parseInt($("#conv-camera-battery").value) / 100;
    const fps = parseInt($("#conv-fps").value);
    const msPerFrame = fps > 0 ? 1000 / fps : 33;
    const timerText = addMsToTime(
      $("#conv-camera-timer").value || "00:00:00.000",
      state.currentFrame * msPerFrame
    );
    drawCameraOverlay(ctx, canvas.width, canvas.height, battery, timerText);
  }

  $("#conv-frame-info").textContent =
    `第 ${state.currentFrame + 1} 帧 / 共 ${state.frames.length} 帧`;
}

// ── Preset & options ────────────────────────────────────────────────────────

function applyPreset(key) {
  const p = GIF_PRESETS[key];
  if (!p) return;

  if (p.fps > 0) {
    $("#conv-fps").value = p.fps;
    $("#conv-fps-val").textContent = p.fps;
  }
  $("#conv-colors").value = p.colors;
  $("#conv-colors-val").textContent = p.colors;
  setSelectValue("#conv-scale", String(p.scale));
  setSelectValue("#conv-dither", p.dither);
  $("#conv-diff-palette").checked = p.diffPalette;
}

function onPresetChange() {
  const key = $("#conv-preset").value;
  if (key !== "custom") {
    applyPreset(key);
  }
}

function switchToCustomPreset() {
  if ($("#conv-preset").value !== "custom") {
    $("#conv-preset").value = "custom";
  }
}

function onFormatChange() {
  const fmt = $("#conv-format").value;
  const gifOnly = fmt === "gif";
  const ugoiraOnly = fmt === "ugoira";
  $("#conv-gif-options").style.display = gifOnly ? "" : "none";
  $("#conv-preset-section").style.display = gifOnly ? "" : "none";
  $("#conv-btn-estimate").style.display = (gifOnly || ugoiraOnly) ? "" : "none";
  $("#conv-ugoira-options").style.display = ugoiraOnly ? "" : "none";
}

function onUgoiraDelayChange() {
  const isCustom = $("#conv-ugoira-delay").value === "custom";
  $("#conv-ugoira-delay-custom").style.display = isCustom ? "" : "none";
  $("#conv-ugoira-delay-ms-label").style.display = isCustom ? "" : "none";
}

function onUgoiraScaleChange() {
  const isCustom = $("#conv-ugoira-scale").value === "custom";
  $("#conv-ugoira-scale-custom").style.display = isCustom ? "" : "none";
  $("#conv-ugoira-scale-pct-label").style.display = isCustom ? "" : "none";
}

function getUgoiraDelayMs() {
  const sel = $("#conv-ugoira-delay").value;
  if (sel === "custom") return Math.max(1, parseInt($("#conv-ugoira-delay-custom").value) || 50);
  return parseInt(sel);
}

function getUgoiraScalePct() {
  const sel = $("#conv-ugoira-scale").value;
  if (sel === "custom") {
    const v = parseInt($("#conv-ugoira-scale-custom").value) || 100;
    return Math.max(1, Math.min(100, v));
  }
  return parseInt(sel);
}

function setSelectValue(selector, value) {
  const el = $(selector);
  for (const opt of el.options) {
    if (opt.value === value) {
      el.value = value;
      return;
    }
  }
}

function getExportOptions() {
  const format = $("#conv-format").value;
  const fps = parseInt($("#conv-fps").value);

  const options = { format, fps };
  if (format === "gif") {
    options.gif = {
      colors: parseInt($("#conv-colors").value),
      dither: $("#conv-dither").value,
      scale: parseInt($("#conv-scale").value),
      diff_palette: $("#conv-diff-palette").checked,
    };
  } else if (format === "ugoira") {
    options.ugoira = {
      quality: parseInt($("#conv-ugoira-quality").value),
      delay_ms: getUgoiraDelayMs(),
      scale: getUgoiraScalePct(),
    };
  }
  return options;
}

// ── Export ───────────────────────────────────────────────────────────────────

async function exportAnimation() {
  if (state.frames.length === 0 || state.isExporting) return;

  const format = $("#conv-format").value;
  const start = parseInt($("#conv-start-frame").value) || 0;
  const end = parseInt($("#conv-end-frame").value) || state.frames.length - 1;
  const clampedStart = Math.max(0, Math.min(start, state.frames.length - 1));
  const clampedEnd = Math.max(clampedStart, Math.min(end, state.frames.length - 1));
  const exportFrames = state.frames.slice(clampedStart, clampedEnd + 1);

  if (exportFrames.length === 0) {
    setStatus("没有可导出的帧");
    return;
  }

  if (format === "ugoira" && exportFrames.length > 250) {
    const ok = confirm(`Ugoira 帧数 ${exportFrames.length} 超过 pixiv 上限 250 帧。仍要导出吗？（可上传别处，但 pixiv 会拒绝）`);
    if (!ok) return;
  }

  if (!invoke) {
    setStatus("导出需要 Tauri 运行时 (ffmpeg)");
    return;
  }

  let outputPath;
  try {
    const extByFormat = { gif: "gif", mp4: "mp4", webp: "webp", apng: "png", ugoira: "zip" };
    const defaultName = `output.${extByFormat[format] || format}`;
    outputPath = await invoke("pick_save_path", { defaultName, format });
    if (!outputPath) return;
  } catch (e) {
    setStatus(`对话框错误: ${e}`);
    return;
  }

  state.isExporting = true;
  showProgress(true);
  setProgress(0);
  setStatus("准备帧数据...");
  $("#conv-btn-export").disabled = true;

  try {
    const tempDir = await invoke("create_temp_dir");

    const fps = parseInt($("#conv-fps").value);
    const msPerFrame = fps > 0 ? 1000 / fps : 33;
    const applyCamera = $("#conv-camera-enable").checked;
    const battery = parseInt($("#conv-camera-battery").value) / 100;
    const timerStart = $("#conv-camera-timer").value || "00:00:00.000";
    const autoInc = $("#conv-camera-auto-inc").checked;
    const incMs = autoInc ? (parseInt($("#conv-camera-auto-inc-ms").value) || 100) : msPerFrame;

    for (let i = 0; i < exportFrames.length; i++) {
      const frame = exportFrames[i];
      const c = document.createElement("canvas");
      c.width = frame.width || frame.naturalWidth;
      c.height = frame.height || frame.naturalHeight;
      const fctx = c.getContext("2d");
      fctx.drawImage(frame, 0, 0);

      if (applyCamera) {
        const timerText = addMsToTime(timerStart, (clampedStart + i) * incMs);
        drawCameraOverlay(fctx, c.width, c.height, battery, timerText);
      }

      const dataUrl = c.toDataURL("image/png");
      const base64 = dataUrl.split(",")[1];
      await invoke("save_frame_data", { base64Data: base64, tempDir, index: i });
      setProgress(Math.round((i + 1) / exportFrames.length * 70));
      setStatus(`保存帧 ${i + 1} / ${exportFrames.length}...`);
    }

    setProgress(75);
    setStatus("编码中...");

    const options = getExportOptions();
    await invoke("export_animation", { framesDir: tempDir, outputPath, options });

    setProgress(100);
    setStatus(`已导出至 ${outputPath}`);

    await invoke("cleanup_temp_dir", { tempDir });
  } catch (e) {
    setStatus(`导出失败: ${e}`);
  } finally {
    state.isExporting = false;
    $("#conv-btn-export").disabled = state.frames.length === 0;
    setTimeout(() => showProgress(false), 2000);
  }
}

// ── Estimate ────────────────────────────────────────────────────────────────

async function estimateSize() {
  if (state.frames.length === 0 || !invoke) return;

  setStatus("正在估算文件大小...");
  $("#conv-btn-estimate").disabled = true;

  try {
    const tempDir = await invoke("create_temp_dir");
    const sampleCount = Math.min(state.frames.length, 30);

    for (let i = 0; i < sampleCount; i++) {
      const frame = state.frames[i];
      const c = document.createElement("canvas");
      c.width = frame.width || frame.naturalWidth;
      c.height = frame.height || frame.naturalHeight;
      c.getContext("2d").drawImage(frame, 0, 0);
      const dataUrl = c.toDataURL("image/png");
      const base64 = dataUrl.split(",")[1];
      await invoke("save_frame_data", { base64Data: base64, tempDir, index: i });
    }

    const options = getExportOptions();
    const estimated = await invoke("estimate_size", {
      framesDir: tempDir,
      totalFrames: state.frames.length,
      options,
    });

    const display = $("#conv-estimate-display");
    const text = $("#conv-estimate-text");
    display.style.display = "";
    const sizeMB = (estimated / (1024 * 1024)).toFixed(2);

    let ratio = "";
    if (state.sourceInfo && state.sourceInfo.file_size > 0) {
      ratio = ` (原文件的 ${((estimated / state.sourceInfo.file_size) * 100).toFixed(1)}%)`;
    }
    text.textContent = `预计输出: ~${sizeMB} MB${ratio}`;
    setStatus("估算完成");

    await invoke("cleanup_temp_dir", { tempDir });
  } catch (e) {
    setStatus(`估算失败: ${e}`);
  } finally {
    $("#conv-btn-estimate").disabled = state.frames.length === 0;
  }
}

// ── Mosaic selection ───────────────────────────────────────────────────────

function clearConvOverlay() {
  overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
}

function drawMosaicSelection(rect) {
  clearConvOverlay();
  if (!rect) return;
  overlayCtx.beginPath();
  overlayCtx.rect(rect.x, rect.y, rect.w, rect.h);
  overlayCtx.strokeStyle = "rgba(255, 0, 0, 0.8)";
  overlayCtx.lineWidth = 2;
  overlayCtx.stroke();
  overlayCtx.fillStyle = "rgba(255, 0, 0, 0.08)";
  overlayCtx.fill();
}

function convCanvasCoords(e) {
  const r = overlayCanvas.getBoundingClientRect();
  const sx = overlayCanvas.width / r.width;
  const sy = overlayCanvas.height / r.height;
  return {
    x: Math.max(0, Math.min(overlayCanvas.width, (e.clientX - r.left) * sx)),
    y: Math.max(0, Math.min(overlayCanvas.height, (e.clientY - r.top) * sy)),
  };
}

function onOverlayMouseDown(e) {
  if (!$("#conv-mosaic-enable").checked || state.frames.length === 0) return;
  state.isSelectingMosaic = true;
  state.mosaicStart = convCanvasCoords(e);
}

function onOverlayMouseMove(e) {
  if (!state.isSelectingMosaic) return;
  const cur = convCanvasCoords(e);
  const s = state.mosaicStart;
  state.mosaicSelection = {
    x: Math.min(s.x, cur.x),
    y: Math.min(s.y, cur.y),
    w: Math.abs(cur.x - s.x),
    h: Math.abs(cur.y - s.y),
  };
  drawMosaicSelection(state.mosaicSelection);
}

function onOverlayMouseUp() {
  if (!state.isSelectingMosaic) return;
  state.isSelectingMosaic = false;
  const hasSelection = state.mosaicSelection && state.mosaicSelection.w > 2 && state.mosaicSelection.h > 2;
  $("#conv-btn-mosaic-frame").disabled = !hasSelection;
  $("#conv-btn-mosaic-all").disabled = !hasSelection;
}

// ── Effect application ────────────────────────────────────────────────────

function applyMosaicToFrames(allFrames) {
  const sel = state.mosaicSelection;
  if (!sel || sel.w < 2 || sel.h < 2 || state.frames.length === 0) return;

  const blockSize = parseInt($("#conv-mosaic-size").value);
  const startIdx = allFrames ? 0 : state.currentFrame;
  const endIdx = allFrames ? state.frames.length : state.currentFrame + 1;
  const pending = [];

  for (let i = startIdx; i < endIdx; i++) {
    const frame = state.frames[i];
    const w = frame.width || frame.naturalWidth;
    const h = frame.height || frame.naturalHeight;
    const bounds = {
      x: Math.max(0, Math.floor(sel.x)),
      y: Math.max(0, Math.floor(sel.y)),
      w: Math.min(Math.ceil(sel.w), w - Math.floor(sel.x)),
      h: Math.min(Math.ceil(sel.h), h - Math.floor(sel.y)),
    };

    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const fctx = c.getContext("2d");
    fctx.drawImage(frame, 0, 0);

    const imageData = fctx.getImageData(0, 0, w, h);
    const mask = new Uint8ClampedArray(w * h * 4);
    for (let y = bounds.y; y < bounds.y + bounds.h && y < h; y++) {
      for (let x = bounds.x; x < bounds.x + bounds.w && x < w; x++) {
        mask[(y * w + x) * 4] = 255;
      }
    }
    mosaicPixels(imageData.data, w, h, mask, bounds, blockSize);
    fctx.putImageData(imageData, 0, 0);

    const img = new Image();
    img.src = c.toDataURL("image/png");
    state.frames[i] = img;
    pending.push(img.complete ? Promise.resolve() : new Promise((r) => { img.onload = r; }));
  }

  Promise.all(pending).then(() => {
    updatePreview();
    setStatus(allFrames ? `已对所有 ${endIdx} 帧应用马赛克` : `已对第 ${state.currentFrame + 1} 帧应用马赛克`);
  });
}

function applyCameraToFrames(allFrames) {
  if (state.frames.length === 0) return;

  const battery = parseInt($("#conv-camera-battery").value) / 100;
  const fps = parseInt($("#conv-fps").value);
  const msPerFrame = fps > 0 ? 1000 / fps : 33;
  const timerStart = $("#conv-camera-timer").value || "00:00:00.000";
  const startIdx = allFrames ? 0 : state.currentFrame;
  const endIdx = allFrames ? state.frames.length : state.currentFrame + 1;
  const pending = [];

  for (let i = startIdx; i < endIdx; i++) {
    const frame = state.frames[i];
    const w = frame.width || frame.naturalWidth;
    const h = frame.height || frame.naturalHeight;
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const fctx = c.getContext("2d");
    fctx.drawImage(frame, 0, 0);
    drawCameraOverlay(fctx, w, h, battery, addMsToTime(timerStart, i * msPerFrame));

    const img = new Image();
    img.src = c.toDataURL("image/png");
    state.frames[i] = img;
    pending.push(img.complete ? Promise.resolve() : new Promise((r) => { img.onload = r; }));
  }

  Promise.all(pending).then(() => {
    updatePreview();
    setStatus(allFrames ? `已对所有 ${endIdx} 帧应用相机效果` : `已对第 ${state.currentFrame + 1} 帧应用相机效果`);
  });
}

function resetEffects() {
  if (state.originalFrames.length === 0) return;
  const pending = [];

  state.frames = state.originalFrames.map((img) => {
    const copy = new Image();
    copy.src = img.src;
    pending.push(copy.complete ? Promise.resolve() : new Promise((r) => { copy.onload = r; }));
    return copy;
  });

  Promise.all(pending).then(() => {
    state.mosaicSelection = null;
    clearConvOverlay();
    updatePreview();
    setStatus("已重置所有效果");
  });
}

// ── File info display ─────────────────────────────────────────────────────

function displayFileInfo(info, fileName) {
  const section = $("#conv-file-info");
  const grid = $("#conv-info-grid");
  section.style.display = "";

  const durationSec = (info.duration_ms / 1000).toFixed(1);
  const sizeMB = (info.file_size / (1024 * 1024)).toFixed(2);

  grid.innerHTML =
    `<span class="info-label">文件名:</span><span class="info-value">${fileName}</span>` +
    `<span class="info-label">分辨率:</span><span class="info-value">${info.width} × ${info.height}</span>` +
    `<span class="info-label">帧率:</span><span class="info-value">${info.fps.toFixed(1)} fps</span>` +
    `<span class="info-label">时长:</span><span class="info-value">${durationSec} 秒</span>` +
    `<span class="info-label">文件大小:</span><span class="info-value">${sizeMB} MB</span>`;
}

// ── UI helpers ──────────────────────────────────────────────────────────────

function setStatus(msg) {
  $("#conv-status").textContent = msg;
}

function setProgress(pct) {
  $("#conv-progress-fill").style.width = `${pct}%`;
  $("#conv-progress-text").textContent = `${pct}%`;
}

function showProgress(show) {
  $("#conv-progress-section").style.display = show ? "" : "none";
}

function showLoading(show) {
  $("#conv-loading-section").style.display = show ? "" : "none";
}

function setLoadingProgress(pct) {
  $("#conv-loading-fill").style.width = `${pct}%`;
  $("#conv-loading-text").textContent = `${pct}%`;
}
