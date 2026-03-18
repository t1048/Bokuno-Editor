use ignore::WalkBuilder;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{Read, Seek, SeekFrom, BufReader};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::Emitter;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SearchResult {
    pub file_path: String,
    pub line_number: usize,
    pub line_content: String,
    pub matched_range: (usize, usize),
}

#[derive(Serialize, Deserialize, Debug)]
pub struct SearchRequest {
    pub directory: String,
    pub pattern: String,
    pub case_sensitive: bool,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct ReadRequest {
    pub file_path: String,
    pub encoding: Option<String>,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct ReadChunkRequest {
    pub file_path: String,
    pub start: u64,
    pub length: u64,
    pub encoding: Option<String>,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct FileChunk {
    pub content: String,
    pub start: u64,
    pub length: u64,
    pub total_size: u64,
    pub encoding: String,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct WriteRequest {
    pub file_path: String,
    pub content: String,
    pub encoding: Option<String>,
    pub line_ending: Option<String>,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct FileContent {
    pub content: String,
    pub file_name: String,
    pub file_path: String,
    pub encoding: String,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

#[tauri::command]
async fn read_directory(path: String) -> Result<Vec<FileEntry>, String> {
    let dir_path = Path::new(&path);
    if !dir_path.exists() || !dir_path.is_dir() {
        return Err(format!("Not a valid directory: {}", path));
    }

    let mut entries = Vec::new();
    let read_dir = fs::read_dir(dir_path).map_err(|e| format!("Failed to read directory: {}", e))?;

    for entry_result in read_dir {
        if let Ok(entry) = entry_result {
            let path_buf = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            
            // Skip hidden files/directories (starting with .) if desired, but let's just return everything or maybe skip .git
            if name == ".git" {
                continue;
            }

            let is_dir = path_buf.is_dir();
            entries.push(FileEntry {
                name,
                path: path_buf.to_string_lossy().to_string(),
                is_dir,
            });
        }
    }

    // Sort entries: directories first, then alphabetically
    entries.sort_by(|a, b| {
        if a.is_dir && !b.is_dir {
            std::cmp::Ordering::Less
        } else if !a.is_dir && b.is_dir {
            std::cmp::Ordering::Greater
        } else {
            a.name.to_lowercase().cmp(&b.name.to_lowercase())
        }
    });

    Ok(entries)
}

#[tauri::command]
async fn read_file(request: ReadRequest) -> Result<FileContent, String> {
    let path = Path::new(&request.file_path);
    
    if !path.exists() {
        return Err(format!("File not found: {}", request.file_path));
    }
    
    if !path.is_file() {
        return Err(format!("Path is not a file: {}", request.file_path));
    }
    
    let mut bytes = fs::read(&request.file_path)
        .map_err(|e| format!("Failed to read file: {}", e))?;
    
    // UTF-8 BOM の有無チェックと除去
    let has_bom = bytes.starts_with(&[0xEF, 0xBB, 0xBF]);
    if has_bom {
        bytes.drain(0..3);
    }

    // 文字コードの決定と自動判定
    let req_encoding = request.encoding.as_deref().unwrap_or("auto");
    
    let (actual_encoding_name, detected_encoding_label) = if req_encoding == "auto" {
        if has_bom {
            ("utf-8", "utf-8-bom".to_string())
        } else {
            let mut detector = chardetng::EncodingDetector::new();
            detector.feed(&bytes, true);
            let encoding = detector.guess(None, true);
            let name = encoding.name();
            // chardetng は shift_jis 等を返すため、そのまま利用
            (name, name.to_string())
        }
    } else if req_encoding == "utf-8-bom" {
        ("utf-8", "utf-8-bom".to_string())
    } else {
        (req_encoding, req_encoding.to_string())
    };

    let encoding = encoding_rs::Encoding::for_label(actual_encoding_name.as_bytes())
        .ok_or_else(|| format!("Unknown encoding: {}", actual_encoding_name))?;
    
    let (content, _actual_encoding, _has_malformed) = encoding.decode(&bytes);
    let content = content.into_owned();
    
    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown")
        .to_string();
    
    Ok(FileContent {
        content,
        file_name,
        file_path: request.file_path,
        encoding: detected_encoding_label,
    })
}

#[tauri::command]
async fn write_file(request: WriteRequest) -> Result<(), String> {
    let mut content = request.content;

    // 改行コードの変換
    if let Some(le) = request.line_ending {
        match le.to_lowercase().as_str() {
            "crlf" => {
                content = content.replace("\r\n", "\n").replace("\r", "\n").replace("\n", "\r\n");
            }
            "cr" => {
                content = content.replace("\r\n", "\n").replace("\r", "\n").replace("\n", "\r");
            }
            "lf" => {
                content = content.replace("\r\n", "\n").replace("\r", "\n");
            }
            _ => {}
        }
    }

    // 文字コードのエンコード
    let encoding_name = request.encoding.as_deref().unwrap_or("utf-8");
    let is_bom = encoding_name == "utf-8-bom";
    let actual_encoding_name = if is_bom { "utf-8" } else { encoding_name };

    let encoding = encoding_rs::Encoding::for_label(actual_encoding_name.as_bytes())
        .ok_or_else(|| format!("Unknown encoding: {}", actual_encoding_name))?;
    
    let (bytes, _actual_encoding, _has_malformed) = encoding.encode(&content);
    
    let mut final_bytes = Vec::new();
    if is_bom {
        final_bytes.extend_from_slice(&[0xEF, 0xBB, 0xBF]);
    }
    final_bytes.extend_from_slice(&bytes);
    
    fs::write(&request.file_path, final_bytes)
        .map_err(|e| format!("Failed to write file: {}", e))?;
    Ok(())
}

fn adjust_to_utf8_boundary<R: Read + Seek>(reader: &mut R, pos: u64) -> u64 {
    if pos == 0 {
        return 0;
    }

    let mut current_pos = pos;
    let mut buffer = [0u8; 1];

    // Check up to 3 bytes back to find the start of a UTF-8 character
    // UTF-8 start byte: NOT 10xxxxxx (0x80 to 0xBF)
    for _ in 0..4 {
        if let Ok(_) = reader.seek(SeekFrom::Start(current_pos)) {
            if let Ok(n) = reader.read(&mut buffer) {
                if n == 1 {
                    if (buffer[0] & 0xC0) != 0x80 {
                        return current_pos;
                    }
                }
            }
        }
        if current_pos == 0 {
            break;
        }
        current_pos -= 1;
    }
    pos
}

#[tauri::command]
async fn read_file_chunk(request: ReadChunkRequest) -> Result<FileChunk, String> {
    let path = Path::new(&request.file_path);
    let mut file = fs::File::open(path).map_err(|e| format!("Failed to open file: {}", e))?;
    let total_size = file.metadata().map_err(|e| format!("Failed to get metadata: {}", e))?.len();

    let mut start = request.start;
    if start > total_size {
        start = total_size;
    }

    let mut length = request.length;
    
    // Adjust start to UTF-8 boundary if requested or if using UTF-8
    let req_encoding = request.encoding.as_deref().unwrap_or("auto");
    let is_utf8 = req_encoding == "auto" || req_encoding == "utf-8" || req_encoding == "utf-8-bom";

    if is_utf8 && start > 0 {
        start = adjust_to_utf8_boundary(&mut file, start);
    }

    if start + length > total_size {
        length = total_size - start;
    }

    file.seek(SeekFrom::Start(start)).map_err(|e| format!("Failed to seek: {}", e))?;
    let mut buffer = vec![0u8; length as usize];
    file.read_exact(&mut buffer).map_err(|e| format!("Failed to read: {}", e))?;

    let (actual_encoding_name, detected_encoding_label) = if req_encoding == "auto" {
        // Detect encoding based on first 8KB if start is 0, or just use utf-8
        if start == 0 {
            let mut detector = chardetng::EncodingDetector::new();
            detector.feed(&buffer, true);
            let enc = detector.guess(None, true);
            (enc.name(), enc.name().to_string())
        } else {
            ("utf-8", "utf-8".to_string())
        }
    } else {
        (req_encoding, req_encoding.to_string())
    };

    let encoding = encoding_rs::Encoding::for_label(actual_encoding_name.as_bytes())
        .ok_or_else(|| format!("Unknown encoding: {}", actual_encoding_name))?;

    let (content, _actual_encoding, _has_malformed) = encoding.decode(&buffer);
    
    Ok(FileChunk {
        content: content.into_owned(),
        start,
        length: buffer.len() as u64,
        total_size,
        encoding: detected_encoding_label,
    })
}

#[tauri::command]
async fn get_file_metadata(file_path: String) -> Result<serde_json::Value, String> {
    let path = Path::new(&file_path);
    if !path.is_file() {
        return Err(format!("Not a file: {}", file_path));
    }
    
    let metadata = fs::metadata(path).map_err(|e| format!("Failed to get metadata: {}", e))?;
    let size = metadata.len();

    let mut file = fs::File::open(path).map_err(|e| format!("Failed to open: {}", e))?;
    
    // Encoding detection
    let mut head = vec![0u8; std::cmp::min(size as usize, 8192)];
    let _ = file.read_exact(&mut head); // Ignore error for small files
    
    let has_bom = head.starts_with(&[0xEF, 0xBB, 0xBF]);
    let encoding_name = if has_bom {
        "utf-8-bom".to_string()
    } else {
        let mut detector = chardetng::EncodingDetector::new();
        detector.feed(&head, true);
        let encoding = detector.guess(None, true);
        encoding.name().to_string()
    };

    // Approximate line count
    let mut line_count = 0;
    // Fast scan for '\n'
    if size < 1024 * 1024 * 1024 { // < 1GB
        file.seek(SeekFrom::Start(0)).map_err(|e| e.to_string())?;
        let mut reader = BufReader::new(file);
        let mut buffer = [0u8; 65536];
        loop {
            let n = reader.read(&mut buffer).map_err(|e| e.to_string())?;
            if n == 0 { break; }
            line_count += buffer[..n].iter().filter(|&&b| b == b'\n').count() as u64;
        }
    } else {
        // Extrapolate from first 10MB
        file.seek(SeekFrom::Start(0)).map_err(|e| e.to_string())?;
        let mut head_10mb = vec![0u8; 10 * 1024 * 1024];
        let n = file.read(&mut head_10mb).map_err(|e| e.to_string())?;
        let head_lines = head_10mb[..n].iter().filter(|&&b| b == b'\n').count() as u64;
        line_count = (head_lines as f64 * (size as f64 / n as f64)) as u64;
    }

    Ok(serde_json::json!({
        "file_path": file_path,
        "size": size,
        "encoding": encoding_name,
        "line_count_approx": line_count,
    }))
}

#[tauri::command]
async fn search_in_directory(request: SearchRequest) -> Result<Vec<SearchResult>, String> {
    let regex_flags = if request.case_sensitive { "" } else { "(?i)" };
    let pattern = format!("{}{}", regex_flags, regex::escape(&request.pattern));
    
    let regex = Regex::new(&pattern)
        .map_err(|e| format!("Invalid regex pattern: {}", e))?;
    
    let mut results = Vec::new();
    
    let walker = WalkBuilder::new(&request.directory)
        .hidden(false)
        .ignore(true)
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true)
        .build();
    
    for result in walker {
        let entry = match result {
            Ok(e) => e,
            Err(_) => continue,
        };
        
        let path = entry.path();
        
        if !path.is_file() {
            continue;
        }
        
        let file_path_str = path.to_string_lossy().to_string();
        
        // Skip binary files
        if is_binary_file(path) {
            continue;
        }
        
        let file = match fs::File::open(path) {
            Ok(f) => f,
            Err(_) => continue,
        };
        let reader = BufReader::new(file);
        use std::io::BufRead;
        
        for (line_number, line_result) in reader.lines().enumerate() {
            let line = match line_result {
                Ok(l) => l,
                Err(_) => break,
            };
            
            if let Some(mat) = regex.find(&line) {
                results.push(SearchResult {
                    file_path: file_path_str.clone(),
                    line_number: line_number + 1,
                    line_content: line.to_string(),
                    matched_range: (mat.start(), mat.end()),
                });
            }
            
            if results.len() >= 10000 {
                break;
            }
        }
        
        if results.len() >= 10000 {
            break;
        }
    }
    
    Ok(results)
}

fn is_binary_file(path: &Path) -> bool {
    let binary_extensions = [
        "exe", "dll", "so", "dylib", "bin",
        "png", "jpg", "jpeg", "gif", "bmp", "ico", "svg",
        "mp3", "mp4", "wav", "avi", "mkv",
        "zip", "tar", "gz", "rar", "7z",
        "pdf", "doc", "docx", "xls", "xlsx",
    ];
    
    if let Some(ext) = path.extension() {
        if let Some(ext_str) = ext.to_str() {
            return binary_extensions.contains(&ext_str.to_lowercase().as_str());
        }
    }
    
    false
}

#[tauri::command]
async fn get_file_info(file_path: String) -> Result<serde_json::Value, String> {
    let path = Path::new(&file_path);
    
    let metadata = fs::metadata(path)
        .map_err(|e| format!("Failed to get file metadata: {}", e))?;
    
    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown")
        .to_string();
    
    let extension = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_string();
    
    Ok(serde_json::json!({
        "file_name": file_name,
        "file_path": file_path,
        "extension": extension,
        "size": metadata.len(),
        "is_file": metadata.is_file(),
        "is_dir": metadata.is_dir(),
    }))
}

#[derive(Serialize, Clone)]
struct CliArgs {
    file_path: Option<String>,
    folder_path: Option<String>,
    line_number: Option<usize>,
    search_directory: Option<String>,
    search_mode: bool,
    search_pattern: Option<String>,
    search_cs: bool,
}

#[tauri::command]
async fn get_cli_args() -> Result<CliArgs, String> {
    let args: Vec<String> = std::env::args().collect();
    
    // Parse arguments
    let mut file_path = None;
    let mut folder_path = None;
    let mut line_number = None;
    let mut search_directory = None;
    let mut search_mode = false;
    let mut search_pattern = None;
    let mut search_cs = false;
    
    for arg in &args[1..] {
        if arg.starts_with("--file=") {
            file_path = Some(arg[7..].to_string());
        } else if arg.starts_with("--folder=") {
            folder_path = Some(arg[9..].to_string());
        } else if arg.starts_with("--line=") {
            line_number = arg[7..].parse().ok();
        } else if arg == "--search-mode" {
            search_mode = true;
        } else if arg.starts_with("--dir=") {
            search_directory = Some(arg[6..].to_string());
        } else if arg.starts_with("--pattern=") {
            search_pattern = Some(arg[10..].to_string());
        } else if arg.starts_with("--cs=") {
            search_cs = &arg[5..] == "true";
        } else if arg.starts_with("--search=") {
            search_directory = Some(arg[9..].to_string());
        } else if !arg.starts_with("--") && file_path.is_none() && folder_path.is_none() {
            // First positional argument
            let path = Path::new(arg);
            if path.is_dir() {
                folder_path = Some(arg.clone());
            } else {
                file_path = Some(arg.clone());
            }
        }
    }
    
    Ok(CliArgs {
        file_path,
        folder_path,
        line_number,
        search_directory,
        search_mode,
        search_pattern,
        search_cs,
    })
}

// --- Tail / log monitoring ---

pub struct TailWatcher {
    current_stop: Mutex<Option<Arc<AtomicBool>>>,
}

impl Default for TailWatcher {
    fn default() -> Self {
        TailWatcher {
            current_stop: Mutex::new(None),
        }
    }
}

/// Start watching a file for new appended content (like `tail -f`).
/// Emits the following events to the frontend:
///   - "tail_update"  : new content appended (payload: String)
///   - "tail_rotated" : file was truncated/rotated, frontend should reload it
///   - "tail_error"   : file disappeared or unreadable (payload: String)
#[tauri::command]
async fn start_tail(
    file_path: String,
    app_handle: tauri::AppHandle,
    watcher: tauri::State<'_, TailWatcher>,
) -> Result<(), String> {
    // Stop any already-running tail
    {
        let guard = watcher.current_stop.lock().unwrap();
        if let Some(flag) = guard.as_ref() {
            flag.store(true, Ordering::Relaxed);
        }
    }

    // Validate the file and record its current size as the starting offset
    let metadata =
        std::fs::metadata(&file_path).map_err(|e| format!("Failed to access file: {}", e))?;
    let initial_size = metadata.len();

    // Create a fresh stop flag for this session
    let stop_flag = Arc::new(AtomicBool::new(false));
    {
        let mut guard = watcher.current_stop.lock().unwrap();
        *guard = Some(stop_flag.clone());
    }

    let path = file_path.clone();
    let flag = stop_flag;

    tokio::spawn(async move {
        let mut last_size = initial_size;

        loop {
            if flag.load(Ordering::Relaxed) {
                break;
            }

            tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

            if flag.load(Ordering::Relaxed) {
                break;
            }

            match std::fs::metadata(&path) {
                Ok(meta) => {
                    let new_size = meta.len();

                    if new_size > last_size {
                        // Read only the bytes that were appended
                        use std::io::{Read, Seek, SeekFrom};
                        if let Ok(mut file) = std::fs::File::open(&path) {
                            if file.seek(SeekFrom::Start(last_size)).is_ok() {
                                let mut buffer = Vec::new();
                                if file.read_to_end(&mut buffer).is_ok() && !buffer.is_empty() {
                                    let new_content =
                                        String::from_utf8_lossy(&buffer).to_string();
                                    let _ = app_handle.emit("tail_update", new_content);
                                }
                            }
                        }
                        last_size = new_size;
                    } else if new_size < last_size {
                        // File was truncated or log-rotated – tell the frontend to reload.
                        // Update last_size to the new end so we don't re-read existing bytes.
                        last_size = new_size;
                        let _ = app_handle.emit("tail_rotated", ());
                    }
                }
                Err(_) => {
                    // File was deleted / moved
                    let _ = app_handle.emit("tail_error", "File not found");
                    break;
                }
            }
        }
    });

    Ok(())
}

/// Stop the currently running tail watcher.
#[tauri::command]
async fn stop_tail(watcher: tauri::State<'_, TailWatcher>) -> Result<(), String> {
    let guard = watcher.current_stop.lock().unwrap();
    if let Some(flag) = guard.as_ref() {
        flag.store(true, Ordering::Relaxed);
    }
    Ok(())
}

/// Open the containing folder of a file in Windows Explorer, with the file selected.
#[tauri::command]
async fn open_in_explorer(file_path: String) -> Result<(), String> {
    let path = Path::new(&file_path);
    if !path.exists() {
        return Err(format!("Path not found: {}", file_path));
    }

    // Use explorer.exe /select to open the folder with the file highlighted
    std::process::Command::new("explorer.exe")
        .args([&format!("/select,{}", file_path)])
        .spawn()
        .map_err(|e| format!("Failed to open explorer: {}", e))?;

    Ok(())
}

#[tauri::command]
async fn spawn_search_window(directory: String, pattern: String, case_sensitive: bool) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    
    let mut cmd = std::process::Command::new(exe);
    cmd.arg("--search-mode");
    cmd.arg(format!("--dir={}", directory));
    cmd.arg(format!("--pattern={}", pattern));
    cmd.arg(format!("--cs={}", case_sensitive));
    
    cmd.spawn().map_err(|e| format!("Failed to spawn search window: {}", e))?;
        
    Ok(())
}

#[tauri::command]
async fn open_file_in_new_window(file_path: String, line: Option<usize>) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    
    let mut cmd = std::process::Command::new(exe);
    cmd.arg(format!("--file={}", file_path));
    
    if let Some(l) = line {
        cmd.arg(format!("--line={}", l));
    }
    
    cmd.spawn().map_err(|e| format!("Failed to open file in new window: {}", e))?;
        
    Ok(())
}

#[tauri::command]
async fn spawn_new_window() -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    
    std::process::Command::new(exe)
        .spawn()
        .map_err(|e| format!("Failed to spawn new window: {}", e))?;
        
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut log_builder = tauri_plugin_log::Builder::new();
    if cfg!(debug_assertions) {
        log_builder = log_builder.level(log::LevelFilter::Info);
    }

    tauri::Builder::default()
        .plugin(log_builder.build())
        .plugin(tauri_plugin_dialog::init())
        .manage(TailWatcher::default())
        .invoke_handler(tauri::generate_handler![
            read_directory,
            read_file,
            read_file_chunk,
            write_file,
            search_in_directory,
            get_file_info,
            get_file_metadata,
            get_cli_args,
            start_tail,
            stop_tail,
            open_in_explorer,
            spawn_search_window,
            open_file_in_new_window,
            spawn_new_window,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
