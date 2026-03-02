use image::codecs::jpeg::JpegEncoder;
use image::ImageReader;
use oxipng::{optimize_from_memory, Options};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use uuid::Uuid;

#[derive(Serialize)]
struct CompressResult {
    original_size: u64,
    compressed_size: u64,
    temp_path: String,
    savings_percent: f64,
}

#[derive(Deserialize)]
struct SaveItem {
    temp_path: String,
    name: String,
    format: String,
}

fn get_cache_dir() -> PathBuf {
    let tmp = std::env::temp_dir();
    let cache = tmp.join("img-compressor-cache");
    fs::create_dir_all(&cache).unwrap_or_default();
    cache
}

fn compress_jpeg(input_path: &Path, quality: u8) -> Result<Vec<u8>, String> {
    let img = ImageReader::open(input_path)
        .map_err(|e| format!("Failed to open image: {e}"))?
        .decode()
        .map_err(|e| format!("Failed to decode image: {e}"))?;

    let mut buf = Vec::new();
    let mut encoder = JpegEncoder::new_with_quality(Cursor::new(&mut buf), quality);
    encoder
        .encode_image(&img)
        .map_err(|e| format!("Failed to encode JPEG: {e}"))?;
    Ok(buf)
}

fn compress_png(input_path: &Path) -> Result<Vec<u8>, String> {
    let data = fs::read(input_path).map_err(|e| format!("Failed to read file: {e}"))?;
    let opts = Options::from_preset(3);
    optimize_from_memory(&data, &opts).map_err(|e| format!("PNG optimization failed: {e}"))
}

#[tauri::command]
fn get_file_size(path: String) -> Result<u64, String> {
    fs::metadata(&path)
        .map(|m| m.len())
        .map_err(|e| format!("Cannot stat file: {e}"))
}

#[tauri::command]
fn compress_image(input_path: String, quality: u8) -> Result<CompressResult, String> {
    let path = Path::new(&input_path);
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();

    let original_size = fs::metadata(path)
        .map(|m| m.len())
        .map_err(|e| format!("Cannot stat file: {e}"))?;

    let compressed_data = match ext.as_str() {
        "jpg" | "jpeg" => compress_jpeg(path, quality)?,
        "png" => compress_png(path)?,
        other => return Err(format!("Unsupported format: {other}")),
    };

    let compressed_size = compressed_data.len() as u64;

    let cache_dir = get_cache_dir();
    let unique_name = format!("{}.{}", Uuid::new_v4(), ext);
    let temp_path = cache_dir.join(&unique_name);
    fs::write(&temp_path, &compressed_data)
        .map_err(|e| format!("Failed to write temp file: {e}"))?;

    let savings_percent = if original_size > 0 {
        let saved = original_size.saturating_sub(compressed_size);
        (saved as f64 / original_size as f64) * 100.0
    } else {
        0.0
    };

    Ok(CompressResult {
        original_size,
        compressed_size,
        temp_path: temp_path.to_string_lossy().into_owned(),
        savings_percent,
    })
}

#[tauri::command]
fn save_image(temp_path: String, output_path: String) -> Result<(), String> {
    fs::copy(&temp_path, &output_path)
        .map(|_| ())
        .map_err(|e| format!("Failed to save file: {e}"))
}

#[tauri::command]
fn save_all_images(items: Vec<SaveItem>, output_dir: String) -> Result<(), String> {
    let dir = Path::new(&output_dir);
    for item in &items {
        let ext = if item.format.to_uppercase() == "JPEG" {
            "jpg"
        } else {
            "png"
        };
        let stem = Path::new(&item.name)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or(&item.name);
        let dest_name = format!("{stem}_compressed.{ext}");
        let dest = dir.join(&dest_name);
        fs::copy(&item.temp_path, &dest)
            .map_err(|e| format!("Failed to save {}: {e}", item.name))?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            get_file_size,
            compress_image,
            save_image,
            save_all_images,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
