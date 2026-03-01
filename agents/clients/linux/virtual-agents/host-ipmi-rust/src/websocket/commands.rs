//! WebSocket command handling: dispatches incoming commands and applies config changes.

use anyhow::Result;
use futures_util::SinkExt;
use std::sync::Arc;
use std::time::Duration;
use tokio_tungstenite::tungstenite::protocol::Message;
use tracing::{debug, error, info, warn};
use tracing_subscriber::EnvFilter;

use crate::app::logging::RELOAD_HANDLE;
use crate::config::persistence::save_config;
use crate::config::sst::{
    VALID_EMERGENCY_TEMPS, VALID_FAILSAFE_SPEEDS, VALID_FAN_STEPS,
    VALID_HYSTERESIS, VALID_LOG_LEVELS, VALID_UPDATE_INTERVALS,
};

use super::client::WsSink;

impl super::client::WebSocketClient {
    pub(crate) async fn handle_command(&self, data: &serde_json::Value, write: &mut WsSink) -> Result<()> {
        // Validate command structure first
        let command_type = data.get("type")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("Missing or invalid command type"))?;

        let command_id = data.get("commandId")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("Missing command ID"))?;

        let payload = data.get("payload")
            .ok_or_else(|| anyhow::anyhow!("Missing command payload"))?;

        debug!("Processing command: {} with payload: {:?}", command_type, payload);

        let (success, error_msg, result_data) = match command_type {
            "setFanSpeed" => {
                // Check if fan control is enabled
                let fan_control_enabled = {
                    let config = self.config.read().await;
                    config.hardware.enable_fan_control
                };

                if !fan_control_enabled {
                    debug!("Ignoring setFanSpeed command (fan control disabled)");
                    // Return success silently to avoid error spam
                    (true, None, serde_json::json!({"message": "Fan control is disabled"}))
                } else if let (Some(fan_id), Some(speed)) = (
                    payload.get("fanId").and_then(|v| v.as_str()),
                    payload.get("speed").and_then(|v| v.as_u64())
                ) {
                    // Validate fan ID and speed
                    if fan_id.trim().is_empty() {
                        (false, Some("Fan ID cannot be empty".to_string()), serde_json::json!({}))
                    } else if speed > 100 {
                        (false, Some(format!("Invalid fan speed: {}. Must be between 0-100", speed)), serde_json::json!({}))
                    } else {
                        match self.hardware_monitor.set_fan_speed(fan_id, speed as u8).await {
                            Ok(_) => (true, None, serde_json::json!({"fanId": fan_id, "speed": speed})),
                            Err(e) => (false, Some(e.to_string()), serde_json::json!({})),
                        }
                    }
                } else {
                    (false, Some("Missing fanId or speed in setFanSpeed command".to_string()), serde_json::json!({}))
                }
            }
            "emergencyStop" => {
                match self.hardware_monitor.emergency_stop().await {
                    Ok(_) => (true, None, serde_json::json!({"message": "Emergency stop executed"})),
                    Err(e) => (false, Some(e.to_string()), serde_json::json!({})),
                }
            }
            "setUpdateInterval" => {
                if let Some(interval) = payload.get("interval").and_then(|v| v.as_f64()) {
                    match self.set_update_interval(interval).await {
                        Ok(_) => (true, None, serde_json::json!({"interval": interval})),
                        Err(e) => (false, Some(e.to_string()), serde_json::json!({})),
                    }
                } else {
                    (false, Some("Missing or invalid interval".to_string()), serde_json::json!({}))
                }
            }
            "setFanStep" => {
                if let Some(step) = payload.get("step").and_then(|v| v.as_u64()) {
                    match self.set_fan_step(step as u8).await {
                        Ok(_) => (true, None, serde_json::json!({"step": step})),
                        Err(e) => (false, Some(e.to_string()), serde_json::json!({})),
                    }
                } else {
                    (false, Some("Missing or invalid step".to_string()), serde_json::json!({}))
                }
            }
            "setHysteresis" => {
                if let Some(hysteresis) = payload.get("hysteresis").and_then(|v| v.as_f64()) {
                    match self.set_hysteresis(hysteresis).await {
                        Ok(_) => (true, None, serde_json::json!({"hysteresis": hysteresis})),
                        Err(e) => (false, Some(e.to_string()), serde_json::json!({})),
                    }
                } else {
                    (false, Some("Missing or invalid hysteresis".to_string()), serde_json::json!({}))
                }
            }
            "setEmergencyTemp" => {
                if let Some(temp) = payload.get("temp").and_then(|v| v.as_f64()) {
                    match self.set_emergency_temp(temp).await {
                        Ok(_) => (true, None, serde_json::json!({"temp": temp})),
                        Err(e) => (false, Some(e.to_string()), serde_json::json!({})),
                    }
                } else {
                    (false, Some("Missing or invalid temp".to_string()), serde_json::json!({}))
                }
            }
            "setLogLevel" => {
                if let Some(level) = payload.get("level").and_then(|v| v.as_str()) {
                    match self.set_log_level(level).await {
                        Ok(_) => (true, None, serde_json::json!({"level": level})),
                        Err(e) => (false, Some(e.to_string()), serde_json::json!({})),
                    }
                } else {
                    (false, Some("Missing or invalid log level".to_string()), serde_json::json!({}))
                }
            }
            "setFailsafeSpeed" => {
                if let Some(speed) = payload.get("speed").and_then(|v| v.as_u64()) {
                    match self.set_failsafe_speed(speed as u8).await {
                        Ok(_) => (true, None, serde_json::json!({"speed": speed})),
                        Err(e) => (false, Some(e.to_string()), serde_json::json!({})),
                    }
                } else {
                    (false, Some("Missing or invalid speed".to_string()), serde_json::json!({}))
                }
            }
            "setEnableFanControl" => {
                if let Some(enabled) = payload.get("enabled").and_then(|v| v.as_bool()) {
                    match self.set_enable_fan_control(enabled).await {
                        Ok(_) => (true, None, serde_json::json!({"enabled": enabled})),
                        Err(e) => (false, Some(e.to_string()), serde_json::json!({})),
                    }
                } else {
                    (false, Some("Missing or invalid enabled".to_string()), serde_json::json!({}))
                }
            }
            "setAgentName" => {
                if let Some(name) = payload.get("name").and_then(|v| v.as_str()) {
                    match self.set_agent_name(name).await {
                        Ok(_) => (true, None, serde_json::json!({"name": name})),
                        Err(e) => (false, Some(e.to_string()), serde_json::json!({})),
                    }
                } else {
                    (false, Some("Missing or invalid name".to_string()), serde_json::json!({}))
                }
            }
            "selfUpdate" => {
                // Extract version from payload for comparison
                let target_version = payload.get("version").and_then(|v| v.as_str()).map(|s| s.to_string());

                // Trigger update in background to allow sending response first
                let client_clone = Arc::new(self.clone_for_update());
                tokio::spawn(async move {
                    tokio::time::sleep(Duration::from_secs(1)).await; // Brief delay for response delivery
                    if let Err(e) = client_clone.self_update(target_version).await {
                        error!("Self-update failed: {}", e);
                    }
                });
                (true, None, serde_json::json!({"message": "Update initiated"}))
            }
            "ping" => (true, None, serde_json::json!({"pong": true})),
            "getDiagnostics" => {
                // Generate fresh hardware dump and return as response
                info!("Generating fresh hardware diagnostics for remote request");
                match self.hardware_monitor.dump_hardware_info().await {
                    Ok(dump) => {
                        match serde_json::to_value(&dump) {
                            Ok(json_value) => (true, None, json_value),
                            Err(e) => (false, Some(format!("Failed to serialize diagnostics: {}", e)), serde_json::json!({})),
                        }
                    }
                    Err(e) => (false, Some(format!("Failed to generate diagnostics: {}", e)), serde_json::json!({})),
                }
            }
            _ => {
                warn!("Unknown command: {}", command_type);
                (false, Some(format!("Unknown command: {}", command_type)), serde_json::json!({}))
            }
        };

        // Send command response back to backend
        {
            let mut response = serde_json::json!({
                "type": "commandResponse",
                "commandId": command_id,
                "success": success,
                "data": result_data,
                "timestamp": chrono::Utc::now().timestamp_millis()
            });

            if !success {
                if let Some(err) = error_msg {
                    response["error"] = serde_json::Value::String(err);
                }
            }

            write.send(Message::Text(response.to_string())).await?;
            debug!("Sent command response: {}, success: {}", command_id, success);
        }

        Ok(())
    }

    pub(crate) async fn set_update_interval(&self, interval: f64) -> Result<()> {
        // Validate using SST values (generated from ui-options.json at compile time)
        if !VALID_UPDATE_INTERVALS.contains(&interval) {
            return Err(anyhow::anyhow!("Invalid interval: {}. Must be one of: {:?}", interval, VALID_UPDATE_INTERVALS));
        }

        // Get write lock, update quickly, release lock
        let old_interval;
        {
            let mut config = self.config.write().await;
            old_interval = config.agent.update_interval;
            config.agent.update_interval = interval;
        } // Lock released here

        // Perform I/O outside of lock
        let config_path = std::env::current_exe()?
            .parent()
            .ok_or_else(|| anyhow::anyhow!("Cannot determine executable directory"))?
            .join("config.json");

        save_config(&*self.config.read().await, config_path.to_str().unwrap()).await?;

        info!("Update interval changed: {}s → {}s (saved to config)", old_interval, interval);
        Ok(())
    }

    pub(crate) async fn set_fan_step(&self, step: u8) -> Result<()> {
        // Validate using SST values (generated from ui-options.json at compile time)
        if !VALID_FAN_STEPS.contains(&step) {
            return Err(anyhow::anyhow!("Invalid fan step: {}. Must be one of: {:?}", step, VALID_FAN_STEPS));
        }

        // Update config quickly with minimal lock time
        {
            let mut config = self.config.write().await;
            config.hardware.fan_step_percent = step;
        } // Lock released here

        // Perform I/O outside of lock
        let config_path = std::env::current_exe()?
            .parent()
            .ok_or_else(|| anyhow::anyhow!("Cannot determine executable directory"))?
            .join("config.json");

        save_config(&*self.config.read().await, config_path.to_str().unwrap()).await?;

        info!("✏️  Fan Step changed → {}%", step);
        Ok(())
    }

    pub(crate) async fn set_hysteresis(&self, hysteresis: f64) -> Result<()> {
        // Validate using SST values (generated from ui-options.json at compile time)
        if !VALID_HYSTERESIS.contains(&hysteresis) {
            return Err(anyhow::anyhow!("Invalid hysteresis: {}. Must be one of: {:?}", hysteresis, VALID_HYSTERESIS));
        }

        // Update config quickly with minimal lock time
        {
            let mut config = self.config.write().await;
            config.hardware.hysteresis_temp = hysteresis;
        } // Lock released here

        // Perform I/O outside of lock
        let config_path = std::env::current_exe()?
            .parent()
            .ok_or_else(|| anyhow::anyhow!("Cannot determine executable directory"))?
            .join("config.json");

        save_config(&*self.config.read().await, config_path.to_str().unwrap()).await?;

        info!("✏️  Hysteresis changed → {}°C", hysteresis);
        Ok(())
    }

    pub(crate) async fn set_emergency_temp(&self, temp: f64) -> Result<()> {
        // Validate using SST values (generated from ui-options.json at compile time)
        let temp_u8 = temp as u8;
        if !VALID_EMERGENCY_TEMPS.contains(&temp_u8) {
            return Err(anyhow::anyhow!("Invalid emergency temp: {}. Must be one of: {:?}", temp, VALID_EMERGENCY_TEMPS));
        }

        // Update config quickly with minimal lock time
        {
            let mut config = self.config.write().await;
            config.hardware.emergency_temp = temp;
        } // Lock released here

        // Perform I/O outside of lock
        let config_path = std::env::current_exe()?
            .parent()
            .ok_or_else(|| anyhow::anyhow!("Cannot determine executable directory"))?
            .join("config.json");

        save_config(&*self.config.read().await, config_path.to_str().unwrap()).await?;

        info!("✏️  Emergency Temp changed → {}°C", temp);
        Ok(())
    }

    pub(crate) async fn set_log_level(&self, level: &str) -> Result<()> {
        // Validate using SST values (generated from ui-options.json at compile time)
        let level_upper = level.to_uppercase();
        if !VALID_LOG_LEVELS.iter().any(|l| l.eq_ignore_ascii_case(&level_upper)) {
            return Err(anyhow::anyhow!(
                "Invalid log level '{}'. Valid levels: {:?}",
                level, VALID_LOG_LEVELS
            ));
        }
        let level_lower = level.to_lowercase();

        // Update config quickly with minimal lock time
        let old_level;
        {
            let mut config = self.config.write().await;
            old_level = config.agent.log_level.clone();
            config.agent.log_level = level.to_uppercase();
        } // Lock released here

        // Perform I/O outside of lock
        let config_path = std::env::current_exe()?
            .parent()
            .ok_or_else(|| anyhow::anyhow!("Cannot determine executable directory"))?
            .join("config.json");

        save_config(&*self.config.read().await, config_path.to_str().unwrap()).await?;

        // Reload the tracing filter dynamically
        let filter = match level_lower.as_str() {
            "critical" => "error",
            "trace" => "trace",
            "debug" => "debug",
            "info" => "info",
            "warn" => "warn",
            "error" => "error",
            _ => "info",
        };

        if let Some(handle) = RELOAD_HANDLE.get() {
            match handle.reload(EnvFilter::new(filter)) {
                Ok(_) => info!("✏️  Log Level changed: {} → {}", old_level, level.to_uppercase()),
                Err(e) => error!("Failed to reload log level filter: {}", e),
            }
        } else {
            warn!("✏️  Log Level changed: {} → {} (filter reload unavailable)", old_level, level.to_uppercase());
        }

        Ok(())
    }

    pub(crate) async fn set_failsafe_speed(&self, speed: u8) -> Result<()> {
        // Validate using SST values (generated from ui-options.json at compile time)
        if !VALID_FAILSAFE_SPEEDS.contains(&speed) {
            return Err(anyhow::anyhow!("Invalid failsafe speed: {}. Must be one of: {:?}", speed, VALID_FAILSAFE_SPEEDS));
        }

        // Update config quickly with minimal lock time
        let old_speed;
        {
            let mut config = self.config.write().await;
            old_speed = config.hardware.failsafe_speed;
            config.hardware.failsafe_speed = speed;
        } // Lock released here

        // Perform I/O outside of lock
        let config_path = std::env::current_exe()?
            .parent()
            .ok_or_else(|| anyhow::anyhow!("Cannot determine executable directory"))?
            .join("config.json");

        save_config(&*self.config.read().await, config_path.to_str().unwrap()).await?;

        info!("✏️  Failsafe Speed changed: {}% → {}%", old_speed, speed);
        Ok(())
    }

    pub(crate) async fn set_enable_fan_control(&self, enabled: bool) -> Result<()> {
        // Update config quickly with minimal lock time
        let old_enabled;
        {
            let mut config = self.config.write().await;
            old_enabled = config.hardware.enable_fan_control;
            config.hardware.enable_fan_control = enabled;
        } // Lock released here

        // Perform I/O outside of lock
        let config_path = std::env::current_exe()?
            .parent()
            .ok_or_else(|| anyhow::anyhow!("Cannot determine executable directory"))?
            .join("config.json");

        save_config(&*self.config.read().await, config_path.to_str().unwrap()).await?;

        let status = if enabled { "enabled" } else { "disabled" };
        let old_status = if old_enabled { "enabled" } else { "disabled" };
        info!("✏️  Fan Control changed: {} → {}", old_status, status);
        Ok(())
    }

    pub(crate) async fn set_agent_name(&self, name: &str) -> Result<()> {
        // Validate name
        let trimmed_name = name.trim();
        if trimmed_name.is_empty() {
            return Err(anyhow::anyhow!("Agent name cannot be empty"));
        }
        if trimmed_name.len() > 255 {
            return Err(anyhow::anyhow!("Agent name must be 255 characters or less"));
        }

        // Update config quickly with minimal lock time
        let old_name;
        {
            let mut config = self.config.write().await;
            old_name = config.agent.name.clone();
            config.agent.name = trimmed_name.to_string();
        } // Lock released here

        // Perform I/O outside of lock
        let config_path = std::env::current_exe()?
            .parent()
            .ok_or_else(|| anyhow::anyhow!("Cannot determine executable directory"))?
            .join("config.json");

        save_config(&*self.config.read().await, config_path.to_str().unwrap()).await?;

        info!("✏️  Agent Name changed: {} → {}", old_name, trimmed_name);
        Ok(())
    }
}
