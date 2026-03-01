use std::path::Path;
use std::fs;
use std::process;
use anyhow::{Result, Context};

use crate::daemon::{SYSTEMD_SERVICE_PATH, SYSTEMD_SERVICE_TEMPLATE};

/// Check if systemd is available on this system
pub fn has_systemd() -> bool {
    Path::new("/run/systemd/system").exists()
}

/// Check if the pankha-agent systemd service is actively managing the process
/// Returns true if systemd service exists and is active/activating
pub fn is_systemd_service_active() -> bool {
    if !has_systemd() || !Path::new(SYSTEMD_SERVICE_PATH).exists() {
        return false;
    }

    // Check if service is active (running) or activating (starting)
    process::Command::new("systemctl")
        .args(["is-active", "--quiet", "pankha-agent"])
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// Install or repair systemd service for auto-start on boot (idempotent)
pub fn install_systemd_service() -> Result<()> {
    // Check if running as root (using libc for Linux)
    #[cfg(target_os = "linux")]
    if unsafe { libc::geteuid() } != 0 {
        return Err(anyhow::anyhow!(
            "Root privileges required. Run with: sudo ./pankha-agent --install-service"
        ));
    }

    // Check if systemd is available
    if !has_systemd() {
        println!("❌ systemd not detected on this system.");
        println!("   The agent can still run manually with: ./pankha-agent --start");
        println!();
        println!("   For auto-start, consult your init system documentation:");
        println!("   - OpenRC: Add to /etc/init.d/");
        println!("   - SysVinit: Add to /etc/rc.local");
        println!("   - runit: Create service directory in /etc/sv/");
        return Ok(());
    }

    // Get executable path and working directory
    let exe_path = std::env::current_exe()?;
    let work_dir = exe_path
        .parent()
        .ok_or_else(|| anyhow::anyhow!("Cannot determine executable directory"))?;

    // Generate service file content
    let service_content = SYSTEMD_SERVICE_TEMPLATE
        .replace("{{EXEC_PATH}}", exe_path.to_str().unwrap_or("/opt/pankha-agent/pankha-agent"))
        .replace("{{WORK_DIR}}", work_dir.to_str().unwrap_or("/opt/pankha-agent"));

    // Check if service file already exists and is identical
    let service_path = Path::new(SYSTEMD_SERVICE_PATH);
    if service_path.exists() {
        if let Ok(existing_content) = fs::read_to_string(service_path) {
            if existing_content == service_content {
                println!("✓ Service is already installed and up-to-date");
                return Ok(());
            }
        }
        println!("! Existing service file found - updating...");
    }

    // Write service file
    fs::write(service_path, &service_content)
        .context("Failed to write service file")?;
    println!("✓ Service file created: {}", SYSTEMD_SERVICE_PATH);

    // Reload systemd daemon
    let reload_status = process::Command::new("systemctl")
        .args(["daemon-reload"])
        .status();
    match reload_status {
        Ok(status) if status.success() => {
            println!("✓ Systemd daemon reloaded");
        }
        _ => {
            println!("⚠ Failed to reload systemd daemon (run: systemctl daemon-reload)");
        }
    }

    // Enable the service
    let enable_status = process::Command::new("systemctl")
        .args(["enable", "pankha-agent.service"])
        .status();
    match enable_status {
        Ok(status) if status.success() => {
            println!("✓ Service enabled (will start on boot)");
        }
        _ => {
            println!("⚠ Failed to enable service (run: systemctl enable pankha-agent.service)");
        }
    }

    println!();
    println!("Start now with: sudo systemctl start pankha-agent");
    println!("Or use:         ./pankha-agent --start");

    Ok(())
}

/// Uninstall systemd service
pub fn uninstall_systemd_service() -> Result<()> {
    // Check if running as root (using libc for Linux)
    #[cfg(target_os = "linux")]
    if unsafe { libc::geteuid() } != 0 {
        return Err(anyhow::anyhow!(
            "Root privileges required. Run with: sudo ./pankha-agent --uninstall-service"
        ));
    }

    // Check if systemd is available
    if !has_systemd() {
        println!("❌ systemd not detected on this system.");
        return Ok(());
    }

    let service_path = Path::new(SYSTEMD_SERVICE_PATH);
    if !service_path.exists() {
        println!("✓ Service is not installed");
        return Ok(());
    }

    // Stop the service if running
    let _ = process::Command::new("systemctl")
        .args(["stop", "pankha-agent"])
        .status();
    println!("✓ Service stopped");

    // Disable the service
    let _ = process::Command::new("systemctl")
        .args(["disable", "pankha-agent"])
        .status();
    println!("✓ Service disabled");

    // Remove the service file
    fs::remove_file(service_path)?;
    println!("✓ Service file removed");

    // Reload systemd daemon
    let _ = process::Command::new("systemctl")
        .args(["daemon-reload"])
        .status();
    println!("✓ Systemd daemon reloaded");

    Ok(())
}
