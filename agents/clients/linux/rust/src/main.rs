//! Pankha Cross-Platform Agent
//!
//! High-performance hardware monitoring and fan control agent written in Rust.
//! Supports Linux, Windows, and macOS with platform-specific implementations.
//!
//! Features:
//! - Dynamic hardware discovery (no hardcoded paths)
//! - Real-time WebSocket communication
//! - Cross-platform abstraction layer
//! - Memory-safe hardware access
//! - Configuration hot-reloading
//! - Automatic reconnection with backoff

use anyhow::{Context, Result};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::RwLock;
use tokio::time;
use tracing::{debug, error, info, warn};

// ============================================================================
// CORE DATA STRUCTURES
// ============================================================================

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

/// Agent configuration
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
    pub fan_safety_minimum: u8,
    pub temperature_critical: f64,
    pub filter_duplicate_sensors: bool,
    pub duplicate_sensor_tolerance: f64,
}

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

        Self {
            agent: AgentSettings {
                id: format!("rust-agent-{}", hostname), // changes:should be OS-hostname-UUID, if config file missing, if config file present, use that ID
                name: format!("Rust System ({})", hostname), // changes:should just be the hostname
                update_interval: 3.0,
                log_level: "INFO".to_string(),
            },
            backend: BackendSettings {
                server_url: "ws://192.168.100.237:3000/websocket".to_string(),
                reconnect_interval: 5.0,
                max_reconnect_attempts: -1,
                connection_timeout: 10.0,
            },
            hardware: HardwareSettings {
                enable_fan_control: true,
                enable_sensor_monitoring: true,
                fan_safety_minimum: 10,
                temperature_critical: 85.0,
                filter_duplicate_sensors: true,
                duplicate_sensor_tolerance: 0.5,
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

// ============================================================================
// HARDWARE MONITOR TRAIT (Platform Abstraction)
// ============================================================================

#[async_trait]
pub trait HardwareMonitor: Send + Sync {
    /// Discover all available temperature sensors
    async fn discover_sensors(&self) -> Result<Vec<Sensor>>;

    /// Discover all available fans
    async fn discover_fans(&self) -> Result<Vec<Fan>>;

    /// Get current system information
    async fn get_system_info(&self) -> Result<SystemHealth>;

    /// Set fan speed (0-100%)
    async fn set_fan_speed(&self, fan_id: &str, speed: u8) -> Result<()>;

    /// Emergency stop - set all fans to maximum
    async fn emergency_stop(&self) -> Result<()>;
}

// ============================================================================
// LINUX HARDWARE MONITOR IMPLEMENTATION
// ============================================================================

#[cfg(target_os = "linux")]
pub struct LinuxHardwareMonitor {
    hwmon_base: PathBuf,
    thermal_base: PathBuf,
    discovered_fans: Arc<RwLock<HashMap<String, FanInfo>>>,
    config: HardwareSettings,
}

#[cfg(target_os = "linux")]
struct FanInfo {
    pwm_path: PathBuf,
    rpm_path: PathBuf,
    pwm_enable_path: Option<PathBuf>,
    chip_name: String,
}

#[cfg(target_os = "linux")]
impl LinuxHardwareMonitor {
    pub fn new(config: HardwareSettings) -> Self {
        Self {
            hwmon_base: PathBuf::from("/sys/class/hwmon"),
            thermal_base: PathBuf::from("/sys/class/thermal"),
            discovered_fans: Arc::new(RwLock::new(HashMap::new())),
            config,
        }
    }

    async fn read_file(&self, path: &Path) -> Result<String> {
        tokio::fs::read_to_string(path)
            .await
            .context(format!("Failed to read file: {:?}", path))
            .map(|s| s.trim().to_string())
    }

    async fn write_file(&self, path: &Path, value: &str) -> Result<()> {
        tokio::fs::write(path, value)
            .await
            .context(format!("Failed to write to file: {:?}", path))
    }

    async fn discover_hwmon_sensors(&self) -> Result<Vec<Sensor>> {
        let mut sensors = Vec::new();

        if !self.hwmon_base.exists() {
            return Ok(sensors);
        }

        let mut entries = tokio::fs::read_dir(&self.hwmon_base).await?;

        while let Some(entry) = entries.next_entry().await? {
            let hwmon_dir = entry.path();
            if !hwmon_dir.is_dir() {
                continue;
            }

            // Get chip name
            let chip_name = match self.read_file(&hwmon_dir.join("name")).await {
                Ok(name) => name,
                Err(_) => continue,
            };

            // Find temperature inputs
            let pattern = hwmon_dir.join("temp*_input");
            let pattern_str = pattern.to_string_lossy();

            for temp_file in glob::glob(&pattern_str).unwrap().filter_map(Result::ok) {
                if let Ok(sensor) = self.parse_hwmon_sensor(&hwmon_dir, &temp_file, &chip_name).await {
                    sensors.push(sensor);
                }
            }
        }

        Ok(sensors)
    }

    async fn parse_hwmon_sensor(&self, hwmon_dir: &Path, temp_file: &Path, chip_name: &str) -> Result<Sensor> {
        let filename = temp_file.file_name().unwrap().to_string_lossy();
        let temp_num = filename.strip_prefix("temp").and_then(|s| s.strip_suffix("_input")).unwrap();

        // Read temperature (millidegrees to celsius)
        let temp_raw: i32 = self.read_file(temp_file).await?.parse()?;
        let temp_celsius = temp_raw as f64 / 1000.0;

        // Try to get label
        let label_path = hwmon_dir.join(format!("temp{}_label", temp_num));
        let sensor_label = self.read_file(&label_path).await
            .unwrap_or_else(|_| format!("Sensor {}", temp_num));

        // Try to get limits
        let max_path = hwmon_dir.join(format!("temp{}_max", temp_num));
        let crit_path = hwmon_dir.join(format!("temp{}_crit", temp_num));

        let max_temp = self.read_file(&max_path).await.ok()
            .and_then(|s| s.parse::<i32>().ok())
            .map(|v| v as f64 / 1000.0);

        let crit_temp = self.read_file(&crit_path).await.ok()
            .and_then(|s| s.parse::<i32>().ok())
            .map(|v| v as f64 / 1000.0);

        let sensor_id = format!("{}_{}", chip_name.to_lowercase().replace(" ", "_"), temp_num);
        let sensor_type = Self::classify_sensor_type(chip_name);

        Ok(Sensor {
            id: sensor_id,
            name: format!("{} {}", chip_name, sensor_label),
            temperature: temp_celsius.round() * 10.0 / 10.0,
            sensor_type,
            max_temp,
            crit_temp,
            chip: Some(chip_name.to_string()),
            source: Some(temp_file.to_string_lossy().to_string()),
        })
    }

    fn classify_sensor_type(chip_name: &str) -> String {
        let chip_lower = chip_name.to_lowercase();
        if chip_lower.contains("k10temp") || chip_lower.contains("coretemp") || chip_lower.contains("cpu") {
            "cpu".to_string()
        } else if chip_lower.contains("nvme") {
            "nvme".to_string()
        } else if chip_lower.contains("it8") || chip_lower.contains("nct") {
            "motherboard".to_string()
        } else if chip_lower.contains("acpi") {
            "acpi".to_string()
        } else {
            "other".to_string()
        }
    }

    async fn discover_hwmon_fans(&self) -> Result<Vec<Fan>> {
        let mut fans = Vec::new();
        let mut fan_map = self.discovered_fans.write().await;
        fan_map.clear();

        if !self.hwmon_base.exists() {
            return Ok(fans);
        }

        let mut entries = tokio::fs::read_dir(&self.hwmon_base).await?;

        while let Some(entry) = entries.next_entry().await? {
            let hwmon_dir = entry.path();
            if !hwmon_dir.is_dir() {
                continue;
            }

            let chip_name = match self.read_file(&hwmon_dir.join("name")).await {
                Ok(name) => name,
                Err(_) => continue,
            };

            // Find fan inputs
            let pattern = hwmon_dir.join("fan*_input");
            let pattern_str = pattern.to_string_lossy();

            for fan_file in glob::glob(&pattern_str).unwrap().filter_map(Result::ok) {
                let filename = fan_file.file_name().unwrap().to_string_lossy();
                let fan_num = filename.strip_prefix("fan").and_then(|s| s.strip_suffix("_input")).unwrap();

                let pwm_path = hwmon_dir.join(format!("pwm{}", fan_num));
                let pwm_enable_path = hwmon_dir.join(format!("pwm{}_enable", fan_num));

                let has_pwm = pwm_path.exists();

                if has_pwm {
                    let fan_id = format!("{}_fan_{}", chip_name.to_lowercase().replace(" ", "_"), fan_num);

                    // Read current RPM
                    let rpm = self.read_file(&fan_file).await.ok()
                        .and_then(|s| s.parse::<u32>().ok());

                    // Read current PWM value
                    let pwm_value = self.read_file(&pwm_path).await.ok()
                        .and_then(|s| s.parse::<u8>().ok())
                        .unwrap_or(128);

                    let speed_percent = (pwm_value as f32 / 255.0 * 100.0) as u8;

                    let fan = Fan {
                        id: fan_id.clone(),
                        name: format!("{} Fan {}", chip_name, fan_num),
                        rpm,
                        speed: speed_percent,
                        target_speed: speed_percent,
                        status: if rpm.unwrap_or(0) > 0 { "ok" } else { "stopped" }.to_string(),
                        has_pwm_control: true,
                        pwm_file: Some(pwm_path.to_string_lossy().to_string()),
                    };

                    // Store fan info for later control
                    fan_map.insert(fan_id.clone(), FanInfo {
                        pwm_path: pwm_path.clone(),
                        rpm_path: fan_file.clone(),
                        pwm_enable_path: if pwm_enable_path.exists() { Some(pwm_enable_path) } else { None },
                        chip_name: chip_name.clone(),
                    });

                    fans.push(fan);
                }
            }
        }

        Ok(fans)
    }
}

#[cfg(target_os = "linux")]
#[async_trait]
impl HardwareMonitor for LinuxHardwareMonitor {
    async fn discover_sensors(&self) -> Result<Vec<Sensor>> {
        let sensors = self.discover_hwmon_sensors().await?;

        // Apply deduplication if enabled
        if self.config.filter_duplicate_sensors {
            Ok(Self::deduplicate_sensors(sensors, self.config.duplicate_sensor_tolerance))
        } else {
            Ok(sensors)
        }
    }

    async fn discover_fans(&self) -> Result<Vec<Fan>> {
        self.discover_hwmon_fans().await
    }

    async fn get_system_info(&self) -> Result<SystemHealth> {
        let mut sys = sysinfo::System::new_all();
        sys.refresh_all();

        let cpu_usage = sys.global_cpu_info().cpu_usage() as f64;
        let memory_usage = (sys.used_memory() as f64 / sys.total_memory() as f64) * 100.0;

        Ok(SystemHealth {
            cpu_usage,
            memory_usage,
            agent_uptime: 0.0, // TODO: Track agent uptime
        })
    }

    async fn set_fan_speed(&self, fan_id: &str, speed: u8) -> Result<()> {
        let speed = speed.min(100);
        let pwm_value = (speed as f32 / 100.0 * 255.0) as u8;

        let fan_map = self.discovered_fans.read().await;
        let fan_info = fan_map.get(fan_id)
            .ok_or_else(|| anyhow::anyhow!("Fan not found: {}", fan_id))?;

        // Enable manual PWM mode if needed
        if let Some(enable_path) = &fan_info.pwm_enable_path {
            let current_enable = self.read_file(enable_path).await.ok();
            if current_enable.as_deref() != Some("1") {
                self.write_file(enable_path, "1").await?;
            }
        }

        // Set PWM value
        self.write_file(&fan_info.pwm_path, &pwm_value.to_string()).await?;

        info!("Set fan {} to {}% (PWM: {})", fan_id, speed, pwm_value);
        Ok(())
    }

    async fn emergency_stop(&self) -> Result<()> {
        let fan_map = self.discovered_fans.read().await;

        for (fan_id, _) in fan_map.iter() {
            if let Err(e) = self.set_fan_speed(fan_id, 100).await {
                error!("Failed to set fan {} to 100%: {}", fan_id, e);
            }
        }

        warn!("EMERGENCY STOP: All fans set to 100%");
        Ok(())
    }
}

#[cfg(target_os = "linux")]
impl LinuxHardwareMonitor {
    fn deduplicate_sensors(sensors: Vec<Sensor>, _tolerance: f64) -> Vec<Sensor> {
        // Group sensors by temperature (within tolerance)
        let mut temp_groups: HashMap<String, Vec<Sensor>> = HashMap::new();

        for sensor in sensors {
            let temp_key = format!("{:.1}", sensor.temperature);
            temp_groups.entry(temp_key).or_insert_with(Vec::new).push(sensor);
        }

        let mut deduplicated = Vec::new();

        for (_temp, group) in temp_groups {
            if group.len() == 1 {
                deduplicated.push(group[0].clone());
            } else {
                // Select best sensor based on chip priority
                let best = Self::select_best_sensor(&group);
                deduplicated.push(best);
            }
        }

        deduplicated
    }

    fn select_best_sensor(sensors: &[Sensor]) -> Sensor {
        let chip_priority = |chip: &str| -> i32 {
            let chip_lower = chip.to_lowercase();
            if chip_lower.contains("k10temp") || chip_lower.contains("coretemp") {
                100
            } else if chip_lower.contains("it8") || chip_lower.contains("nct") {
                90
            } else if chip_lower.contains("nvme") {
                80
            } else if chip_lower.contains("wmi") {
                50
            } else if chip_lower.contains("acpi") {
                40
            } else {
                30
            }
        };

        sensors.iter()
            .max_by_key(|s| chip_priority(s.chip.as_deref().unwrap_or("")))
            .cloned()
            .unwrap()
    }
}

// ============================================================================
// WINDOWS HARDWARE MONITOR STUB
// ============================================================================

#[cfg(target_os = "windows")]
pub struct WindowsHardwareMonitor {
    config: HardwareSettings,
}

#[cfg(target_os = "windows")]
impl WindowsHardwareMonitor {
    pub fn new(config: HardwareSettings) -> Self {
        Self { config }
    }
}

#[cfg(target_os = "windows")]
#[async_trait]
impl HardwareMonitor for WindowsHardwareMonitor {
    async fn discover_sensors(&self) -> Result<Vec<Sensor>> {
        // TODO: Implement Windows WMI sensor discovery
        warn!("Windows sensor discovery not yet implemented");
        Ok(Vec::new())
    }

    async fn discover_fans(&self) -> Result<Vec<Fan>> {
        // TODO: Implement Windows fan discovery
        warn!("Windows fan discovery not yet implemented");
        Ok(Vec::new())
    }

    async fn get_system_info(&self) -> Result<SystemHealth> {
        let mut sys = sysinfo::System::new_all();
        sys.refresh_all();

        Ok(SystemHealth {
            cpu_usage: sys.global_cpu_info().cpu_usage() as f64,
            memory_usage: (sys.used_memory() as f64 / sys.total_memory() as f64) * 100.0,
            agent_uptime: 0.0,
        })
    }

    async fn set_fan_speed(&self, _fan_id: &str, _speed: u8) -> Result<()> {
        Err(anyhow::anyhow!("Windows fan control not yet implemented"))
    }

    async fn emergency_stop(&self) -> Result<()> {
        Err(anyhow::anyhow!("Windows fan control not yet implemented"))
    }
}

// ============================================================================
// MACOS HARDWARE MONITOR STUB
// ============================================================================

#[cfg(target_os = "macos")]
pub struct MacOSHardwareMonitor {
    config: HardwareSettings,
}

#[cfg(target_os = "macos")]
impl MacOSHardwareMonitor {
    pub fn new(config: HardwareSettings) -> Self {
        Self { config }
    }
}

#[cfg(target_os = "macos")]
#[async_trait]
impl HardwareMonitor for MacOSHardwareMonitor {
    async fn discover_sensors(&self) -> Result<Vec<Sensor>> {
        // TODO: Implement macOS IOKit sensor discovery
        warn!("macOS sensor discovery not yet implemented");
        Ok(Vec::new())
    }

    async fn discover_fans(&self) -> Result<Vec<Fan>> {
        // TODO: Implement macOS fan discovery
        warn!("macOS fan discovery not yet implemented");
        Ok(Vec::new())
    }

    async fn get_system_info(&self) -> Result<SystemHealth> {
        let mut sys = sysinfo::System::new_all();
        sys.refresh_all();

        Ok(SystemHealth {
            cpu_usage: sys.global_cpu_info().cpu_usage() as f64,
            memory_usage: (sys.used_memory() as f64 / sys.total_memory() as f64) * 100.0,
            agent_uptime: 0.0,
        })
    }

    async fn set_fan_speed(&self, _fan_id: &str, _speed: u8) -> Result<()> {
        Err(anyhow::anyhow!("macOS fan control not yet implemented"))
    }

    async fn emergency_stop(&self) -> Result<()> {
        Err(anyhow::anyhow!("macOS fan control not yet implemented"))
    }
}

// ============================================================================
// WEBSOCKET CLIENT
// ============================================================================

use tokio_tungstenite::{connect_async, tungstenite::protocol::Message};
use futures_util::{StreamExt, SinkExt};

pub struct WebSocketClient {
    config: Arc<AgentConfig>,
    hardware_monitor: Arc<dyn HardwareMonitor>,
    running: Arc<RwLock<bool>>,
}

impl WebSocketClient {
    pub fn new(config: AgentConfig, hardware_monitor: Arc<dyn HardwareMonitor>) -> Self {
        Self {
            config: Arc::new(config),
            hardware_monitor,
            running: Arc::new(RwLock::new(false)),
        }
    }

    pub async fn run(&self) -> Result<()> {
        *self.running.write().await = true;

        loop {
            if !*self.running.read().await {
                break;
            }

            match self.connect_and_communicate().await {
                Ok(_) => info!("WebSocket connection closed normally"),
                Err(e) => error!("WebSocket error: {}", e),
            }

            if *self.running.read().await {
                info!("Reconnecting in {}s...", self.config.backend.reconnect_interval);
                time::sleep(Duration::from_secs_f64(self.config.backend.reconnect_interval)).await;
            }
        }

        Ok(())
    }

    async fn connect_and_communicate(&self) -> Result<()> {
        info!("Connecting to WebSocket: {}", self.config.backend.server_url);

        let (ws_stream, _) = connect_async(&self.config.backend.server_url).await?;
        info!("✅ WebSocket connected");

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
            while *running.read().await {
                let mut w = write_clone.lock().await;
                if let Err(e) = Self::send_data(&mut *w, &config, &hardware_monitor).await {
                    error!("Failed to send data: {}", e);
                    break;
                }
                drop(w);
                time::sleep(Duration::from_secs_f64(config.agent.update_interval)).await;
            }
        });

        // Handle incoming messages with timeout to allow checking shutdown signal
        let mut read = read;
        loop {
            // Check if we should shut down
            if !*self.running.read().await {
                info!("Shutdown requested, closing WebSocket");
                break;
            }

            // Read with timeout to periodically check shutdown flag
            let timeout = time::timeout(Duration::from_secs(1), read.next()).await;

            match timeout {
                Ok(Some(msg)) => {
                    match msg {
                        Ok(Message::Text(text)) => {
                            let mut w = write.lock().await;
                            if let Err(e) = self.handle_message(&text, &mut *w).await {
                                error!("Failed to handle message: {}", e);
                            }
                        }
                        Ok(Message::Close(_)) => {
                            info!("Server closed connection");
                            break;
                        }
                        Err(e) => {
                            error!("WebSocket error: {}", e);
                            break;
                        }
                        _ => {}
                    }
                }
                Ok(None) => {
                    info!("WebSocket stream ended");
                    break;
                }
                Err(_) => {
                    // Timeout - loop back to check shutdown flag
                    continue;
                }
            }
        }

        data_sender.abort();
        Ok(())
    }

    async fn send_registration(&self, write: &mut futures_util::stream::SplitSink<tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>, Message>) -> Result<()> {
        let sensors = self.hardware_monitor.discover_sensors().await?;
        let fans = self.hardware_monitor.discover_fans().await?;

        let registration = serde_json::json!({
            "type": "register",
            "data": {
                "agentId": self.config.agent.id,
                "name": self.config.agent.name,
                "agent_version": "1.0.0-rust",
                "update_interval": (self.config.agent.update_interval * 1000.0) as u64,
                "capabilities": {
                    "sensors": sensors,
                    "fans": fans,
                    "fan_control": self.config.hardware.enable_fan_control
                }
            }
        });

        write.send(Message::Text(registration.to_string())).await?;
        info!("✅ Agent registered: {}", self.config.agent.id);
        Ok(())
    }

    async fn send_data(
        write: &mut futures_util::stream::SplitSink<tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>, Message>,
        config: &AgentConfig,
        hardware_monitor: &Arc<dyn HardwareMonitor>
    ) -> Result<()> {
        let sensors = hardware_monitor.discover_sensors().await?;
        let fans = hardware_monitor.discover_fans().await?;
        let system_health = hardware_monitor.get_system_info().await?;

        let data = serde_json::json!({
            "type": "data",
            "data": {
                "agentId": config.agent.id,
                "timestamp": chrono::Utc::now().timestamp_millis(),
                "sensors": sensors,
                "fans": fans,
                "systemHealth": system_health
            }
        });

        write.send(Message::Text(data.to_string())).await?;
        debug!("Sent data: {} sensors, {} fans", sensors.len(), fans.len());
        Ok(())
    }

    async fn handle_message(&self, text: &str, write: &mut futures_util::stream::SplitSink<tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>, Message>) -> Result<()> {
        let message: serde_json::Value = serde_json::from_str(text)?;

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
                    info!("Registration confirmed by server");
                }
                _ => {
                    debug!("Received message type: {}", msg_type);
                }
            }
        }

        Ok(())
    }

    async fn handle_command(&self, data: &serde_json::Value, write: &mut futures_util::stream::SplitSink<tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>, Message>) -> Result<()> {
        let command_type = data.get("type").and_then(|v| v.as_str()).unwrap_or("");
        let command_id = data.get("commandId").and_then(|v| v.as_str());
        let payload = data.get("payload");

        debug!("Processing command: {} with payload: {:?}", command_type, payload);

        let (success, error_msg, result_data) = match command_type {
            "setFanSpeed" => {
                if let (Some(fan_id), Some(speed)) = (
                    payload.and_then(|p| p.get("fanId")).and_then(|v| v.as_str()),
                    payload.and_then(|p| p.get("speed")).and_then(|v| v.as_u64())
                ) {
                    match self.hardware_monitor.set_fan_speed(fan_id, speed as u8).await {
                        Ok(_) => (true, None, serde_json::json!({"fanId": fan_id, "speed": speed})),
                        Err(e) => (false, Some(e.to_string()), serde_json::json!({})),
                    }
                } else {
                    (false, Some("Missing fanId or speed".to_string()), serde_json::json!({}))
                }
            }
            "emergencyStop" => {
                match self.hardware_monitor.emergency_stop().await {
                    Ok(_) => (true, None, serde_json::json!({"message": "Emergency stop executed"})),
                    Err(e) => (false, Some(e.to_string()), serde_json::json!({})),
                }
            }
            "setUpdateInterval" => {
                if let Some(interval) = payload.and_then(|p| p.get("interval")).and_then(|v| v.as_f64()) {
                    match self.set_update_interval(interval).await {
                        Ok(_) => (true, None, serde_json::json!({"interval": interval})),
                        Err(e) => (false, Some(e.to_string()), serde_json::json!({})),
                    }
                } else {
                    (false, Some("Missing or invalid interval".to_string()), serde_json::json!({}))
                }
            }
            "setSensorDeduplication" => {
                if let Some(enabled) = payload.and_then(|p| p.get("enabled")).and_then(|v| v.as_bool()) {
                    match self.set_sensor_deduplication(enabled).await {
                        Ok(_) => (true, None, serde_json::json!({"enabled": enabled})),
                        Err(e) => (false, Some(e.to_string()), serde_json::json!({})),
                    }
                } else {
                    (false, Some("Missing or invalid enabled flag".to_string()), serde_json::json!({}))
                }
            }
            "setSensorTolerance" => {
                if let Some(tolerance) = payload.and_then(|p| p.get("tolerance")).and_then(|v| v.as_f64()) {
                    match self.set_sensor_tolerance(tolerance).await {
                        Ok(_) => (true, None, serde_json::json!({"tolerance": tolerance})),
                        Err(e) => (false, Some(e.to_string()), serde_json::json!({})),
                    }
                } else {
                    (false, Some("Missing or invalid tolerance".to_string()), serde_json::json!({}))
                }
            }
            "ping" => (true, None, serde_json::json!({"pong": true})),
            _ => {
                warn!("Unknown command: {}", command_type);
                (false, Some(format!("Unknown command: {}", command_type)), serde_json::json!({}))
            }
        };

        // Send command response back to backend
        if let Some(cmd_id) = command_id {
            let mut response = serde_json::json!({
                "type": "commandResponse",
                "commandId": cmd_id,
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
            debug!("Sent command response: {}, success: {}", cmd_id, success);
        }

        Ok(())
    }

    async fn set_update_interval(&self, interval: f64) -> Result<()> {
        // Validate interval range (0.5-30 seconds)
        if interval < 0.5 || interval > 30.0 {
            return Err(anyhow::anyhow!("Invalid interval: {}. Must be between 0.5 and 30 seconds", interval));
        }

        // Update config
        let mut config = Arc::as_ref(&self.config).clone();
        let old_interval = config.agent.update_interval;
        config.agent.update_interval = interval;

        // Save config to disk
        let config_path = std::env::current_exe()?
            .parent()
            .ok_or_else(|| anyhow::anyhow!("Cannot determine executable directory"))?
            .join("config.json");

        save_config(&config, config_path.to_str().unwrap()).await?;

        info!("Update interval changed: {}s → {}s (saved to config)", old_interval, interval);
        Ok(())
    }

    async fn set_sensor_deduplication(&self, enabled: bool) -> Result<()> {
        // Update config
        let mut config = Arc::as_ref(&self.config).clone();
        config.hardware.filter_duplicate_sensors = enabled;

        // Save config to disk
        let config_path = std::env::current_exe()?
            .parent()
            .ok_or_else(|| anyhow::anyhow!("Cannot determine executable directory"))?
            .join("config.json");

        save_config(&config, config_path.to_str().unwrap()).await?;

        info!("Sensor deduplication changed to: {} (saved to config)", enabled);
        Ok(())
    }

    async fn set_sensor_tolerance(&self, tolerance: f64) -> Result<()> {
        // Validate tolerance range (0.25-5.0°C)
        if tolerance < 0.25 || tolerance > 5.0 {
            return Err(anyhow::anyhow!("Invalid tolerance: {}. Must be between 0.25 and 5.0°C", tolerance));
        }

        // Update config
        let mut config = Arc::as_ref(&self.config).clone();
        config.hardware.duplicate_sensor_tolerance = tolerance;

        // Save config to disk
        let config_path = std::env::current_exe()?
            .parent()
            .ok_or_else(|| anyhow::anyhow!("Cannot determine executable directory"))?
            .join("config.json");

        save_config(&config, config_path.to_str().unwrap()).await?;

        info!("Sensor tolerance changed to: {}°C (saved to config)", tolerance);
        Ok(())
    }

    pub async fn stop(&self) {
        *self.running.write().await = false;
    }
}

// ============================================================================
// CONFIGURATION MANAGEMENT
// ============================================================================

pub async fn load_config(path: Option<&str>) -> Result<AgentConfig> {
    let config_path = if let Some(p) = path {
        PathBuf::from(p)
    } else {
        // Default config location
        let exe_dir = std::env::current_exe()?
            .parent()
            .ok_or_else(|| anyhow::anyhow!("Cannot determine executable directory"))?
            .to_path_buf();
        exe_dir.join("config.json")
    };

    if config_path.exists() {
        let content = tokio::fs::read_to_string(&config_path).await?;
        let config: AgentConfig = serde_json::from_str(&content)?;
        info!("Loaded configuration from: {:?}", config_path);
        Ok(config)
    } else {
        info!("Config file not found, using defaults");
        Ok(AgentConfig::default())
    }
}

pub async fn save_config(config: &AgentConfig, path: &str) -> Result<()> {
    let content = serde_json::to_string_pretty(config)?;
    tokio::fs::write(path, content).await?;
    info!("Configuration saved to: {}", path);
    Ok(())
}

async fn run_setup_wizard(config_path: Option<&str>) -> Result<()> {
    use std::io::{self, Write};

    let config_file = if let Some(p) = config_path {
        PathBuf::from(p)
    } else {
        std::env::current_exe()?
            .parent()
            .ok_or_else(|| anyhow::anyhow!("Cannot determine executable directory"))?
            .join("config.json")
    };

    println!("\n╔══════════════════════════════════════╗");
    println!("║   Pankha Rust Agent Setup Wizard   ║");
    println!("╚══════════════════════════════════════╝\n");

    if config_file.exists() {
        println!("⚠️  Config file already exists: {:?}", config_file);
        print!("Overwrite? (y/N): ");
        io::stdout().flush()?;
        let mut response = String::new();
        io::stdin().read_line(&mut response)?;
        if !response.trim().eq_ignore_ascii_case("y") {
            println!("Setup cancelled.");
            return Ok(());
        }
    }

    let hostname = hostname::get()
        .unwrap_or_else(|_| std::ffi::OsString::from("unknown"))
        .to_string_lossy()
        .to_string();

    println!("\n📋 Configuration:\n");

    // Agent ID
    let default_agent_id = format!("rust-agent-{}", hostname);
    print!("Agent ID [{}]: ", default_agent_id);
    io::stdout().flush()?;
    let mut agent_id = String::new();
    io::stdin().read_line(&mut agent_id)?;
    let agent_id = agent_id.trim();
    let agent_id = if agent_id.is_empty() { default_agent_id.clone() } else { agent_id.to_string() };

    // Agent Name
    let default_name = format!("Rust System ({})", hostname);
    print!("Agent Name [{}]: ", default_name);
    io::stdout().flush()?;
    let mut agent_name = String::new();
    io::stdin().read_line(&mut agent_name)?;
    let agent_name = agent_name.trim();
    let agent_name = if agent_name.is_empty() { default_name.clone() } else { agent_name.to_string() };

    // Server URL
    let default_url = "ws://192.168.100.237:3000/websocket".to_string();
    print!("Backend Server URL [{}]: ", default_url);
    io::stdout().flush()?;
    let mut server_url = String::new();
    io::stdin().read_line(&mut server_url)?;
    let server_url = server_url.trim();
    let server_url = if server_url.is_empty() { default_url } else { server_url.to_string() };

    // Update Interval
    print!("Update Interval (seconds) [3.0]: ");
    io::stdout().flush()?;
    let mut interval_str = String::new();
    io::stdin().read_line(&mut interval_str)?;
    let update_interval = interval_str.trim().parse::<f64>().unwrap_or(3.0);

    // Fan Control
    print!("Enable Fan Control? (Y/n): ");
    io::stdout().flush()?;
    let mut fan_control_str = String::new();
    io::stdin().read_line(&mut fan_control_str)?;
    let enable_fan_control = !fan_control_str.trim().eq_ignore_ascii_case("n");

    // Filter Duplicates
    print!("Filter Duplicate Sensors? (Y/n): ");
    io::stdout().flush()?;
    let mut filter_str = String::new();
    io::stdin().read_line(&mut filter_str)?;
    let filter_duplicates = !filter_str.trim().eq_ignore_ascii_case("n");

    // Tolerance
    print!("Sensor Tolerance (°C) [0.5]: ");
    io::stdout().flush()?;
    let mut tolerance_str = String::new();
    io::stdin().read_line(&mut tolerance_str)?;
    let tolerance = tolerance_str.trim().parse::<f64>().unwrap_or(0.5);

    // Create config
    let config = AgentConfig {
        agent: AgentSettings {
            id: agent_id,
            name: agent_name,
            update_interval,
            log_level: "INFO".to_string(),
        },
        backend: BackendSettings {
            server_url,
            reconnect_interval: 5.0,
            max_reconnect_attempts: -1,
            connection_timeout: 10.0,
        },
        hardware: HardwareSettings {
            enable_fan_control,
            enable_sensor_monitoring: true,
            fan_safety_minimum: 10,
            temperature_critical: 85.0,
            filter_duplicate_sensors: filter_duplicates,
            duplicate_sensor_tolerance: tolerance,
        },
        logging: LoggingSettings {
            enable_file_logging: true,
            log_file: "/var/log/pankha-agent/agent.log".to_string(),
            max_log_size_mb: 10,
            log_retention_days: 7,
        },
    };

    save_config(&config, config_file.to_str().unwrap()).await?;
    println!("\n✅ Configuration saved to: {:?}", config_file);

    // Test hardware discovery
    print!("\n🔍 Test hardware discovery now? (Y/n): ");
    io::stdout().flush()?;
    let mut test_str = String::new();
    io::stdin().read_line(&mut test_str)?;
    if !test_str.trim().eq_ignore_ascii_case("n") {
        println!("\nTesting hardware discovery...\n");

        #[cfg(target_os = "linux")]
        let hardware_monitor = LinuxHardwareMonitor::new(config.hardware.clone());

        #[cfg(target_os = "windows")]
        let hardware_monitor = WindowsHardwareMonitor::new(config.hardware.clone());

        #[cfg(target_os = "macos")]
        let hardware_monitor = MacOSHardwareMonitor::new(config.hardware.clone());

        let sensors = hardware_monitor.discover_sensors().await?;
        let fans = hardware_monitor.discover_fans().await?;

        println!("✅ Discovered {} sensors and {} fans", sensors.len(), fans.len());

        if !sensors.is_empty() {
            println!("\n📊 Sensors:");
            for sensor in sensors.iter().take(5) {
                println!("  • {} - {:.1}°C", sensor.name, sensor.temperature);
            }
            if sensors.len() > 5 {
                println!("  ... and {} more", sensors.len() - 5);
            }
        }

        if !fans.is_empty() {
            println!("\n🌀 Fans:");
            for fan in fans.iter().take(5) {
                println!("  • {} - {} RPM", fan.name, fan.rpm.unwrap_or(0));
            }
            if fans.len() > 5 {
                println!("  ... and {} more", fans.len() - 5);
            }
        }
    }

    println!("\n✨ Setup complete! Run the agent with:");
    println!("   ./pankha-agent");
    println!("\n   Or run in background:");
    println!("   nohup ./pankha-agent > pankha-agent.log 2>&1 &\n");

    Ok(())
}

// ============================================================================
// DAEMON MANAGEMENT
// ============================================================================

use std::fs;
use std::process;
#[cfg(target_os = "linux")]
use std::os::fd::AsRawFd;

const PID_FILE: &str = "/run/pankha-agent/pankha-agent.pid";
const LOG_DIR: &str = "/var/log/pankha-agent";

fn ensure_directories() -> Result<()> {
    fs::create_dir_all("/run/pankha-agent")?;
    fs::create_dir_all(LOG_DIR)?;
    Ok(())
}

fn get_pid() -> Result<Option<u32>> {
    if Path::new(PID_FILE).exists() {
        let content = fs::read_to_string(PID_FILE)?;
        let pid = content.trim().parse::<u32>()?;
        Ok(Some(pid))
    } else {
        Ok(None)
    }
}

fn is_running() -> bool {
    if let Ok(Some(pid)) = get_pid() {
        // Check if process is still alive by sending signal 0
        unsafe { libc::kill(pid as i32, 0) == 0 }
    } else {
        false
    }
}

fn save_pid(pid: u32) -> Result<()> {
    ensure_directories()?;
    fs::write(PID_FILE, pid.to_string())?;
    Ok(())
}

fn remove_pid_file() -> Result<()> {
    if Path::new(PID_FILE).exists() {
        fs::remove_file(PID_FILE)?;
    }
    Ok(())
}

fn start_daemon() -> Result<()> {
    if is_running() {
        eprintln!("ERROR: Agent is already running (PID: {:?})", get_pid()?);
        process::exit(1);
    }

    println!("Starting Pankha Rust Agent daemon...");

    // Fork the process
    match unsafe { libc::fork() } {
        0 => {
            // Child process
            // Create new session
            unsafe { libc::setsid() };

            // Redirect stdout/stderr to log file
            let log_path = format!("{}/agent.log", LOG_DIR);
            let log_file = fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&log_path)?;

            // Redirect stdout and stderr
            unsafe {
                libc::dup2(log_file.as_raw_fd(), 1); // stdout
                libc::dup2(log_file.as_raw_fd(), 2); // stderr
            }

            // Save PID
            save_pid(process::id())?;

            // Continue with normal agent execution
            Ok(())
        }
        pid if pid > 0 => {
            // Parent process - exit
            println!("Agent started successfully (PID: {})", pid);
            println!("Logs: tail -f {}/agent.log", LOG_DIR);
            process::exit(0);
        }
        _ => {
            // Fork failed
            eprintln!("ERROR: Failed to start daemon");
            process::exit(1);
        }
    }
}

fn stop_daemon() -> Result<()> {
    if !is_running() {
        eprintln!("WARNING: Agent is not running");
        process::exit(1);
    }

    if let Some(pid) = get_pid()? {
        println!("Stopping Pankha Rust Agent (PID: {})...", pid);

        // Send SIGTERM
        unsafe { libc::kill(pid as i32, libc::SIGTERM) };

        // Wait for graceful shutdown
        for _ in 0..10 {
            if !is_running() {
                break;
            }
            std::thread::sleep(std::time::Duration::from_secs(1));
        }

        // Force kill if necessary
        if is_running() {
            println!("WARNING: Force killing agent...");
            unsafe { libc::kill(pid as i32, libc::SIGKILL) };
        }

        remove_pid_file()?;
        println!("Agent stopped");
    }

    Ok(())
}

fn restart_daemon() -> Result<()> {
    println!("Restarting Pankha Rust Agent...");
    stop_daemon()?;
    std::thread::sleep(std::time::Duration::from_secs(1));
    start_daemon()
}

async fn show_status() -> Result<()> {
    println!("Pankha Rust Agent Status");
    println!("========================");

    if is_running() {
        if let Some(pid) = get_pid()? {
            println!("Status: Running (PID: {})", pid);

            // Show some runtime info
            let log_path = format!("{}/agent.log", LOG_DIR);
            if Path::new(&log_path).exists() {
                println!("\nLast 5 log entries:");
                if let Ok(content) = fs::read_to_string(&log_path) {
                    let lines: Vec<&str> = content.lines().rev().take(5).collect();
                    for line in lines.iter().rev() {
                        println!("   {}", line);
                    }
                }
            }
        }
    } else {
        println!("Status: Not running");
    }

    // Show configuration info
    println!("\nConfiguration:");
    if let Ok(config) = load_config(None).await {
        println!("   Server: {}", config.backend.server_url);
        println!("   Update Interval: {}s", config.agent.update_interval);
        println!("   Agent Name: {}", config.agent.name);
    } else {
        println!("   Error: Could not load configuration");
    }

    Ok(())
}

// ============================================================================
// MAIN APPLICATION
// ============================================================================

use clap::Parser;

#[derive(Parser, Debug)]
#[command(name = "pankha-agent")]
#[command(about = "Pankha Cross-Platform Hardware Monitoring Agent", long_about = None)]
struct Args {
    /// Configuration file path
    #[arg(short = 'p', long = "config-path")]
    config_path: Option<String>,

    /// Enable debug logging
    #[arg(short = 'd', long)]
    debug: bool,

    /// Test mode (hardware discovery only)
    #[arg(long)]
    test: bool,

    /// Run interactive setup wizard
    #[arg(short = 'e', long)]
    setup: bool,

    /// Show current configuration
    #[arg(short = 'c', long)]
    config: bool,

    /// Start the agent daemon in background
    #[arg(short = 's', long)]
    start: bool,

    /// Stop the agent daemon
    #[arg(short = 'x', long)]
    stop: bool,

    /// Restart the agent daemon
    #[arg(short = 'r', long)]
    restart: bool,

    /// Show agent status
    #[arg(short = 't', long = "status")]
    status: bool,
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = Args::parse();

    // Handle management commands first (before async setup)
    if args.start {
        return start_daemon();
    }

    if args.stop {
        return stop_daemon();
    }

    if args.restart {
        return restart_daemon();
    }

    if args.status {
        return show_status().await;
    }

    // Setup logging
    let log_level = if args.debug { "debug" } else { "info" };
    tracing_subscriber::fmt()
        .with_env_filter(log_level)
        .init();

    info!("Pankha Rust Agent v1.0.0");
    info!("Platform: {}", std::env::consts::OS);

    // Show config if requested
    if args.config {
        let config = load_config(args.config_path.as_deref()).await?;
        println!("\n{}", serde_json::to_string_pretty(&config)?);
        return Ok(());
    }

    // Run setup wizard if requested
    if args.setup {
        run_setup_wizard(args.config_path.as_deref()).await?;
        return Ok(());
    }

    // Load configuration
    let config = load_config(args.config_path.as_deref()).await?;

    // Create platform-specific hardware monitor
    #[cfg(target_os = "linux")]
    let hardware_monitor: Arc<dyn HardwareMonitor> = Arc::new(LinuxHardwareMonitor::new(config.hardware.clone()));

    #[cfg(target_os = "windows")]
    let hardware_monitor: Arc<dyn HardwareMonitor> = Arc::new(WindowsHardwareMonitor::new(config.hardware.clone()));

    #[cfg(target_os = "macos")]
    let hardware_monitor: Arc<dyn HardwareMonitor> = Arc::new(MacOSHardwareMonitor::new(config.hardware.clone()));

    // Test mode
    if args.test {
        info!("Running in test mode");
        let sensors = hardware_monitor.discover_sensors().await?;
        let fans = hardware_monitor.discover_fans().await?;
        info!("Discovered {} sensors and {} fans", sensors.len(), fans.len());
        return Ok(());
    }

    // Create and run WebSocket client
    let client = WebSocketClient::new(config, hardware_monitor);
    let client = Arc::new(client);

    // Setup signal handler with proper cancellation
    let client_clone = Arc::clone(&client);
    let shutdown_signal = tokio::spawn(async move {
        tokio::signal::ctrl_c().await.ok();
        info!("Shutdown signal received (Ctrl+C)");
        client_clone.stop().await;
    });

    // Clean up PID file on shutdown
    let client_clone = Arc::clone(&client);
    tokio::spawn(async move {
        client_clone.run().await.ok();
        // Clean up PID file when shutting down
        if let Ok(Some(pid)) = get_pid() {
            if pid == process::id() as u32 {
                let _ = remove_pid_file();
            }
        }
    });

    // Run client with timeout/select to check for shutdown
    tokio::select! {
        result = client.run() => {
            if let Err(e) = result {
                error!("Client error: {}", e);
            }
        }
        _ = shutdown_signal => {
            info!("Shutdown signal handled");
        }
    }

    info!("Agent shutdown complete");
    Ok(())
}
