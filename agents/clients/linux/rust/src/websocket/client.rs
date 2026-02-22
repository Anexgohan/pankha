//! WebSocket client: connection lifecycle, failsafe mode, and message dispatch.

use anyhow::{Context, Result};
use futures_util::{SinkExt, StreamExt};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::RwLock;
use tokio::time;
use tokio_tungstenite::{connect_async, tungstenite::protocol::Message};
use tracing::{debug, error, info, warn};

use crate::config::types::AgentConfig;
use crate::hardware::HardwareMonitor;

/// Type alias for the WebSocket write half (used across websocket submodules).
pub(crate) type WsSink = futures_util::stream::SplitSink<
    tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
    Message,
>;

pub struct WebSocketClient {
    pub(crate) config: Arc<RwLock<AgentConfig>>,
    pub(crate) hardware_monitor: Arc<dyn HardwareMonitor>,
    pub(crate) running: Arc<RwLock<bool>>,
    // Failsafe mode tracking - activates when disconnected from backend
    pub(crate) failsafe_active: Arc<RwLock<bool>>,
}

impl WebSocketClient {
    pub fn new(config: AgentConfig, hardware_monitor: Arc<dyn HardwareMonitor>) -> Self {
        Self {
            config: Arc::new(RwLock::new(config)),
            hardware_monitor,
            running: Arc::new(RwLock::new(false)),
            failsafe_active: Arc::new(RwLock::new(false)),
        }
    }

    /// Enter failsafe mode - set all fans to failsafe speed and enable local temp monitoring
    async fn enter_failsafe_mode(&self) -> Result<()> {
        let mut failsafe = self.failsafe_active.write().await;
        if *failsafe {
            return Ok(()); // Already in failsafe mode
        }
        *failsafe = true;
        drop(failsafe);

        // Read configurable failsafe speed
        let config = self.config.read().await;
        let failsafe_speed = config.hardware.failsafe_speed;
        drop(config);

        warn!("⚠️ ENTERING FAILSAFE MODE - Backend disconnected");
        warn!("Setting all fans to {}% (failsafe speed)", failsafe_speed);

        // Set all fans to failsafe speed
        if let Err(e) = self.set_all_fans_to_speed(failsafe_speed).await {
            error!("Failed to set failsafe fan speed: {}", e);
        }

        Ok(())
    }

    /// Exit failsafe mode - backend connection restored
    async fn exit_failsafe_mode(&self) {
        let mut failsafe = self.failsafe_active.write().await;
        if *failsafe {
            *failsafe = false;
            info!("✅ EXITING FAILSAFE MODE - Backend connection restored");
            info!("Backend will resume fan control");
        }
    }

    /// Set all fans to a specific speed percentage
    async fn set_all_fans_to_speed(&self, speed: u8) -> Result<()> {
        let fans = self.hardware_monitor.discover_fans().await?;
        let mut success_count = 0;
        let mut fail_count = 0;

        for fan in fans.iter() {
            match self.hardware_monitor.set_fan_speed(&fan.id, speed).await {
                Ok(_) => {
                    debug!("Set fan {} to {}%", fan.id, speed);
                    success_count += 1;
                }
                Err(e) => {
                    error!("Failed to set fan {} to {}%: {}", fan.id, speed, e);
                    fail_count += 1;
                }
            }
        }

        info!("Fan speed set to {}%: {} succeeded, {} failed", speed, success_count, fail_count);
        Ok(())
    }

    /// Check emergency temperature while in failsafe mode
    /// If any sensor >= emergency_temp, set all fans to 100%
    async fn check_emergency_temp(&self) -> Result<()> {
        let config = self.config.read().await;
        let emergency_temp = config.hardware.emergency_temp;
        drop(config);

        // Read current sensor temps
        let sensors = self.hardware_monitor.discover_sensors().await?;
        let max_temp = sensors.iter()
            .map(|s| s.temperature)
            .max_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal))
            .unwrap_or(0.0);

        // If emergency temp reached, override to 100%
        if max_temp >= emergency_temp {
            warn!("🚨 FAILSAFE EMERGENCY: {:.1}°C >= {:.1}°C threshold - ALL FANS TO 100%",
                  max_temp, emergency_temp);
            self.hardware_monitor.emergency_stop().await?;
        }

        Ok(())
    }

    /// Run failsafe checks during disconnected period
    async fn run_failsafe_check(&self) {
        if *self.failsafe_active.read().await {
            if let Err(e) = self.check_emergency_temp().await {
                error!("Failed to check emergency temp in failsafe mode: {}", e);
            }
        }
    }

    pub async fn run(&self) -> Result<()> {
        *self.running.write().await = true;
        let mut retry_count = 0;

        loop {
            if !*self.running.read().await {
                break;
            }

            match self.connect_and_communicate().await {
                Ok(_) => {
                    info!("WebSocket connection closed normally");
                    retry_count = 0; // Reset on successful connection
                }
                Err(e) => error!("WebSocket error: {}", e),
            }

            // Connection lost or failed - enter failsafe mode
            if let Err(e) = self.enter_failsafe_mode().await {
                error!("Failed to enter failsafe mode: {}", e);
            }

            if *self.running.read().await {
                let config = self.config.read().await;
                // Hardware-safe exponential backoff: max 15s to prevent thermal issues
                let base_interval = config.backend.reconnect_interval;
                let wait_time = match retry_count {
                    0 => base_interval,           // 5s (first retry)
                    1 => base_interval * 1.4,     // 7s (second retry)
                    2 => base_interval * 2.0,     // 10s (third retry)
                    _ => base_interval * 3.0,     // 15s (max - hardware safety)
                };
                let update_interval = config.agent.update_interval;
                drop(config);
                retry_count = (retry_count + 1).min(3);

                info!("Reconnecting in {:.1}s... (attempt {})", wait_time, retry_count);

                // During reconnection wait, periodically check emergency temps
                // Check every update_interval seconds (same as normal data cycle)
                let wait_duration = Duration::from_secs_f64(wait_time);
                let check_interval = Duration::from_secs_f64(update_interval);
                let start = std::time::Instant::now();

                while start.elapsed() < wait_duration {
                    if !*self.running.read().await {
                        break;
                    }

                    // Run failsafe check (monitors emergency_temp)
                    self.run_failsafe_check().await;

                    // Sleep for check interval or remaining time, whichever is shorter
                    let remaining = wait_duration.saturating_sub(start.elapsed());
                    let sleep_time = check_interval.min(remaining);
                    if sleep_time > Duration::ZERO {
                        time::sleep(sleep_time).await;
                    }
                }
            }
        }

        Ok(())
    }

    async fn connect_and_communicate(&self) -> Result<()> {
        use tracing::trace;

        trace!("Acquiring config lock for connection");
        let config = self.config.read().await;
        info!("Connecting to WebSocket: {}", config.backend.server_url);
        trace!("Connection timeout: {}s", config.backend.connection_timeout);

        // Apply connection timeout to prevent hanging connections
        let timeout_duration = Duration::from_secs_f64(config.backend.connection_timeout);
        let connect_future = connect_async(&config.backend.server_url);

        let (ws_stream, _) = tokio::time::timeout(timeout_duration, connect_future)
            .await
            .context("Connection timeout")??;
        drop(config); // Release read lock
        info!("✅ WebSocket connected");

        // Exit failsafe mode - backend connection restored
        self.exit_failsafe_mode().await;

        // Invalidate hardware cache on connection/reconnection to ensure fresh discovery
        self.hardware_monitor.invalidate_cache().await;

        let (write, read) = ws_stream.split();
        let write = Arc::new(tokio::sync::Mutex::new(write));

        // Send registration
        {
            let mut w = write.lock().await;
            self.send_registration(&mut *w).await?;
        }

        // Start data sender task
        let config = Arc::clone(&self.config);
        let hardware_monitor = Arc::clone(&self.hardware_monitor);
        let running = Arc::clone(&self.running);
        let write_clone = Arc::clone(&write);

        let data_sender = tokio::spawn(async move {
            let mut heartbeat_counter = 0;
            while *running.read().await {
                let mut w = write_clone.lock().await;
                if let Err(e) = Self::send_data(&mut *w, &config, &hardware_monitor).await {
                    error!("Failed to send data: {}", e);
                    break;
                }
                drop(w);

                // Heartbeat logging: only in DEBUG mode, every 20 cycles (60s at 3s intervals)
                heartbeat_counter += 1;
                if heartbeat_counter % 20 == 0 {
                    debug!("Data transmissions: {} completed", heartbeat_counter);
                }

                let interval = config.read().await.agent.update_interval;
                time::sleep(Duration::from_secs_f64(interval)).await;
            }
        });

        // Connection health tracking: detect stale connections
        // This prevents "half-open" TCP connections where we can send but not receive
        let mut last_message_received = std::time::Instant::now();
        const CONNECTION_HEALTH_TIMEOUT_SECS: u64 = 30; // If no message for 30s, reconnect

        // Handle incoming messages with timeout to allow checking shutdown signal
        let mut read = read;
        loop {
            // Check if we should shut down
            if !*self.running.read().await {
                info!("Shutdown requested, closing WebSocket");
                break;
            }

            // Check connection health: if no message received for too long, assume connection is dead
            let elapsed_since_last_message = last_message_received.elapsed();
            if elapsed_since_last_message.as_secs() > CONNECTION_HEALTH_TIMEOUT_SECS {
                warn!(
                    "Connection health check failed: no message received for {}s, reconnecting",
                    elapsed_since_last_message.as_secs()
                );
                break; // Trigger reconnection
            }

            // Read with timeout to periodically check shutdown flag and connection health
            let timeout = time::timeout(Duration::from_secs(1), read.next()).await;

            match timeout {
                Ok(Some(msg)) => {
                    match msg {
                        Ok(Message::Text(text)) => {
                            // Update last message time on successful receive
                            last_message_received = std::time::Instant::now();
                            let mut w = write.lock().await;
                            if let Err(e) = self.handle_message(&text, &mut *w).await {
                                error!("Failed to handle message: {}", e);
                            }
                        }
                        Ok(Message::Ping(_)) | Ok(Message::Pong(_)) => {
                            // Update last message time on ping/pong
                            last_message_received = std::time::Instant::now();
                            debug!("Received keepalive ping/pong");
                        }
                        Ok(Message::Close(_)) => {
                            info!("Server closed connection");
                            break;
                        }
                        Err(e) => {
                            error!("WebSocket error: {}", e);
                            break;
                        }
                        _ => {
                            // Update last message time for any valid message
                            last_message_received = std::time::Instant::now();
                        }
                    }
                }
                Ok(None) => {
                    info!("WebSocket stream ended");
                    break;
                }
                Err(_) => {
                    // Timeout - loop back to check shutdown flag and connection health
                    continue;
                }
            }
        }

        data_sender.abort();
        match data_sender.await {
            Ok(_) => debug!("Data sender task completed"),
            Err(e) if e.is_cancelled() => debug!("Data sender task cancelled"),
            Err(e) => error!("Data sender task error: {}", e),
        }
        Ok(())
    }

    async fn handle_message(&self, text: &str, write: &mut WsSink) -> Result<()> {
        use tracing::trace;

        trace!("Received message: {} bytes", text.len());
        let message: serde_json::Value = serde_json::from_str(text)?;
        trace!("Parsed message type: {:?}", message.get("type"));

        if let Some(msg_type) = message.get("type").and_then(|v| v.as_str()) {
            match msg_type {
                "command" => {
                    if let Some(data) = message.get("data") {
                        self.handle_command(data, write).await?;
                    }
                }
                "ping" => {
                    // Respond to ping
                    let pong = serde_json::json!({
                        "type": "pong",
                        "timestamp": chrono::Utc::now().timestamp_millis()
                    });
                    write.send(Message::Text(pong.to_string())).await?;
                }
                "registered" => {
                    info!("Agent successfully registered with backend");

                    // Cleanup after successful update (if applicable)
                    if let Ok(current_exe) = std::env::current_exe() {
                        if let Some(exe_dir) = current_exe.parent() {
                            let update_marker = exe_dir.join(".update_pending");
                            let old_binary = current_exe.with_extension("old");

                            if update_marker.exists() {
                                info!("Update verified successful, cleaning up...");
                                if let Err(e) = std::fs::remove_file(&update_marker) {
                                    warn!("Failed to remove update marker: {}", e);
                                }
                                if old_binary.exists() {
                                    if let Err(e) = std::fs::remove_file(&old_binary) {
                                        warn!("Failed to remove old binary: {}", e);
                                    } else {
                                        info!("Old binary removed, update complete");
                                    }
                                }
                            }
                        }
                    }

                    // Apply configuration from registration response
                    if let Some(config) = message.get("configuration") {
                        info!("Applying configuration from server");

                        // Apply update_interval
                        if let Some(interval) = config.get("update_interval").and_then(|v| v.as_f64()) {
                            if let Err(e) = self.set_update_interval(interval).await {
                                error!("Failed to apply update_interval: {}", e);
                            } else {
                                info!("Applied update_interval: {}s", interval);
                            }
                        }

                        // Apply fan_step_percent
                        if let Some(step) = config.get("fan_step_percent").and_then(|v| v.as_f64()) {
                            if let Err(e) = self.set_fan_step(step.round() as u8).await {
                                error!("Failed to apply fan_step_percent: {}", e);
                            } else {
                                info!("Applied fan_step_percent: {}%", step);
                            }
                        }

                        // Apply hysteresis_temp
                        if let Some(hysteresis) = config.get("hysteresis_temp").and_then(|v| v.as_f64()) {
                            if let Err(e) = self.set_hysteresis(hysteresis).await {
                                error!("Failed to apply hysteresis_temp: {}", e);
                            } else {
                                info!("Applied hysteresis_temp: {}°C", hysteresis);
                            }
                        }

                        // Apply emergency_temp
                        if let Some(temp) = config.get("emergency_temp").and_then(|v| v.as_f64()) {
                            if let Err(e) = self.set_emergency_temp(temp).await {
                                error!("Failed to apply emergency_temp: {}", e);
                            } else {
                                info!("Applied emergency_temp: {}°C", temp);
                            }
                        }

                        // Apply log_level
                        if let Some(level) = config.get("log_level").and_then(|v| v.as_str()) {
                            if let Err(e) = self.set_log_level(level).await {
                                error!("Failed to apply log_level: {}", e);
                            } else {
                                info!("Applied log_level: {}", level);
                            }
                        }
                    }
                }
                _ => {
                    debug!("Received message type: {}", msg_type);
                }
            }
        }

        Ok(())
    }

    pub async fn stop(&self) {
        *self.running.write().await = false;
    }
}
