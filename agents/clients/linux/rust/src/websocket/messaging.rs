//! Outbound WebSocket messages: registration and telemetry data.

use anyhow::Result;
use futures_util::SinkExt;
use std::sync::Arc;
use tokio::sync::RwLock;
use tokio_tungstenite::tungstenite::protocol::Message;
use tracing::{debug, info};

use crate::config::types::AgentConfig;
use crate::hardware::HardwareMonitor;

use super::client::WsSink;

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
                "agent_version": env!("CARGO_PKG_VERSION"),
                "platform": std::env::consts::OS, // "linux", "macos", "windows", etc.
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
        hardware_monitor: &Arc<dyn HardwareMonitor>
    ) -> Result<()> {
        use tracing::trace;

        trace!("Starting hardware data collection");
        let sensors = hardware_monitor.discover_sensors().await?;
        trace!("Collected {} sensors", sensors.len());

        let fans = hardware_monitor.discover_fans().await?;
        trace!("Collected {} fans", fans.len());

        let system_health = hardware_monitor.get_system_info().await?;
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

        // Log with cache status indicator
        let from_cache = hardware_monitor.last_discovery_from_cache().await;
        let source = if from_cache { "from cache" } else { "from hardware" };
        debug!("Sent telemetry: {} sensors, {} fans ({})", sensors.len(), fans.len(), source);
        Ok(())
    }
}
