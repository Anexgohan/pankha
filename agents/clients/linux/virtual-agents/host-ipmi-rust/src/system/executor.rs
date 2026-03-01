//! ipmitool subprocess executor.
//! Spawns ipmitool commands and respects PANKHA_IPMI_HOST for emulator testing.

use anyhow::{anyhow, Context, Result};
use tracing::{debug, trace};

/// Build an ipmitool Command with the correct interface flags.
/// If PANKHA_IPMI_HOST is set, routes via LAN to a remote BMC/emulator.
/// Otherwise, uses the local /dev/ipmi0 interface.
pub fn build_ipmitool_command() -> std::process::Command {
    let mut cmd = std::process::Command::new("ipmitool");

    if let Ok(host) = std::env::var("PANKHA_IPMI_HOST") {
        // Testing mode: route to remote emulator via LAN
        let port = std::env::var("PANKHA_IPMI_PORT").unwrap_or_else(|_| "623".to_string());
        let user = std::env::var("PANKHA_IPMI_USER").unwrap_or_else(|_| "admin".to_string());
        let pass = std::env::var("PANKHA_IPMI_PASS").unwrap_or_else(|_| "password".to_string());
        debug!("IPMI routing to emulator: {}:{}", host, port);
        cmd.args(["-I", "lanplus", "-H", &host, "-p", &port, "-U", &user, "-P", &pass]);
    } else {
        // Production: local BMC via /dev/ipmi0
        cmd.args(["-I", "open"]);
    }

    cmd
}

/// Execute `ipmitool -c sdr list full` and return the CSV output.
pub async fn run_ipmitool_sdr_csv() -> Result<String> {
    let mut cmd = build_ipmitool_command();
    cmd.args(["-c", "sdr", "list", "full"]);

    trace!("Executing: ipmitool {:?}", cmd.get_args().collect::<Vec<_>>());

    let output = tokio::process::Command::from(cmd)
        .output()
        .await
        .context("Failed to execute ipmitool")?;

    if !output.status.success() {
        return Err(anyhow!("ipmitool sdr failed: {}", String::from_utf8_lossy(&output.stderr)));
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// Execute `ipmitool raw <bytes>` for OEM commands (fan speed control, init, reset).
pub async fn run_ipmitool_raw(bytes: &str) -> Result<String> {
    let mut cmd = build_ipmitool_command();
    cmd.arg("raw");
    for byte in bytes.split_whitespace() {
        cmd.arg(byte);
    }

    debug!("Executing: ipmitool raw {}", bytes);

    let output = tokio::process::Command::from(cmd)
        .output()
        .await
        .context("Failed to execute ipmitool raw")?;

    if !output.status.success() {
        return Err(anyhow!("ipmitool raw failed: {}", String::from_utf8_lossy(&output.stderr)));
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// Execute `ipmitool mc info` to verify BMC connectivity.
pub async fn run_ipmitool_mc_info() -> Result<String> {
    let mut cmd = build_ipmitool_command();
    cmd.args(["mc", "info"]);

    debug!("Executing: ipmitool mc info");

    let output = tokio::process::Command::from(cmd)
        .output()
        .await
        .context("Failed to execute ipmitool mc info")?;

    if !output.status.success() {
        return Err(anyhow!("ipmitool mc info failed: {}", String::from_utf8_lossy(&output.stderr)));
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// Execute `ipmitool fru print` to get hardware inventory.
pub async fn run_ipmitool_fru() -> Result<String> {
    let mut cmd = build_ipmitool_command();
    cmd.args(["fru", "print"]);

    debug!("Executing: ipmitool fru print");

    let output = tokio::process::Command::from(cmd)
        .output()
        .await
        .context("Failed to execute ipmitool fru print")?;

    if !output.status.success() {
        return Err(anyhow!("ipmitool fru failed: {}", String::from_utf8_lossy(&output.stderr)));
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}
