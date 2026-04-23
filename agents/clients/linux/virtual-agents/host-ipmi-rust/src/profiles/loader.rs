//! JSON profile loader with validation.
//! Reads a BMC profile from disk, validates safety constraints,
//! and resolves `extends` inheritance via the merger.

use std::path::Path;
use anyhow::{anyhow, Context, Result};
use tracing::info;

use super::types::BmcProfile;
use super::merger::resolve_extends_value;

/// Load a BMC profile from a JSON file, resolve `extends` inheritance,
/// and validate safety constraints.
///
/// Loads as raw JSON Value first so partial child profiles (e.g., only fan_zones)
/// can be merged with their base before typed deserialization.
pub fn load_profile(path: &Path) -> Result<BmcProfile> {
    let content = std::fs::read_to_string(path)
        .with_context(|| format!("Failed to read profile: {:?}", path))?;

    let value: serde_json::Value = serde_json::from_str(&content)
        .with_context(|| format!("Failed to parse profile JSON: {:?}", path))?;

    // Resolve extends inheritance if present (merge as raw Values, then deserialize)
    let final_value = if value.get("extends").and_then(|v| v.as_str()).is_some() {
        let base_dir = path.parent()
            .ok_or_else(|| anyhow!("Cannot determine profile directory"))?;
        resolve_extends_value(value, base_dir)?
    } else {
        value
    };

    let profile: BmcProfile = serde_json::from_value(final_value)
        .with_context(|| format!("Failed to deserialize profile after merge: {:?}", path))?;

    // Validate: profile must have protocols.ipmi after resolution
    let ipmi = profile.protocols.as_ref()
        .and_then(|p| p.ipmi.as_ref())
        .ok_or_else(|| anyhow!("Profile has no IPMI protocol section after resolution"))?;

    let is_monitor_only = ipmi.fan_zones.is_empty();

    // Validate: write-capable profiles must have at least one critical reset command.
    // Monitor-only profiles are allowed to omit reset commands because they never
    // take over BMC fan control in the first place.
    let has_critical_reset = ipmi.lifecycle.reset_to_factory.iter()
        .any(|cmd| cmd.critical);

    if !is_monitor_only && !has_critical_reset {
        return Err(anyhow!(
            "Safety violation: reset_to_factory must contain at least one critical: true command. \
             Profile rejected to prevent BMC lockout on agent crash."
        ));
    }

    info!(
        "Loaded profile: {} ({}) - {} fan zones, {} init commands, {} reset commands{}",
        profile.metadata.vendor,
        profile.metadata.description.as_deref().unwrap_or("no description"),
        ipmi.fan_zones.len(),
        ipmi.lifecycle.initialization.len(),
        ipmi.lifecycle.reset_to_factory.len(),
        if is_monitor_only { " [monitor-only]" } else { "" },
    );

    Ok(profile)
}
