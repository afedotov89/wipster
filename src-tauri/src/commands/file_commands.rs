use std::path::{Path, PathBuf};
use std::process::Command;

/// `~/…` is a shell's shorthand, not a path — expand it before touching disk.
fn resolve(path: &str) -> PathBuf {
    if let Some(rest) = path.strip_prefix("~/") {
        if let Some(home) = std::env::var_os("HOME") {
            return PathBuf::from(home).join(rest);
        }
    }
    PathBuf::from(path)
}

/// Open a file or folder the way double-clicking it in Finder would.
///
/// Not the shell plugin: its `open` is scoped to web addresses by default, so a
/// plain path silently did nothing — which is exactly what "Show folder" did
/// before this existed.
#[tauri::command]
pub fn open_path(path: String) -> Result<(), String> {
    let target = resolve(&path);
    if !target.exists() {
        return Err(format!("There is no {path} any more"));
    }
    Command::new("open")
        .arg(&target)
        .spawn()
        .map_err(|e| format!("Could not open {path}: {e}"))?;
    Ok(())
}

/// Show a file in Finder, selected — not just its folder opened.
#[tauri::command]
pub fn reveal_path(path: String) -> Result<(), String> {
    let target = resolve(&path);
    if !target.exists() {
        return Err(format!("There is no {path} any more"));
    }
    Command::new("open")
        .arg("-R")
        .arg(&target)
        .spawn()
        .map_err(|e| format!("Could not show {path}: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_home_shorthand_becomes_a_real_path() {
        let home = std::env::var("HOME").unwrap();
        assert_eq!(resolve("~/Documents"), Path::new(&home).join("Documents"));
        assert_eq!(resolve("/tmp/x"), Path::new("/tmp/x"));
    }

    /// A path that is gone says so, instead of failing silently the way the
    /// scoped shell plugin did.
    #[test]
    fn a_missing_path_is_an_error_not_a_shrug() {
        let err = open_path("/tmp/wipster-does-not-exist-9f2a".into()).unwrap_err();
        assert!(err.contains("/tmp/wipster-does-not-exist-9f2a"));
        assert!(reveal_path("/tmp/wipster-does-not-exist-9f2a".into()).is_err());
    }
}
