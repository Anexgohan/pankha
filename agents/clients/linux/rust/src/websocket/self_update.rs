//! Agent self-update: download, verify, atomic swap, restart.

use anyhow::{Context, Result};
use std::sync::Arc;
use tracing::{debug, error, info, warn};

#[cfg(target_os = "linux")]
use crate::daemon::systemd::is_systemd_service_active;

impl super::client::WebSocketClient {
    /// Create a lightweight clone for spawning the update task.
    pub(crate) fn clone_for_update(&self) -> Self {
        Self {
            config: Arc::clone(&self.config),
            hardware_monitor: Arc::clone(&self.hardware_monitor),
            running: Arc::clone(&self.running),
            failsafe_active: Arc::clone(&self.failsafe_active),
        }
    }

    /// Perform self-update from local Pankha server
    ///
    /// Flow:
    /// 1. Version check - skip if already on target version
    /// 2. Download new binary from Hub
    /// 3. Sanity check - verify size and execution
    /// 4. Atomic swap with .old backup
    /// 5. Write .update_pending marker
    /// 6. Re-exec or systemctl restart
    pub(crate) async fn self_update(&self, target_version: Option<String>) -> Result<()> {
        let current_version = env!("CARGO_PKG_VERSION");

        // Version check: skip if already on target version
        if let Some(ref target) = target_version {
            // Normalize versions for comparison (strip 'v' prefix if present)
            let target_clean = target.trim_start_matches('v');
            if target_clean == current_version {
                info!("Target version matches current (v{}), proceeding with reinstall/overwrite", current_version);
            } else {
                info!("🚀 Updating from v{} to {}", current_version, target);
            }
        } else {
            info!("🚀 Starting self-update (no version specified, forcing reinstall)");
        }

        let arch = std::env::consts::ARCH;
        let server_url = self.config.read().await.backend.server_url.clone();

        // Convert ws://host:port/websocket to http://host:port
        let base_url = server_url.replace("ws://", "http://").replace("/websocket", "");
        let download_url = format!("{}/api/deploy/binaries/{}", base_url, arch);

        let current_exe = std::env::current_exe()?;
        let exe_dir = current_exe.parent()
            .ok_or_else(|| anyhow::anyhow!("Cannot determine executable directory"))?
            .to_path_buf();
        let new_exe = current_exe.with_extension("new");
        let old_exe = current_exe.with_extension("old");
        let update_marker = exe_dir.join(".update_pending");

        info!("Downloading {} binary from {}", arch, download_url);

        // Download using curl (standard on most Linux distros)
        let status = std::process::Command::new("curl")
            .args(["-L", "-o", new_exe.to_str().unwrap(), &download_url])
            .status()
            .context("Failed to execute curl - ensure it is installed")?;

        if !status.success() {
            return Err(anyhow::anyhow!("Download failed with status: {}", status));
        }

        // Set executable permissions
        #[cfg(target_os = "linux")]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&new_exe, std::fs::Permissions::from_mode(0o755))?;
        }

        // Sanity check: verify binary size (should be at least 1MB for a Rust binary)
        let binary_size = std::fs::metadata(&new_exe)?.len();
        if binary_size < 1_000_000 {
            std::fs::remove_file(&new_exe)?;
            return Err(anyhow::anyhow!(
                "Downloaded binary is suspiciously small ({} bytes) - likely incomplete or corrupted",
                binary_size
            ));
        }
        debug!("Binary size check passed: {} bytes", binary_size);

        // Sanity check: verify binary can execute
        let version_check = std::process::Command::new(&new_exe)
            .arg("--version")
            .output();

        match version_check {
            Ok(output) if output.status.success() => {
                let version_output = String::from_utf8_lossy(&output.stdout);
                debug!("Binary execution check passed: {}", version_output.trim());
            }
            Ok(output) => {
                std::fs::remove_file(&new_exe)?;
                return Err(anyhow::anyhow!(
                    "Downloaded binary failed to execute: {}",
                    String::from_utf8_lossy(&output.stderr)
                ));
            }
            Err(e) => {
                std::fs::remove_file(&new_exe)?;
                return Err(anyhow::anyhow!("Downloaded binary failed execution test: {}", e));
            }
        }

        // Atomic swap
        if old_exe.exists() {
            let _ = std::fs::remove_file(&old_exe);
        }

        info!("Applying update: Swapping binaries...");
        std::fs::rename(&current_exe, &old_exe).context("Failed to backup current binary")?;

        if let Err(e) = std::fs::rename(&new_exe, &current_exe) {
            error!("❌ Failed to swap binaries: {}. Attempting rollback...", e);
            let _ = std::fs::rename(&old_exe, &current_exe);
            return Err(e.into());
        }

        // Write update marker (for rollback detection on next startup)
        if let Err(e) = std::fs::write(&update_marker, format!("from={}\nto={}", current_version, target_version.as_deref().unwrap_or("unknown"))) {
            warn!("Failed to write update marker: {} (continuing anyway)", e);
        }

        info!("✅ Update applied successfully. Restarting service...");

        // Restart service
        #[cfg(target_os = "linux")]
        {
            if is_systemd_service_active() {
                // If managed by systemd, trigger a restart
                info!("Triggering systemd restart for pankha-agent...");
                let _ = std::process::Command::new("systemctl")
                    .args(["restart", "pankha-agent"])
                    .spawn();
            } else {
                // Manual restart path: use re-exec to prevent PID race conditions
                // re-exec replaces the current process image while keeping the same PID
                use std::os::unix::process::CommandExt;

                info!("Manual restart: Re-executing binary to apply update (PID {})", std::process::id());

                let mut cmd = std::process::Command::new(&current_exe);

                // If we were a daemon child, keep being one
                cmd.arg("--daemon-child");

                // Inherit log level if it was set explicitly
                let config = self.config.read().await;
                cmd.arg("--log-level").arg(&config.agent.log_level);
                drop(config);

                let err = cmd.exec();

                // If exec returns, it failed
                error!("❌ Manual re-exec failed: {}. Falling back to spawn/exit...", err);
                let _ = std::process::Command::new(&current_exe)
                    .arg("--daemon-child")
                    .spawn();
                std::process::exit(0);
            }
        }

        // For non-linux or if exit didn't happen
        #[cfg(not(target_os = "linux"))]
        {
             std::process::exit(0);
        }

        Ok(())
    }
}
