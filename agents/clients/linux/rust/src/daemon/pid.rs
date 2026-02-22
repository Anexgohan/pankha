use std::fs;
use std::path::Path;
use anyhow::Result;

use crate::daemon::{PID_FILE, LOG_DIR};

pub fn ensure_directories() -> Result<()> {
    fs::create_dir_all("/run/pankha-agent")?;
    fs::create_dir_all(LOG_DIR)?;
    Ok(())
}

pub fn get_pid() -> Result<Option<u32>> {
    if Path::new(PID_FILE).exists() {
        let content = fs::read_to_string(PID_FILE)?;
        let pid = content.trim().parse::<u32>()?;
        Ok(Some(pid))
    } else {
        Ok(None)
    }
}

pub fn is_running() -> bool {
    if let Ok(Some(pid)) = get_pid() {
        // Check if process is still alive by sending signal 0
        let alive = unsafe { libc::kill(pid as i32, 0) == 0 };

        if !alive {
            // Process is dead but PID file exists - cleanup stale PID
            if let Err(e) = remove_pid_file() {
                eprintln!("Warning: Could not remove stale PID file: {}", e);
            }
            return false;
        }
        true
    } else {
        false
    }
}

pub fn save_pid(pid: u32) -> Result<()> {
    ensure_directories()?;
    fs::write(PID_FILE, pid.to_string())?;
    Ok(())
}

pub fn remove_pid_file() -> Result<()> {
    if Path::new(PID_FILE).exists() {
        fs::remove_file(PID_FILE)?;
    }
    Ok(())
}
