mod conversion;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    conversion::cleanup_orphan_temp_dirs();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            conversion::check_ffmpeg,
            conversion::get_video_info,
            conversion::create_temp_dir,
            conversion::save_frame_data,
            conversion::export_animation,
            conversion::estimate_size,
            conversion::extract_frames,
            conversion::read_frame_base64,
            conversion::cleanup_temp_dir,
            conversion::save_image,
            conversion::pick_save_path,
            conversion::pick_save_folder,
            conversion::pick_open_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
