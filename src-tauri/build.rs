use std::{
  env, fs,
  path::{Path, PathBuf},
};

fn main() {
  println!("cargo:rerun-if-changed=windows-shell/register-context-menu.ps1");
  println!("cargo:rerun-if-changed=windows-shell/unregister-context-menu.ps1");

  copy_windows_shell_scripts();
  tauri_build::build()
}

fn copy_windows_shell_scripts() {
  if env::var_os("CARGO_CFG_WINDOWS").is_none() {
    return;
  }

  let out_dir = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR is not set"));
  let profile_dir = out_dir
    .ancestors()
    .nth(3)
    .expect("failed to locate Cargo profile output directory");

  let scripts = [
    Path::new("windows-shell/register-context-menu.ps1"),
    Path::new("windows-shell/unregister-context-menu.ps1"),
  ];

  for script in scripts {
    let file_name = script
      .file_name()
      .expect("script path does not include a file name");
    let destination = profile_dir.join(file_name);

    fs::copy(script, &destination).unwrap_or_else(|error| {
      panic!(
        "failed to copy {} to {}: {}",
        script.display(),
        destination.display(),
        error
      )
    });
  }
}
