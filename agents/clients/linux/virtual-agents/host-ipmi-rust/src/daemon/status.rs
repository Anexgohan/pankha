use std::path::Path;
use std::fs;
use std::process;
use anyhow::Result;

use crate::daemon::pid::*;
use crate::daemon::systemd::*;
use crate::daemon::{LOG_DIR, SYSTEMD_SERVICE_PATH};
use crate::config::persistence::load_config;

pub async fn show_status() -> Result<()> {
    println!("\x1b[32mpankha-agent v{} ({})\x1b[0m", env!("CARGO_PKG_VERSION"), std::env::consts::ARCH);
    println!("================================");

    if is_running() {
        if let Some(pid) = get_pid()? {
            println!("Status: Running (PID: {})", pid);

            // Show some runtime info
            let log_path = format!("{}/agent.log", LOG_DIR);
            if Path::new(&log_path).exists() {
                println!("\nLast 5 log entries:");
                if let Ok(content) = fs::read_to_string(&log_path) {
                    let lines: Vec<&str> = content.lines().rev().take(5).collect();
                    for line in lines.iter().rev() {
                        println!("   {}", line);
                    }
                }
            }
        }
    } else {
        println!("Status: Not running");
    }

    // Show configuration info
    println!("\nConfiguration:");
    if let Ok(config) = load_config(None).await {
        println!("   Server: {}", config.backend.server_url);
        println!("   Update Interval: {}s", config.agent.update_interval);
        println!("   Agent Name: {}", config.agent.name);
    } else {
        println!("   Error: Could not load configuration");
    }

    Ok(())
}

/// Run health check to verify agent installation
pub fn run_health_check() -> Result<()> {
    println!("\x1b[32mpankha-agent v{} ({})\x1b[0m", env!("CARGO_PKG_VERSION"), std::env::consts::ARCH);
    println!("Health Check");
    println!("============\n");

    let mut all_ok = true;

    // Check config file
    let exe_path = std::env::current_exe()?;
    let config_path = exe_path
        .parent()
        .ok_or_else(|| anyhow::anyhow!("Cannot determine executable directory"))?
        .join("config.json");

    if config_path.exists() {
        println!("✓ Config file: {}", config_path.display());
    } else {
        println!("✗ Config file: NOT FOUND");
        println!("  Run: ./pankha-agent --setup");
        all_ok = false;
    }

    // Check directories
    if Path::new("/run/pankha-agent").exists() {
        println!("✓ Runtime dir: /run/pankha-agent");
    } else {
        println!("⚠ Runtime dir: Not created (will be created on start)");
    }

    if Path::new(LOG_DIR).exists() {
        println!("✓ Log dir: {}", LOG_DIR);
    } else {
        println!("⚠ Log dir: Not created (will be created on start)");
    }

    // Check systemd service (Linux only)
    #[cfg(target_os = "linux")]
    {
        if has_systemd() {
            if Path::new(SYSTEMD_SERVICE_PATH).exists() {
                // Check if enabled
                let enabled = process::Command::new("systemctl")
                    .args(["is-enabled", "pankha-agent"])
                    .output()
                    .map(|o| o.status.success())
                    .unwrap_or(false);

                if enabled {
                    println!("✓ Systemd service: Installed and enabled");
                } else {
                    println!("⚠ Systemd service: Installed but NOT enabled");
                    println!("  Run: sudo systemctl enable pankha-agent");
                }
            } else {
                println!("✗ Systemd service: NOT INSTALLED");
                println!("  Run: sudo ./pankha-agent --install-service");
                all_ok = false;
            }
        } else {
            println!("- Systemd: Not available on this system");
        }
    }

    // Check agent status
    if is_running() {
        if let Ok(Some(pid)) = get_pid() {
            println!("✓ Agent status: Running (PID: {})", pid);
        }
    } else {
        println!("⚠ Agent status: Not running");
        all_ok = false;
    }

    println!();
    if all_ok {
        println!("\x1b[32m✓ All checks passed!\x1b[0m");
    } else {
        println!("\x1b[33m⚠ Some issues found - see above\x1b[0m");
    }

    Ok(())
}
