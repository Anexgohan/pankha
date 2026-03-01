//! Hardware data types: Sensor, Fan, SystemHealth, and diagnostic dump structures.

use serde::{Deserialize, Serialize};

/// Sensor reading with temperature data
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Sensor {
    pub id: String,
    pub name: String,
    pub temperature: f64,
    #[serde(rename = "type")]
    pub sensor_type: String,
    pub max_temp: Option<f64>,
    pub crit_temp: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chip: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(rename = "hardwareName")]
    pub hardware_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
}

/// Fan information with RPM and PWM control
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Fan {
    pub id: String,
    pub name: String,
    pub rpm: Option<u32>,
    pub speed: u8, // 0-100%
    #[serde(rename = "targetSpeed")]
    pub target_speed: u8,
    pub status: String, // "ok", "stopped", "error"
    pub has_pwm_control: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pwm_file: Option<String>,
}

/// System health metrics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemHealth {
    #[serde(rename = "cpuUsage")]
    pub cpu_usage: f64,
    #[serde(rename = "memoryUsage")]
    pub memory_usage: f64,
    #[serde(rename = "agentUptime")]
    pub agent_uptime: f64,
}

// ============================================================================
// HARDWARE DUMP DATA STRUCTURES (Matches Windows HardwareDump.cs)
// ============================================================================

/// Root structure for hardware-info.json diagnostic dump
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct HardwareDumpRoot {
    pub metadata: HardwareDumpMetadata,
    pub hardware: Vec<HardwareDumpItem>,
}

/// Metadata section with system context
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct HardwareDumpMetadata {
    pub agent_version: String,
    #[serde(rename = "OSVersion")]
    pub os_version: String,
    pub is_elevated: bool,
    pub timestamp: String,
    pub motherboard: Option<String>,
    pub kernel_version: Option<String>,
    pub cpu_model: Option<String>,
}

/// Hardware item (chip/device) with sensors
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct HardwareDumpItem {
    pub name: String,
    pub identifier: String,
    #[serde(rename = "Type")]
    pub hardware_type: String,
    pub parent: Option<String>,
    pub technical_id: Option<String>,
    pub sensors: Vec<HardwareDumpSensor>,
    pub sub_hardware: Vec<HardwareDumpItem>,
}

/// Individual sensor with value and control info
/// Field order matches Windows HardwareDumpSensor for consistent JSON output
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct HardwareDumpSensor {
    pub name: String,
    pub identifier: String,
    #[serde(rename = "Type")]
    pub sensor_type: String,
    pub value: Option<f32>,
    pub min: String,
    pub max: String,
    pub is_monitored: bool,
    pub is_connected: Option<bool>,
    pub control: Option<HardwareDumpControlInfo>,
}

/// Control interface details for fan/pwm sensors
/// Field order matches Windows ControlInfo for consistent JSON output
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct HardwareDumpControlInfo {
    pub linked_sensor_id: Option<String>,
    pub method: String,
    pub can_write: bool,
    pub can_restore_default: bool,
    pub current_percent: Option<f32>,
    pub range: [i32; 2],
    pub mode: Option<String>,
}

impl Default for HardwareDumpMetadata {
    fn default() -> Self {
        Self {
            agent_version: String::new(),
            os_version: String::new(),
            is_elevated: false,
            timestamp: String::new(),
            motherboard: None,
            kernel_version: None,
            cpu_model: None,
        }
    }
}
