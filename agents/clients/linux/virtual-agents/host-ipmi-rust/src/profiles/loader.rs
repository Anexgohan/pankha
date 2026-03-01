//! JSON profile loader with validation.
//! Reads a BMC profile from disk, validates safety constraints,
//! and resolves `extends` inheritance via the merger.

use std::path::Path;
use anyhow::{anyhow, Context, Result};
use tracing::info;

use super::types::BmcProfile;
use super::merger::resolve_extends;

/// Load a BMC profile from a JSON file, resolve `extends` inheritance,
/// and validate safety constraints.
pub fn load_profile(path: &Path) -> Result<BmcProfile> {
    let content = std::fs::read_to_string(path)
        .with_context(|| format!("Failed to read profile: {:?}", path))?;

    let mut profile: BmcProfile = serde_json::from_str(&content)
        .with_context(|| format!("Failed to parse profile JSON: {:?}", path))?;

    // Resolve extends inheritance if present
    if profile.extends.is_some() {
        let base_dir = path.parent()
            .ok_or_else(|| anyhow!("Cannot determine profile directory"))?;
        profile = resolve_extends(profile, base_dir)?;
    }

    // Validate: profile must have protocols.ipmi after resolution
    let ipmi = profile.protocols.as_ref()
        .and_then(|p| p.ipmi.as_ref())
        .ok_or_else(|| anyhow!("Profile has no IPMI protocol section after resolution"))?;

    // Validate: reset_to_factory must have at least one critical command
    let has_critical_reset = ipmi.lifecycle.reset_to_factory.iter()
        .any(|cmd| cmd.critical);

    if !has_critical_reset {
        return Err(anyhow!(
            "Safety violation: reset_to_factory must contain at least one critical: true command. \
             Profile rejected to prevent BMC lockout on agent crash."
        ));
    }

    info!(
        "Loaded profile: {} ({}) — {} fan zones, {} init commands, {} reset commands",
        profile.metadata.vendor,
        profile.metadata.description.as_deref().unwrap_or("no description"),
        ipmi.fan_zones.len(),
        ipmi.lifecycle.initialization.len(),
        ipmi.lifecycle.reset_to_factory.len(),
    );

    Ok(profile)
}
