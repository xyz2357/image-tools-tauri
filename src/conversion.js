import { drawCameraOverlay, addMsToTime, GIF_PRESETS, mosaicPixels } from "./effects.js";

const $ = (s) => document.querySelector(s);
const invoke = globalThis.__TAURI__?.core?.invoke;

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
  playTimer: null,
  history: [],
};

const HISTORY_LIMIT = 30;

// Stores references to the *previous* Image objects for a frame range.
// Cheap because state.frames slots are replaced (not mutated) by the
// effect appliers, so the old refs remain valid until evicted here.
function pushHistory(start, end) {
  const oldFrames = [];
  for (let i = start; i < end; i++) oldFrames.push(state.frames[i]);
  state.history.push({ start, oldFrames });
  if (state.history.length > HISTORY_LIMIT) state.history.shift();
  refreshUndoButton();
}

function undo() {
  const entry = state.history.pop();
  if (!entry) return;
  for (let i = 0; i < entry.oldFrames.length; i++) {
    state.frames[entry.start + i] = entry.oldFrames[i];
  }
  refreshUndoButton();
  updatePreview();
  setStatus("已撤销");
}

function clearHistory() {
  state.history = [];
  refreshUndoButton();
}

function refreshUndoButton() {
  // The undo button now lives in the shared top toolbar (#btn-undo) and
  // applies to whichever tab is active. main.js handles its disabled state.
}

function refreshMosaicButtons() {
  // Enabled when the user has actually drawn a selection on the preview.
  const enabled = state.mosaicSelection != null;
  const f = $("#conv-btn-mosaic-frame");
  const a = $("#conv-btn-mosaic-all");
  if (f) f.disabled = !enabled;
  if (a) a.disabled = !enabled;
}

// ── DOM refs ────────────────────────────────────────────────────────────────

let canvas, ctx, overlayCanvas, overlayCtx;

// ── Init ────────────────────────────────────────────────────────────────────

export function initConversion() {
  canvas = $("#conv-canvas");
  ctx = canvas.getContext("2d");
  overlayCanvas = $("#conv-overlay-canvas");
  overlayCtx = overlayCanvas.getContext("2d");

  // #conv-btn-open + #conv-btn-undo + #conv-btn-reset-effects no longer
  // exist — main.js's toolbar dispatches to openFile / undo / resetEffects
  // via the API returned from initConversion().
  $("#conv-btn-export").addEventListener("click", exportAnimation);
  $("#conv-btn-estimate").addEventListener("click", estimateSize);
  $("#conv-btn-prev").addEventListener("click", () => seekFrame(state.currentFrame - 1));
  $("#conv-btn-next").addEventListener("click", () => seekFrame(state.currentFrame + 1));
  $("#conv-btn-play").addEventListener("click", togglePlay);
  $("#conv-frame-slider").addEventListener("input", (e) => seekFrame(parseInt(e.target.value)));

  $("#conv-format").addEventListener("change", onFormatChange);
  $("#conv-preset").addEventListener("change", onPresetChange);
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

  // Mosaic controls (selection always active when on the mosaic pane)
  $("#conv-mosaic-size").addEventListener("input", (e) => {
    $("#conv-mosaic-size-val").textContent = e.target.value;
  });
  $("#conv-btn-mosaic-frame").addEventListener("click", () => applyMosaicToFrames(false));
  $("#conv-btn-mosaic-all").addEventListener("click", () => applyMosaicToFrames(true));

  // Camera apply buttons
  $("#conv-btn-camera-frame").addEventListener("click", () => applyCameraToFrames(false));
  $("#conv-btn-camera-all").addEventListener("click", () => applyCameraToFrames(true));

  // Pill bar (right panel tool switching)
  const pillBar = $("#conv-pill-bar");
  pillBar.addEventListener("click", (e) => {
    const btn = e.target.closest(".pill-btn");
    if (!btn || btn.disabled) return;
    pillBar.querySelectorAll(".pill-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const tool = btn.dataset.convTool;
    document.querySelectorAll(".conv-tool-content").forEach((el) => {
      el.classList.toggle("active", el.id === `conv-tool-${tool}`);
    });
    // Re-render so camera live-preview appears/disappears when the
    // camera pane is opened/closed, and the mosaic selection clears.
    if (tool !== "mosaic") clearConvOverlay();
    updatePreview();
  });

  // Overlay canvas mouse events for mosaic selection
  overlayCanvas.addEventListener("mousedown", onOverlayMouseDown);
  document.addEventListener("mousemove", onOverlayMouseMove);
  document.addEventListener("mouseup", onOverlayMouseUp);

  // Drag & drop (works once dragDropEnabled=false in tauri.conf.json)
  const scroll = $("#conv-preview-scroll");
  scroll.addEventListener("dragover", (e) => { e.preventDefault(); scroll.classList.add("drag-over"); });
  scroll.addEventListener("dragleave", () => scroll.classList.remove("drag-over"));
  scroll.addEventListener("drop", (e) => {
    e.preventDefault();
    scroll.classList.remove("drag-over");
    const file = e.dataTransfer.files[0];
    if (file) loadFromFile(file);
  });

  // Click empty preview area to open file
  scroll.addEventListener("click", (e) => {
    if (state.frames.length === 0 && e.target === scroll) openFile();
  });

  // Space to toggle play when conversion tab is active
  document.addEventListener("keydown", (e) => {
    const convTabActive = $("#tab-conversion").classList.contains("active");
    if (!convTabActive) return;
    const tag = (e.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return;
    if (e.code === "Space" && state.frames.length > 0) {
      e.preventDefault();
      togglePlay();
    } else if (e.ctrlKey && (e.key === "z" || e.key === "Z") && !e.shiftKey) {
      e.preventDefault();
      undo();
    }
  });

  applyPreset("extreme");
  onFormatChange();

  // API exposed to main.js's shared top toolbar dispatcher.
  return {
    openFile,
    undo,
    resetEffects,
    hasFrames: () => state.frames.length > 0,
    historyDepth: () => state.history.length,
  };
}

function togglePlay() {
  if (state.frames.length === 0) return;
  if (state.playTimer) {
    clearInterval(state.playTimer);
    state.playTimer = null;
    $("#conv-btn-play").textContent = "▶";
    return;
  }
  const fps = parseInt($("#conv-fps").value) || 15;
  const interval = Math.max(16, Math.round(1000 / fps));
  $("#conv-btn-play").textContent = "❚❚";
  state.playTimer = setInterval(() => {
    const loop = $("#conv-loop").checked;
    const at_end = state.currentFrame >= state.frames.length - 1;
    if (at_end && !loop) {
      stopPlay();
      return;
    }
    const next = at_end ? 0 : state.currentFrame + 1;
    seekFrame(next);
  }, interval);
}

function stopPlay() {
  if (state.playTimer) {
    clearInterval(state.playTimer);
    state.playTimer = null;
    $("#conv-btn-play").textContent = "▶";
  }
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
  stopPlay();
  clearHistory();
  // Show loading overlay immediately so the user sees something even
  // during the (often slow) ffprobe + ffmpeg phase. Progress sits at
  // 5% during metadata probe, 20% while ffmpeg extracts frames, then
  // ramps 20→100% as PNGs are loaded into Image elements.
  showLoading(true);
  setLoadingProgress(5);
  try {
    const info = await invoke("get_video_info", { path });
    state.sourceInfo = info;
    state.sourceFps = info.fps;
    displayFileInfo(info, path.split(/[/\\]/).pop());

    const tempDir = await invoke("create_temp_dir");
    state.tempDir = tempDir;

    setLoadingProgress(20);
    const fps = Math.min(info.fps, 30);
    const framePaths = await invoke("extract_frames", { path, fps, tempDir });

    state.frames = [];
    for (let i = 0; i < framePaths.length; i++) {
      const img = await loadImageFromPath(framePaths[i]);
      state.frames.push(img);
      setLoadingProgress(20 + Math.round(((i + 1) / framePaths.length) * 80));
    }
    showLoading(false);

    state.fps = fps;
    $("#conv-fps").value = fps;
    $("#conv-fps-val").textContent = fps;

    onFramesLoaded();
    const baseName = path.split(/[/\\]/).pop();
    setStatus(`已加载 ${state.frames.length} 帧，来自 ${baseName}`);
    const el = document.getElementById("top-filename");
    if (el) el.textContent = baseName;
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
  stopPlay();
  clearHistory();
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
    const elT = document.getElementById("top-filename");
    if (elT) elT.textContent = file.name;
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

  const HARD_LIMIT = 3000;
  const frameLimit = Math.min(totalFrames, HARD_LIMIT);
  if (totalFrames > HARD_LIMIT) {
    setStatus(`视频共 ${totalFrames} 帧，仅加载前 ${HARD_LIMIT} 帧（内存限制）。完整加载请用更短的视频或更低 fps。`);
  }
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
  // (#conv-btn-reset-effects removed — reset is now the shared toolbar button)

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

  // Live-preview the camera overlay whenever the camera pane is open
  // so the user can see what they're configuring before clicking apply.
  if (document.getElementById("conv-tool-camera")?.classList.contains("active")) {
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

// Splits a path-or-filename into { stem, parentDir }. parentDir is null
// for bare filenames (drag&drop case where we don't know the absolute dir).
export function parseSourcePath(srcPath) {
  if (!srcPath) return { stem: "", parentDir: null };
  const normalized = srcPath.replace(/\\/g, "/");
  const lastSlash = normalized.lastIndexOf("/");
  const base = lastSlash >= 0 ? normalized.slice(lastSlash + 1) : normalized;
  const parentDir = lastSlash > 0 ? srcPath.slice(0, lastSlash) : null;
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  return { stem, parentDir };
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

  if (format === "ugoira" && exportFrames.length >= 500) {
    const ok = confirm(`Ugoira 帧数 ${exportFrames.length} 达到/超过 pixiv 上限 (< 500 帧)。仍要导出吗？（pixiv 会拒绝；其他用途可继续）`);
    if (!ok) return;
  }

  if (!invoke) {
    setStatus("导出需要 Tauri 运行时 (ffmpeg)");
    return;
  }

  const { stem, parentDir } = parseSourcePath(state.sourcePath);

  let outputPath;
  try {
    if (format === "ugoira") {
      const picked = await invoke("pick_save_folder", { defaultDir: parentDir });
      if (!picked) return;
      outputPath = `${picked.replace(/[\\/]+$/, "")}/${stem || "ugoira"}`;
    } else {
      const extByFormat = { gif: "gif", mp4: "mp4", webp: "webp", apng: "png" };
      const ext = extByFormat[format] || format;
      const defaultName = `${stem || "output"}.${ext}`;
      outputPath = await invoke("pick_save_path", { defaultName, format, defaultDir: parentDir });
      if (!outputPath) return;
    }
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
    // The live-preview camera overlay is no longer auto-baked into the
    // export — users now bake it explicitly via the "应用本帧 / 应用全部"
    // buttons on the camera pane. This avoids double-rendering for frames
    // that were already baked.
    const applyCamera = false;
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

    let unlistenProgress = null;
    if (format === "ugoira" && globalThis.__TAURI__?.event?.listen) {
      unlistenProgress = await globalThis.__TAURI__.event.listen("ugoira-progress", (ev) => {
        const { done, total } = ev.payload || {};
        if (total > 0) {
          const pct = 75 + Math.round((done / total) * 25);
          setProgress(Math.min(99, pct));
          setStatus(`编码中... ${done}/${total} 帧`);
        }
      });
    }
    try {
      await invoke("export_animation", { framesDir: tempDir, outputPath, options });
    } finally {
      if (unlistenProgress) unlistenProgress();
    }

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
  // Only react to drag-to-select when the mosaic pane is the active tool.
  const onMosaicPane = document.getElementById("conv-tool-mosaic")?.classList.contains("active");
  if (!onMosaicPane || state.frames.length === 0) return;
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
  refreshMosaicButtons();
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
  pushHistory(startIdx, endIdx);
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
  pushHistory(startIdx, endIdx);
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
  pushHistory(0, state.frames.length);
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
    refreshMosaicButtons();
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
  const overlay = $("#conv-loading-overlay");
  if (show) {
    // Wipe previous frame from canvas so the in-progress reload doesn't
    // sit on top of the old content peeking through under the overlay.
    if (canvas && ctx) {
      canvas.width = canvas.width; // hack to clear + reset
    }
    if (overlayCanvas && overlayCtx) {
      overlayCanvas.width = overlayCanvas.width;
    }
    setLoadingProgress(0);
    overlay.style.display = "";
    // Hide the "click to open" hint while loading.
    $("#conv-preview-scroll").classList.remove("empty");
  } else {
    overlay.style.display = "none";
    // Re-apply empty hint if nothing loaded successfully.
    if (state.frames.length === 0) $("#conv-preview-scroll").classList.add("empty");
  }
}

function setLoadingProgress(pct) {
  $("#conv-loading-fill").style.width = `${pct}%`;
  $("#conv-loading-text").textContent = `${pct}%`;
}
