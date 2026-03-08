//! Profile `extends` inheritance resolver.
//! When a profile has "extends": "_bases/dell_ipmi", this module loads the base
//! profile and deep-merges the model's overrides on top.
//!
//! Merge rules (per taskfile):
//!   - metadata: shallow merge (model overrides base fields)
//!   - parsing: shallow merge (model can override tokens)
//!   - fan_zones: REPLACE (model zones replace base entirely)
//!   - initialization: APPEND (model init added after base)
//!   - reset_to_factory: REPLACE (model reset replaces base)

use std::path::Path;
use anyhow::{anyhow, Context, Result};
use tracing::info;

/// Resolve `extends` by loading the base profile and merging raw JSON Values.
/// Both base and child are raw Values — no typed deserialization until after merge.
/// This allows partial child profiles (e.g., only fan_zones) to work correctly.
pub fn resolve_extends_value(child: serde_json::Value, base_dir: &Path) -> Result<serde_json::Value> {
    let extends = child.get("extends")
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow!("resolve_extends_value called on profile without extends"))?;

    // Resolve base path: extends value is like "_bases/dell_ipmi" → "_bases/dell_ipmi.json"
    let base_path = base_dir.join(format!("{}.json", extends));
    info!("Resolving extends: {} -> {:?}", extends, base_path);

    let base_content = std::fs::read_to_string(&base_path)
        .with_context(|| format!("Failed to read base profile: {:?}", base_path))?;

    let base_value: serde_json::Value = serde_json::from_str(&base_content)
        .with_context(|| format!("Failed to parse base profile: {:?}", base_path))?;

    let mut merged = deep_merge(base_value, child);

    // Clear extends since we've resolved it
    if let Some(obj) = merged.as_object_mut() {
        obj.remove("extends");
    }

    Ok(merged)
}

/// Deep merge base + override according to profile merge rules.
fn deep_merge(base: serde_json::Value, over: serde_json::Value) -> serde_json::Value {
    use serde_json::Value;

    match (base, over) {
        (Value::Object(mut base_map), Value::Object(over_map)) => {
            for (key, over_val) in over_map {
                // Skip null overrides (from Option::None serialization)
                if over_val.is_null() {
                    continue;
                }

                match key.as_str() {
                    // fan_zones: REPLACE (model replaces base entirely)
                    "fan_zones" => {
                        base_map.insert(key, over_val);
                    }
                    // reset_to_factory: REPLACE
                    "reset_to_factory" => {
                        base_map.insert(key, over_val);
                    }
                    // initialization: APPEND (model init added after base)
                    "initialization" => {
                        if let Some(Value::Array(mut base_arr)) = base_map.remove(&key) {
                            if let Value::Array(over_arr) = over_val {
                                base_arr.extend(over_arr);
                                base_map.insert(key, Value::Array(base_arr));
                            } else {
                                base_map.insert(key, over_val);
                            }
                        } else {
                            base_map.insert(key, over_val);
                        }
                    }
                    // extends: skip (don't carry over)
                    "extends" => {}
                    // Everything else: recursive merge for objects, replace for scalars
                    _ => {
                        let merged = if let Some(base_val) = base_map.remove(&key) {
                            deep_merge(base_val, over_val)
                        } else {
                            over_val
                        };
                        base_map.insert(key, merged);
                    }
                }
            }
            Value::Object(base_map)
        }
        // Non-object: override wins
        (_, over) => over,
    }
}
