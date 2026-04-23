//! Outbound WebSocket messages: registration and telemetry data.

use anyhow::Result;
use futures_util::SinkExt;
use std::sync::Arc;
use tokio::sync::{Mutex, RwLock};
use tokio_tungstenite::tungstenite::protocol::Message;
use tracing::{debug, info};

use crate::config::types::AgentConfig;
use crate::hardware::HardwareMonitor;

use super::client::WsSink;

/// Edge-triggered error reporting: send `{type:"error"}` to backend only on
/// transition (when the message differs from the last one we reported). Prevents
/// spam during retry loops while init is broken.
async fn report_error_if_new(
    write: &mut WsSink,
    last_reported_error: &Arc<Mutex<Option<String>>>,
    error_msg: &str,
) -> Result<()> {
    let mut last = last_reported_error.lock().await;
    if last.as_deref() == Some(error_msg) {
        return Ok(());
    }
    let payload = serde_json::json!({
        "type": "error",
        "data": { "message": error_msg }
    });
    write.send(Message::Text(payload.to_string())).await?;
    *last = Some(error_msg.to_string());
    Ok(())
}

/// Clear the dedup state so the next error (if any) is reported.
async fn clear_reported_error(last_reported_error: &Arc<Mutex<Option<String>>>) {
    *last_reported_error.lock().await = None;
}

impl super::client::WebSocketClient {
    pub(crate) async fn send_registration(&self, write: &mut WsSink) -> Result<()> {
        let sensors = self.hardware_monitor.discover_sensors().await?;
        let fans = self.hardware_monitor.discover_fans().await?;

        let config = self.config.read().await;
        let registration = serde_json::json!({
            "type": "register",
            "data": {
                "agentId": config.agent.id,
                "name": config.agent.name,
                "agent_type": "os_linux",
                "agent_version": env!("CARGO_PKG_VERSION"),
                "platform": std::env::consts::OS, // "linux", "macos", "windows", etc.
                "architecture": crate::app::platform::project_arch(),
                "update_interval": config.agent.update_interval as u64, // Send in seconds to match frontend/backend format
                "fan_step_percent": config.hardware.fan_step_percent,
                "hysteresis_temp": config.hardware.hysteresis_temp,
                "emergency_temp": config.hardware.emergency_temp,
                "failsafe_speed": config.hardware.failsafe_speed,
                "log_level": config.agent.log_level.clone(),
                "capabilities": {
                    "sensors": sensors,
                    "fans": fans,
                    "fan_control": config.hardware.enable_fan_control
                }
            }
        });

        write.send(Message::Text(registration.to_string())).await?;
        info!("✅ Agent registered: {}", config.agent.id);
        Ok(())
    }

    pub(crate) async fn send_data(
        write: &mut WsSink,
        config: &Arc<RwLock<AgentConfig>>,
        hardware_monitor: &Arc<dyn HardwareMonitor>,
        last_reported_error: &Arc<Mutex<Option<String>>>,
    ) -> Result<()> {
        use tracing::trace;

        trace!("Starting hardware data collection");

        // On discover/get_system_info failure: emit an edge-triggered error
        // report to the backend, then return Err so P1's retry/escalate logic
        // still kicks in. OS agent discover rarely fails in practice (malformed
        // sensors are skipped per-entry), but sysfs permission errors and total
        // hwmon failures can still surface here - surfacing the cause before
        // the WS close lets the UI show a red Error badge instead of silent
        // offline.
        let sensors = match hardware_monitor.discover_sensors().await {
            Ok(s) => s,
            Err(e) => {
                let msg = format!("Sensor discovery failed: {}", e);
                let _ = report_error_if_new(write, last_reported_error, &msg).await;
                return Err(e);
            }
        };
        trace!("Collected {} sensors", sensors.len());

        let fans = match hardware_monitor.discover_fans().await {
            Ok(f) => f,
            Err(e) => {
                let msg = format!("Fan discovery failed: {}", e);
                let _ = report_error_if_new(write, last_reported_error, &msg).await;
                return Err(e);
            }
        };
        trace!("Collected {} fans", fans.len());

        let system_health = match hardware_monitor.get_system_info().await {
            Ok(h) => h,
            Err(e) => {
                let msg = format!("System info collection failed: {}", e);
                let _ = report_error_if_new(write, last_reported_error, &msg).await;
                return Err(e);
            }
        };
        trace!("Collected system health info");

        let config_read = config.read().await;
        let timestamp = chrono::Utc::now().timestamp_millis();
        let data = serde_json::json!({
            "type": "data",
            "data": {
                "agentId": config_read.agent.id,
                "timestamp": timestamp,
                "sensors": sensors,
                "fans": fans,
                "systemHealth": system_health
            }
        });

        trace!("Sending WebSocket message (timestamp: {})", timestamp);
        write.send(Message::Text(data.to_string())).await?;

        // Success - clear dedup so the next failure (if any) is reported fresh.
        clear_reported_error(last_reported_error).await;

        // Log with cache status indicator
        let from_cache = hardware_monitor.last_discovery_from_cache().await;
        let source = if from_cache { "from cache" } else { "from hardware" };
        debug!("Sent telemetry: {} sensors, {} fans ({})", sensors.len(), fans.len(), source);
        Ok(())
    }
}
