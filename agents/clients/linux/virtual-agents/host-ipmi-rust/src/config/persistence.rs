//! Config file load, save, and migration logic.

use anyhow::Result;
use std::path::{Path, PathBuf};
use tracing::{info, warn};

use crate::config::types::AgentConfig;

/// Migrate config to current version (removes deprecated, adds new fields)
/// Phase 3: Config Migration - handles old configs automatically
pub(crate) fn migrate_config(config_path: &Path) -> Result<bool> {
    if !config_path.exists() {
        return Ok(false);
    }

    let content = std::fs::read_to_string(config_path)?;
    let mut json: serde_json::Value = serde_json::from_str(&content)?;
    let mut migrated = false;

    // === REMOVALS ===
    if let Some(hardware) = json.get_mut("hardware").and_then(|h| h.as_object_mut()) {
        if hardware.remove("filter_duplicate_sensors").is_some() {
            info!("Migrated: removed 'filter_duplicate_sensors'");
            migrated = true;
        }
        if hardware.remove("duplicate_sensor_tolerance").is_some() {
            info!("Migrated: removed 'duplicate_sensor_tolerance'");
            migrated = true;
        }
        if hardware.remove("fan_safety_minimum").is_some() {
            info!("Migrated: removed 'fan_safety_minimum' (replaced by failsafe_speed)");
            migrated = true;
        }

        // === ADDITIONS ===
        if !hardware.contains_key("failsafe_speed") {
            hardware.insert("failsafe_speed".to_string(), serde_json::json!(70));
            info!("Migrated: added 'failsafe_speed' with default 70");
            migrated = true;
        }
    }

    if migrated {
        std::fs::write(config_path, serde_json::to_string_pretty(&json)?)?;
        info!("Config migrated to latest version: {:?}", config_path);
    }

    Ok(migrated)
}

pub async fn load_config(path: Option<&str>) -> Result<AgentConfig> {
    let config_path = if let Some(p) = path {
        PathBuf::from(p)
    } else {
        // Default config location
        let exe_dir = std::env::current_exe()?
            .parent()
            .ok_or_else(|| anyhow::anyhow!("Cannot determine executable directory"))?
            .to_path_buf();
        exe_dir.join("config.json")
    };

    // Migrate config first (handles old configs automatically)
    if let Err(e) = migrate_config(&config_path) {
        warn!("Config migration check failed: {}", e);
    }

    if config_path.exists() {
        let content = tokio::fs::read_to_string(&config_path).await?;
        let config: AgentConfig = serde_json::from_str(&content)?;

        // Validate configuration
        if config.backend.server_url.contains("[YOUR_HUB_IP]") || config.backend.server_url.is_empty() {
            warn!("⚠️ Hub URL is not configured in {:?}. Agent will fail to connect.", config_path);
            warn!("Please run the setup wizard ('--setup') or edit the config file manually.");
        }

        info!("Loaded configuration from: {:?}", config_path);
        Ok(config)
    } else {
        info!("Config file not found. Please run the setup wizard ('--setup') to generate one.");
        Ok(AgentConfig::default())
    }
}

pub async fn save_config(config: &AgentConfig, path: &str) -> Result<()> {
    let content = serde_json::to_string_pretty(config)?;
    tokio::fs::write(path, content).await?;
    info!("Configuration saved to: {}", path);
    Ok(())
}
