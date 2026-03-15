//! HTTP profile fetch: download BMC profile from backend API.
//!
//! Fallback: if fetch fails, agent uses existing profile.json on disk
//! or the --profile CLI flag.

use std::path::{Path, PathBuf};
use anyhow::{Context, Result};
use tracing::{info, warn, debug};

/// Fetch the BMC profile JSON from the backend API and write it to `profile.json`.
/// On failure, falls back to existing profile.json on disk.
///
/// Returns the path to the profile file that should be loaded.
pub async fn fetch_and_cache_profile(
    profile_url: &str,
    install_dir: &Path,
) -> Result<PathBuf> {
    let profile_path = install_dir.join("profile.json");

    // Attempt HTTP fetch
    info!("Fetching BMC profile from {}", profile_url);
    match fetch_profile_http(profile_url).await {
        Ok(json) => {
            std::fs::write(&profile_path, &json)
                .with_context(|| format!("Failed to write profile to {:?}", profile_path))?;

            info!("BMC profile fetched and saved to {:?}", profile_path);
            Ok(profile_path)
        }
        Err(e) => {
            warn!("Failed to fetch profile from API: {}", e);

            if profile_path.exists() {
                warn!("Using existing profile from {:?}", profile_path);
                Ok(profile_path)
            } else {
                Err(e).context("No profile available: API fetch failed and no local profile exists")
            }
        }
    }
}

/// Perform the HTTP GET request using curl (same pattern as self_update.rs).
async fn fetch_profile_http(url: &str) -> Result<String> {
    let output = std::process::Command::new("curl")
        .args(["-sSL", "--max-time", "10", url])
        .output()
        .context("Failed to execute curl - ensure it is installed")?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(anyhow::anyhow!("curl failed (status {}): {}", output.status, stderr));
    }

    let body = String::from_utf8(output.stdout)
        .context("Profile response is not valid UTF-8")?;

    // Validate it's parseable JSON
    let parsed: serde_json::Value = serde_json::from_str(&body)
        .context("Profile response is not valid JSON")?;

    // Check for API error response
    if let Some(error) = parsed.get("error").and_then(|v| v.as_str()) {
        return Err(anyhow::anyhow!("Backend returned error: {}", error));
    }

    debug!("Profile fetched: {} bytes", body.len());
    Ok(body)
}
