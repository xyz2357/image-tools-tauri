use base64::Engine;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

// ── Data types ──────────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct VideoInfo {
    pub duration_ms: u64,
    pub fps: f64,
    pub width: u32,
    pub height: u32,
    pub file_size: u64,
}

#[derive(Deserialize)]
pub struct GifOptions {
    pub colors: u32,
    pub dither: String,
    pub scale: u32,
    pub diff_palette: bool,
}

#[derive(Deserialize)]
pub struct UgoiraOptions {
    pub quality: u8,
    pub delay_ms: u32,
    #[serde(default = "default_scale")]
    pub scale: u32,
}

fn default_scale() -> u32 { 100 }

#[derive(Deserialize)]
pub struct ExportOptions {
    pub format: String,
    pub fps: f64,
    pub gif: Option<GifOptions>,
    pub ugoira: Option<UgoiraOptions>,
}

// ── Helper: find ffmpeg/ffprobe ─────────────────────────────────────────────

fn find_ffmpeg() -> Result<PathBuf, String> {
    let name = if cfg!(target_os = "windows") { "ffmpeg.exe" } else { "ffmpeg" };
    which_executable(name)
}

fn find_ffprobe() -> Result<PathBuf, String> {
    let name = if cfg!(target_os = "windows") { "ffprobe.exe" } else { "ffprobe" };
    which_executable(name)
}

fn which_executable(name: &str) -> Result<PathBuf, String> {
    let output = if cfg!(target_os = "windows") {
        Command::new("where").arg(name).output()
    } else {
        Command::new("which").arg(name).output()
    };
    match output {
        Ok(o) if o.status.success() => {
            let s = String::from_utf8_lossy(&o.stdout);
            let first_line = s.lines().next().unwrap_or("").trim();
            if first_line.is_empty() {
                Err(format!("{} not found in PATH", name))
            } else {
                Ok(PathBuf::from(first_line))
            }
        }
        _ => Err(format!("{} not found in PATH", name)),
    }
}

// ── Commands ────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn check_ffmpeg() -> Result<String, String> {
    let ffmpeg = find_ffmpeg()?;
    let output = Command::new(&ffmpeg)
        .arg("-version")
        .output()
        .map_err(|e| format!("Failed to run ffmpeg: {}", e))?;
    let version = String::from_utf8_lossy(&output.stdout);
    let first_line = version.lines().next().unwrap_or("unknown").to_string();
    Ok(first_line)
}

#[tauri::command]
pub fn get_video_info(path: String) -> Result<VideoInfo, String> {
    let ffprobe = find_ffprobe()?;
    let output = Command::new(&ffprobe)
        .args([
            "-v", "quiet",
            "-print_format", "json",
            "-show_format",
            "-show_streams",
            &path,
        ])
        .output()
        .map_err(|e| format!("ffprobe failed: {}", e))?;

    if !output.status.success() {
        return Err(format!("ffprobe error: {}", String::from_utf8_lossy(&output.stderr)));
    }

    let json: serde_json::Value = serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("Failed to parse ffprobe output: {}", e))?;

    let video_stream = json["streams"]
        .as_array()
        .and_then(|streams| streams.iter().find(|s| s["codec_type"] == "video"))
        .ok_or("No video stream found")?;

    let width = video_stream["width"].as_u64().unwrap_or(0) as u32;
    let height = video_stream["height"].as_u64().unwrap_or(0) as u32;

    let fps = parse_fps(video_stream["r_frame_rate"].as_str().unwrap_or("30/1"));

    let duration_ms = json["format"]["duration"]
        .as_str()
        .and_then(|d| d.parse::<f64>().ok())
        .map(|d| (d * 1000.0) as u64)
        .unwrap_or(0);

    // Always trust filesystem metadata. ffprobe's format.size can disagree
    // with the on-disk size for certain MP4 containers (e.g., when moov
    // atoms or trailing metadata are computed differently).
    let file_size = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);

    Ok(VideoInfo { duration_ms, fps, width, height, file_size })
}

fn parse_fps(rate: &str) -> f64 {
    if let Some((num, den)) = rate.split_once('/') {
        let n: f64 = num.parse().unwrap_or(30.0);
        let d: f64 = den.parse().unwrap_or(1.0);
        if d > 0.0 { n / d } else { 30.0 }
    } else {
        rate.parse().unwrap_or(30.0)
    }
}

#[tauri::command]
pub fn create_temp_dir() -> Result<String, String> {
    let dir = std::env::temp_dir().join(format!("image_tools_{}", std::process::id()));
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create temp dir: {}", e))?;
    Ok(dir.to_string_lossy().to_string())
}

#[tauri::command]
pub fn save_frame_data(base64_data: String, temp_dir: String, index: u32) -> Result<String, String> {
    let data = base64::engine::general_purpose::STANDARD
        .decode(&base64_data)
        .map_err(|e| format!("Base64 decode error: {}", e))?;
    let path = Path::new(&temp_dir).join(format!("frame_{:05}.png", index));
    fs::write(&path, &data).map_err(|e| format!("Failed to write frame: {}", e))?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn export_animation(
    app: tauri::AppHandle,
    frames_dir: String,
    output_path: String,
    options: ExportOptions,
) -> Result<(), String> {
    if options.format == "ugoira" {
        let ug = options.ugoira.ok_or("ugoira options missing")?;
        return export_ugoira(&app, &frames_dir, &output_path, &ug);
    }

    let ffmpeg = find_ffmpeg()?;
    let input_pattern = Path::new(&frames_dir).join("frame_%05d.png");

    let mut cmd = Command::new(&ffmpeg);
    cmd.arg("-y");
    cmd.args(["-framerate", &format!("{}", options.fps)]);
    cmd.args(["-i", &input_pattern.to_string_lossy()]);

    match options.format.as_str() {
        "gif" => {
            let gif = options.gif.unwrap_or(GifOptions {
                colors: 256,
                dither: "sierra2_4a".to_string(),
                scale: 100,
                diff_palette: false,
            });
            build_gif_cmd(&mut cmd, &gif, options.fps);
        }
        "mp4" => {
            cmd.args(["-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart"]);
        }
        "webp" => {
            cmd.args(["-c:v", "libwebp_anim", "-loop", "0", "-quality", "80"]);
        }
        "apng" => {
            cmd.args(["-f", "apng", "-plays", "0"]);
        }
        _ => return Err(format!("Unsupported format: {}", options.format)),
    }

    cmd.arg(&output_path);

    let output = cmd.output().map_err(|e| format!("ffmpeg failed: {}", e))?;
    if !output.status.success() {
        return Err(format!("ffmpeg error: {}", String::from_utf8_lossy(&output.stderr)));
    }
    Ok(())
}

fn export_ugoira(app: &tauri::AppHandle, frames_dir: &str, output_path: &str, opts: &UgoiraOptions) -> Result<(), String> {
    use tauri::Emitter;
    // output_path is the destination *folder*. Create it; existing contents
    // for the same frame indices will be overwritten by fs::write below.
    fs::create_dir_all(output_path)
        .map_err(|e| format!("Failed to create output folder: {}", e))?;
    let quality = opts.quality.clamp(1, 100);
    let delay = opts.delay_ms.max(1);

    let mut entries: Vec<PathBuf> = fs::read_dir(frames_dir)
        .map_err(|e| format!("Failed to read frames dir: {}", e))?
        .filter_map(|e| {
            let e = e.ok()?;
            let name = e.file_name().to_string_lossy().to_string();
            if name.starts_with("frame_") && name.ends_with(".png") {
                Some(e.path())
            } else {
                None
            }
        })
        .collect();
    entries.sort();

    if entries.is_empty() {
        return Err("No frames found".to_string());
    }

    let scale_pct = opts.scale.clamp(1, 100);
    let total = entries.len();
    let mut frames_meta = Vec::with_capacity(total);
    for (i, path) in entries.iter().enumerate() {
        let _ = app.emit("ugoira-progress", serde_json::json!({ "done": i, "total": total }));
        let img = image::open(path).map_err(|e| format!("Failed to decode {:?}: {}", path, e))?;
        let img = if scale_pct < 100 {
            let (w, h) = (img.width(), img.height());
            let nw = ((w as u64 * scale_pct as u64) / 100).max(1) as u32;
            let nh = ((h as u64 * scale_pct as u64) / 100).max(1) as u32;
            img.resize_exact(nw, nh, image::imageops::FilterType::Lanczos3)
        } else {
            img
        };
        let rgb = img.to_rgb8();
        let mut jpg_bytes: Vec<u8> = Vec::new();
        let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpg_bytes, quality);
        encoder
            .encode(&rgb, rgb.width(), rgb.height(), image::ExtendedColorType::Rgb8)
            .map_err(|e| format!("JPEG encode failed: {}", e))?;

        let entry_name = format!("{:06}.jpg", i);
        let dest = Path::new(output_path).join(&entry_name);
        fs::write(&dest, &jpg_bytes)
            .map_err(|e| format!("Failed to write {}: {}", entry_name, e))?;
        frames_meta.push(serde_json::json!({ "file": entry_name, "delay": delay }));
    }

    let manifest = serde_json::json!({
        "ugoira_version": "0.0.1",
        "mime_type": "image/jpeg",
        "frames": frames_meta,
    });
    let manifest_path = Path::new(output_path).join("animation.json");
    fs::write(&manifest_path, manifest.to_string().as_bytes())
        .map_err(|e| format!("Failed to write animation.json: {}", e))?;
    Ok(())
}

fn build_gif_cmd(cmd: &mut Command, gif: &GifOptions, fps: f64) {
    // Pre-split filters are in one chain, joined by ","
    let mut pre_split = Vec::new();

    if fps > 0.0 {
        pre_split.push(format!("fps={}", fps));
    }

    if gif.scale < 100 {
        let s = gif.scale as f64 / 100.0;
        pre_split.push(format!("scale=iw*{:.2}:ih*{:.2}:flags=lanczos", s, s));
    }

    pre_split.push("split[s0][s1]".to_string());

    let mut palette_opts = format!("max_colors={}", gif.colors);
    if gif.diff_palette {
        palette_opts.push_str(":stats_mode=diff");
    }

    let mut use_opts = String::new();
    if gif.dither != "none" {
        use_opts.push_str(&format!("dither={}", gif.dither));
        if gif.dither == "bayer" {
            use_opts.push_str(":bayer_scale=5");
        }
    } else {
        use_opts.push_str("dither=none");
    }

    // "fps=N,scale=...,split[s0][s1];[s0]palettegen=...[p];[s1][p]paletteuse=..."
    let filter_complex = format!(
        "{};[s0]palettegen={}[p];[s1][p]paletteuse={}",
        pre_split.join(","),
        palette_opts,
        use_opts
    );
    cmd.args(["-filter_complex", &filter_complex]);
}

#[tauri::command]
pub fn estimate_size(
    app: tauri::AppHandle,
    frames_dir: String,
    total_frames: u32,
    options: ExportOptions,
) -> Result<u64, String> {
    let sample_count = std::cmp::min(total_frames, 30);
    if sample_count == 0 {
        return Ok(0);
    }

    let sample_ext = match options.format.as_str() {
        "ugoira" => "zip",
        other => other,
    };
    let temp_output = Path::new(&frames_dir).join(format!("_estimate_sample.{}", sample_ext));

    let sample_dir = Path::new(&frames_dir).join("_sample");
    fs::create_dir_all(&sample_dir).map_err(|e| format!("Failed to create sample dir: {}", e))?;

    for i in 0..sample_count {
        let src = Path::new(&frames_dir).join(format!("frame_{:05}.png", i));
        let dst = sample_dir.join(format!("frame_{:05}.png", i));
        if src.exists() {
            fs::copy(&src, &dst).ok();
        }
    }

    let sample_options = ExportOptions {
        format: options.format,
        fps: options.fps,
        gif: options.gif,
        ugoira: options.ugoira,
    };

    let result = export_animation(
        app,
        sample_dir.to_string_lossy().to_string(),
        temp_output.to_string_lossy().to_string(),
        sample_options,
    );

    let estimated = if result.is_ok() && temp_output.exists() {
        let sample_size = fs::metadata(&temp_output).map(|m| m.len()).unwrap_or(0);
        if sample_count < total_frames {
            (sample_size as f64 * total_frames as f64 / sample_count as f64) as u64
        } else {
            sample_size
        }
    } else {
        0
    };

    fs::remove_dir_all(&sample_dir).ok();
    fs::remove_file(&temp_output).ok();

    Ok(estimated)
}

#[tauri::command]
pub fn extract_frames(path: String, fps: f64, temp_dir: String) -> Result<Vec<String>, String> {
    let ffmpeg = find_ffmpeg()?;
    let output_pattern = Path::new(&temp_dir).join("frame_%05d.png");

    let mut cmd = Command::new(&ffmpeg);
    cmd.arg("-y")
       .args(["-i", &path]);

    if fps > 0.0 {
        cmd.args(["-vf", &format!("fps={}", fps)]);
    }

    cmd.arg(output_pattern.to_string_lossy().as_ref());

    let output = cmd.output().map_err(|e| format!("ffmpeg frame extraction failed: {}", e))?;
    if !output.status.success() {
        return Err(format!("ffmpeg error: {}", String::from_utf8_lossy(&output.stderr)));
    }

    let mut frames: Vec<String> = fs::read_dir(&temp_dir)
        .map_err(|e| format!("Failed to read temp dir: {}", e))?
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with("frame_") && name.ends_with(".png") {
                Some(entry.path().to_string_lossy().to_string())
            } else {
                None
            }
        })
        .collect();
    frames.sort();
    Ok(frames)
}

#[tauri::command]
pub fn read_frame_base64(path: String) -> Result<String, String> {
    let data = fs::read(&path).map_err(|e| format!("Failed to read frame: {}", e))?;
    Ok(base64::engine::general_purpose::STANDARD.encode(&data))
}

#[tauri::command]
pub fn cleanup_temp_dir(temp_dir: String) -> Result<(), String> {
    if Path::new(&temp_dir).exists() {
        fs::remove_dir_all(&temp_dir).map_err(|e| format!("Cleanup failed: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn save_image(
    app: tauri::AppHandle,
    base64_data: String,
    source_name: String,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let default_name = if source_name.is_empty() {
        "image_tools_output.jpg".to_string()
    } else {
        let stem = Path::new(&source_name)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("output");
        format!("{}.jpg", stem)
    };

    let mut dialog = app
        .dialog()
        .file()
        .set_file_name(&default_name)
        .add_filter("JPEG", &["jpg", "jpeg"])
        .add_filter("PNG", &["png"]);

    if !source_name.is_empty() {
        let source_path = Path::new(&source_name);
        if let Some(parent) = source_path.parent() {
            if parent.is_dir() {
                dialog = dialog.set_directory(parent);
            }
        }
    }

    let result = dialog.blocking_save_file();

    let path = match result {
        Some(p) => p.to_string(),
        None => return Ok(None),
    };

    let png_data = base64::engine::general_purpose::STANDARD
        .decode(&base64_data)
        .map_err(|e| format!("Base64 decode error: {}", e))?;

    let ext = Path::new(&path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("jpg")
        .to_lowercase();

    if ext == "png" {
        fs::write(&path, &png_data).map_err(|e| format!("Failed to write file: {}", e))?;
    } else {
        let img = image::load_from_memory(&png_data)
            .map_err(|e| format!("Failed to decode image: {}", e))?;
        let mut file = fs::File::create(&path)
            .map_err(|e| format!("Failed to create file: {}", e))?;
        img.write_to(&mut file, image::ImageFormat::Jpeg)
            .map_err(|e| format!("Failed to write JPEG: {}", e))?;
    }

    Ok(Some(path))
}

#[tauri::command]
pub async fn pick_save_path(
    app: tauri::AppHandle,
    default_name: String,
    format: String,
    default_dir: Option<String>,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let ext = match format.as_str() {
        "gif" => "gif",
        "mp4" => "mp4",
        "webp" => "webp",
        "apng" => "png",
        _ => "gif",
    };

    let mut dialog = app
        .dialog()
        .file()
        .set_file_name(&default_name)
        .add_filter(&format.to_uppercase(), &[ext]);
    if let Some(d) = default_dir.as_deref() {
        let p = Path::new(d);
        if p.is_dir() {
            dialog = dialog.set_directory(p);
        }
    }
    let result = dialog.blocking_save_file();

    match result {
        Some(path) => Ok(Some(path.to_string())),
        None => Ok(None),
    }
}

#[tauri::command]
pub async fn pick_save_folder(
    app: tauri::AppHandle,
    default_dir: Option<String>,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let mut dialog = app.dialog().file();
    if let Some(d) = default_dir.as_deref() {
        let p = Path::new(d);
        if p.is_dir() {
            dialog = dialog.set_directory(p);
        }
    }
    let result = dialog.blocking_pick_folder();
    match result {
        Some(path) => Ok(Some(path.to_string())),
        None => Ok(None),
    }
}

#[tauri::command]
pub async fn pick_open_file(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let result = app
        .dialog()
        .file()
        .add_filter("Video/Animation", &["mp4", "webm", "avi", "mov", "mkv", "gif", "webp", "png", "apng"])
        .blocking_pick_file();

    match result {
        Some(path) => Ok(Some(path.to_string())),
        None => Ok(None),
    }
}
