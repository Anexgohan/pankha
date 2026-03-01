//! Agent configuration structs and defaults.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentConfig {
    pub agent: AgentSettings,
    pub backend: BackendSettings,
    pub hardware: HardwareSettings,
    pub logging: LoggingSettings,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentSettings {
    pub id: String,
    pub name: String,
    pub update_interval: f64,
    pub log_level: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackendSettings {
    pub server_url: String,
    pub reconnect_interval: f64,
    pub max_reconnect_attempts: i32, // -1 for infinite
    pub connection_timeout: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HardwareSettings {
    pub enable_fan_control: bool,
    pub enable_sensor_monitoring: bool,
    pub fan_step_percent: u8,        // 3, 5, 10, 15, 25, 50, 100 (disable)
    pub hysteresis_temp: f64,        // 0.5-10.0°C (0.0 = disable)
    pub emergency_temp: f64,         // 70-100°C - used for local failsafe mode
    #[serde(default = "default_failsafe_speed")]
    pub failsafe_speed: u8,          // 0-100% - fan speed during failsafe mode
}

pub fn default_failsafe_speed() -> u8 { 70 }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoggingSettings {
    pub enable_file_logging: bool,
    pub log_file: String,
    pub max_log_size_mb: u32,
    pub log_retention_days: u32,
}

impl Default for AgentConfig {
    fn default() -> Self {
        let hostname = hostname::get()
            .unwrap_or_else(|_| std::ffi::OsString::from("unknown"))
            .to_string_lossy()
            .to_string();

        // Generate unique agent ID: OS-hostname-UUID (short UUID: first 8 chars)
        let os_name = std::env::consts::OS;
        let unique_id = Uuid::new_v4();
        let short_uuid = &unique_id.to_string()[..8];
        let agent_id = format!("{}-{}-{}", os_name, hostname, short_uuid);

        Self {
            agent: AgentSettings {
                id: agent_id,
                name: hostname.clone(),
                update_interval: 3.0,
                log_level: "INFO".to_string(),
            },
            backend: BackendSettings {
                server_url: "ws://[YOUR_HUB_IP]:3143/websocket".to_string(), // Placeholder forces user configuration
                reconnect_interval: 5.0,
                max_reconnect_attempts: -1,
                connection_timeout: 10.0,
            },
            hardware: HardwareSettings {
                enable_fan_control: true,
                enable_sensor_monitoring: true,
                fan_step_percent: 5,
                hysteresis_temp: 3.0,
                emergency_temp: 85.0,
                failsafe_speed: 70,
            },
            logging: LoggingSettings {
                enable_file_logging: true,
                log_file: "/var/log/pankha-agent/agent.log".to_string(),
                max_log_size_mb: 10,
                log_retention_days: 7,
            },
        }
    }
}
