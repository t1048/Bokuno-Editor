use ignore::WalkBuilder;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

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
pub struct FileContent {
    pub content: String,
    pub file_name: String,
    pub file_path: String,
}

#[tauri::command]
async fn read_file(file_path: String) -> Result<FileContent, String> {
    let path = Path::new(&file_path);
    
    if !path.exists() {
        return Err(format!("File not found: {}", file_path));
    }
    
    if !path.is_file() {
        return Err(format!("Path is not a file: {}", file_path));
    }
    
    let content = fs::read_to_string(&file_path)
        .map_err(|e| format!("Failed to read file: {}", e))?;
    
    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown")
        .to_string();
    
    Ok(FileContent {
        content,
        file_name,
        file_path,
    })
}

#[tauri::command]
async fn write_file(file_path: String, content: String) -> Result<(), String> {
    fs::write(&file_path, content)
        .map_err(|e| format!("Failed to write file: {}", e))?;
    Ok(())
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
        
        let content = match fs::read_to_string(path) {
            Ok(c) => c,
            Err(_) => continue,
        };
        
        for (line_number, line) in content.lines().enumerate() {
            if let Some(mat) = regex.find(line) {
                results.push(SearchResult {
                    file_path: file_path_str.clone(),
                    line_number: line_number + 1,
                    line_content: line.to_string(),
                    matched_range: (mat.start(), mat.end()),
                });
            }
        }
        
        // Limit results to prevent memory issues
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
    search_directory: Option<String>,
}

#[tauri::command]
async fn get_cli_args() -> Result<CliArgs, String> {
    let args: Vec<String> = std::env::args().collect();
    
    // Parse arguments
    // --file=<path> or first positional argument = file to open
    // --search=<directory> = directory to search
    let mut file_path = None;
    let mut search_directory = None;
    
    for arg in &args[1..] {
        if arg.starts_with("--file=") {
            file_path = Some(arg[7..].to_string());
        } else if arg.starts_with("--search=") {
            search_directory = Some(arg[9..].to_string());
        } else if !arg.starts_with("--") && file_path.is_none() {
            // First positional argument is treated as file path
            file_path = Some(arg.clone());
        }
    }
    
    Ok(CliArgs {
        file_path,
        search_directory,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut log_builder = tauri_plugin_log::Builder::new();
    if cfg!(debug_assertions) {
        log_builder = log_builder.level(log::LevelFilter::Info);
    }

    tauri::Builder::default()
        .plugin(log_builder.build())
        .invoke_handler(tauri::generate_handler![
            read_file,
            write_file,
            search_in_directory,
            get_file_info,
            get_cli_args,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
