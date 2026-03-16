//! Serde structs matching bmc_profile.schema.json v2.0.
//! These types represent the JSON profile ecosystem that drives all IPMI hardware logic.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BmcProfile {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extends: Option<String>,
    pub metadata: Metadata,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub protocols: Option<Protocols>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Metadata {
    pub schema_version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub profile_id: Option<String>,
    pub vendor: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_family: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub supported_protocols: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Protocols {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ipmi: Option<IpmiProtocol>,
    // redfish: Option<RedfishProtocol>,  // Future: Pillar 3
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IpmiProtocol {
    pub parsing: Parsing,
    pub fan_zones: Vec<FanZone>,
    pub lifecycle: Lifecycle,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Parsing {
    pub sdr_format: String,          // "csv"
    pub fan_match_token: String,     // "RPM"
    pub temp_match_token: String,    // "degrees C"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FanZone {
    pub id: String,                  // e.g., "all_fans", "zone0_cpu"
    pub name: String,                // e.g., "All Fans", "CPU Zone"
    /// SDR fan sensor names belonging to this zone (e.g., ["FAN1", "FAN2"]).
    /// Optional: if omitted and only one zone exists, all fans are assigned to it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub members: Option<Vec<String>>,
    pub speed_translation: SpeedTranslation,
    pub commands: FanZoneCommands,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpeedTranslation {
    #[serde(rename = "type")]
    pub translation_type: String,    // "byte_scale" | "decimal_hex" | "integer"
    #[serde(flatten)]
    pub params: serde_json::Value,   // input_min, input_max, output_min, output_max, etc.
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FanZoneCommands {
    pub set_speed: Command,
    /// Optional OEM raw command to read back current duty cycle (Tier 2).
    /// Response is a single hex byte (e.g., "32" = 50% for decimal_hex).
    /// Reverse-translated using the zone's speed_translation rules.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub read_speed: Option<Command>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Command {
    #[serde(rename = "type")]
    pub command_type: String,        // "ipmitool_raw" | "http_rest"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bytes: Option<String>,       // "0x30 0x30 0x02 0xff {{SPEED_HEX}}"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Lifecycle {
    pub initialization: Vec<LifecycleCommand>,
    pub reset_to_factory: Vec<LifecycleCommand>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LifecycleCommand {
    pub name: String,
    #[serde(rename = "type")]
    pub command_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bytes: Option<String>,
    pub critical: bool,
}
