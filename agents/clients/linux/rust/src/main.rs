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

use anyhow::{Result, Context};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::RwLock;
use tokio::time;
use tracing::{debug, error, info, warn};
use uuid::Uuid;

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
    pub fan_step_percent: u8,        // 3, 5, 10, 15, 25, 50, 100 (disable)
    pub hysteresis_temp: f64,        // 0.5-10.0°C (0.0 = disable)
    pub emergency_temp: f64,         // 70-100°C
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
                server_url: "ws://192.168.100.237:3000/websocket".to_string(),
                reconnect_interval: 5.0,
                max_reconnect_attempts: -1,
                connection_timeout: 10.0,
            },
            hardware: HardwareSettings {
                enable_fan_control: true,
                enable_sensor_monitoring: true,
                fan_safety_minimum: 30,
                temperature_critical: 85.0,
                filter_duplicate_sensors: false,
                duplicate_sensor_tolerance: 1.0,
                fan_step_percent: 5,
                hysteresis_temp: 3.0,
                emergency_temp: 85.0,
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
    #[allow(dead_code)]
    thermal_base: PathBuf,
    discovered_fans: Arc<RwLock<HashMap<String, FanInfo>>>,
    config: HardwareSettings,
    system_info: Arc<RwLock<sysinfo::System>>,
    system_info_cache: Arc<RwLock<Option<(SystemHealth, std::time::Instant)>>>,
}

#[cfg(target_os = "linux")]
struct FanInfo {
    pwm_path: PathBuf,
    rpm_path: PathBuf,
    pwm_enable_path: Option<PathBuf>,
    chip_name: String,
    last_pwm_value: Arc<RwLock<Option<u8>>>,
    last_write_time: Arc<RwLock<std::time::Instant>>,
}

#[cfg(target_os = "linux")]
impl LinuxHardwareMonitor {
    pub fn new(config: HardwareSettings) -> Self {
        Self {
            hwmon_base: PathBuf::from("/sys/class/hwmon"),
            thermal_base: PathBuf::from("/sys/class/thermal"),
            discovered_fans: Arc::new(RwLock::new(HashMap::new())),
            config,
            system_info: Arc::new(RwLock::new(sysinfo::System::new_all())),
            system_info_cache: Arc::new(RwLock::new(None)),
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
        // DON'T CLEAR - keep existing entries with their cached state
        // fan_map.clear();  // ← REMOVED - This causes race conditions

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

                    // Update or insert fan info, preserving cached state
                    match fan_map.get_mut(&fan_id) {
                        Some(existing) => {
                            // Update paths but preserve cached PWM state
                            existing.pwm_path = pwm_path.clone();
                            existing.rpm_path = fan_file.clone();
                            existing.pwm_enable_path = if pwm_enable_path.exists() { Some(pwm_enable_path) } else { None };
                            existing.chip_name = chip_name.clone();
                            // Keep existing last_pwm_value and last_write_time
                        }
                        None => {
                            // Insert new fan with fresh cache
                            fan_map.insert(fan_id.clone(), FanInfo {
                                pwm_path: pwm_path.clone(),
                                rpm_path: fan_file.clone(),
                                pwm_enable_path: if pwm_enable_path.exists() { Some(pwm_enable_path) } else { None },
                                chip_name: chip_name.clone(),
                                last_pwm_value: Arc::new(RwLock::new(None)),
                                last_write_time: Arc::new(RwLock::new(std::time::Instant::now())),
                            });
                        }
                    }

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
        // Always perform fresh sensor discovery (no caching)
        let sensors = self.discover_hwmon_sensors().await?;

        // Apply deduplication if enabled
        let final_sensors = if self.config.filter_duplicate_sensors {
            Self::deduplicate_sensors(sensors, self.config.duplicate_sensor_tolerance)
        } else {
            sensors
        };

        Ok(final_sensors)
    }

    async fn discover_fans(&self) -> Result<Vec<Fan>> {
        // Always perform fresh fan discovery (no caching)
        let fans = self.discover_hwmon_fans().await?;
        Ok(fans)
    }

    async fn get_system_info(&self) -> Result<SystemHealth> {
        // Check cache first (1 second TTL)
        let cache = self.system_info_cache.read().await;
        if let Some((health, timestamp)) = cache.as_ref() {
            if timestamp.elapsed() < std::time::Duration::from_secs(1) {
                return Ok(health.clone());
            }
        }
        drop(cache);

        // Cache miss or expired - refresh system info
        let mut sys = self.system_info.write().await;
        sys.refresh_cpu();
        sys.refresh_memory();

        let cpu_usage = sys.global_cpu_info().cpu_usage() as f64;
        let memory_usage = (sys.used_memory() as f64 / sys.total_memory() as f64) * 100.0;

        let health = SystemHealth {
            cpu_usage,
            memory_usage,
            agent_uptime: 0.0, // TODO: Track agent uptime
        };

        // Update cache
        *self.system_info_cache.write().await = Some((health.clone(), std::time::Instant::now()));

        Ok(health)
    }

    async fn set_fan_speed(&self, fan_id: &str, speed: u8) -> Result<()> {
        let speed = speed.min(100);
        let pwm_value = (speed as f32 / 100.0 * 255.0) as u8;

        let fan_map = self.discovered_fans.read().await;
        let fan_info = fan_map.get(fan_id)
            .ok_or_else(|| anyhow::anyhow!("Fan not found: {}", fan_id))?;

        // DEDUPLICATION: Check if value unchanged
        {
            let last_value = fan_info.last_pwm_value.read().await;
            if *last_value == Some(pwm_value) {
                debug!("Fan {} already at PWM {}, skipping write", fan_id, pwm_value);
                return Ok(());
            }
        }

        // RATE LIMITING: Max 1 write per 100ms per fan
        {
            let mut last_time = fan_info.last_write_time.write().await;
            let now = std::time::Instant::now();
            let elapsed = now.duration_since(*last_time);

            if elapsed < std::time::Duration::from_millis(100) {
                debug!("Fan {} rate limited, last write {:?} ago", fan_id, elapsed);
                return Ok(());
            }
            *last_time = now;
        }

        // Enable manual PWM mode if needed (with deduplication)
        if let Some(enable_path) = &fan_info.pwm_enable_path {
            let current_enable = self.read_file(enable_path).await.ok();
            if current_enable.as_deref() != Some("1") {
                debug!("Enabling manual PWM mode for fan {}", fan_id);
                self.write_file(enable_path, "1").await?;
            }
        }

        // Perform actual PWM write with error handling
        match self.write_file(&fan_info.pwm_path, &pwm_value.to_string()).await {
            Ok(_) => {
                // Update cache on success
                *fan_info.last_pwm_value.write().await = Some(pwm_value);
                debug!("Set fan {} to {}% (PWM: {})", fan_id, speed, pwm_value);
                Ok(())
            }
            Err(e) => {
                error!("Failed to write PWM for fan {}: {}", fan_id, e);
                // Don't update cache on failure
                Err(e)
            }
        }
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

    // Method to force hardware rediscovery (no longer needed without caching, but kept for API compatibility)
    pub async fn rediscover_hardware(&self) -> Result<()> {
        info!("Hardware rediscovery requested (no caching, always fresh)");
        // No-op since we always do fresh discovery now
        Ok(())
    }
}

// ============================================================================
// WINDOWS HARDWARE MONITOR STUB
// ============================================================================

#[cfg(target_os = "windows")]
pub struct WindowsHardwareMonitor {
    config: HardwareSettings,
    system_info: Arc<RwLock<sysinfo::System>>,
    system_info_cache: Arc<RwLock<Option<(SystemHealth, std::time::Instant)>>>,
}

#[cfg(target_os = "windows")]
impl WindowsHardwareMonitor {
    pub fn new(config: HardwareSettings) -> Self {
        Self {
            config,
            system_info: Arc::new(RwLock::new(sysinfo::System::new_all())),
            system_info_cache: Arc::new(RwLock::new(None)),
        }
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
        let mut sys = self.system_info.write().await;
        sys.refresh_cpu();
        sys.refresh_memory();

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
    system_info: Arc<RwLock<sysinfo::System>>,
    system_info_cache: Arc<RwLock<Option<(SystemHealth, std::time::Instant)>>>,
}

#[cfg(target_os = "macos")]
impl MacOSHardwareMonitor {
    pub fn new(config: HardwareSettings) -> Self {
        Self {
            config,
            system_info: Arc::new(RwLock::new(sysinfo::System::new_all())),
            system_info_cache: Arc::new(RwLock::new(None)),
        }
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
        let mut sys = self.system_info.write().await;
        sys.refresh_cpu();
        sys.refresh_memory();

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
    config: Arc<RwLock<AgentConfig>>,
    hardware_monitor: Arc<dyn HardwareMonitor>,
    running: Arc<RwLock<bool>>,
}

impl WebSocketClient {
    pub fn new(config: AgentConfig, hardware_monitor: Arc<dyn HardwareMonitor>) -> Self {
        Self {
            config: Arc::new(RwLock::new(config)),
            hardware_monitor,
            running: Arc::new(RwLock::new(false)),
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
                retry_count = (retry_count + 1).min(3);

                info!("Reconnecting in {:.1}s... (attempt {})", wait_time, retry_count);
                time::sleep(Duration::from_secs_f64(wait_time)).await;
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

    async fn send_registration(&self, write: &mut futures_util::stream::SplitSink<tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>, Message>) -> Result<()> {
        let sensors = self.hardware_monitor.discover_sensors().await?;
        let fans = self.hardware_monitor.discover_fans().await?;

        let config = self.config.read().await;
        let registration = serde_json::json!({
            "type": "register",
            "data": {
                "agentId": config.agent.id,
                "name": config.agent.name,
                "agent_version": "1.0.0-rust",
                "update_interval": (config.agent.update_interval * 1000.0) as u64,
                "filter_duplicate_sensors": config.hardware.filter_duplicate_sensors,
                "duplicate_sensor_tolerance": config.hardware.duplicate_sensor_tolerance,
                "fan_step_percent": config.hardware.fan_step_percent,
                "hysteresis_temp": config.hardware.hysteresis_temp,
                "emergency_temp": config.hardware.emergency_temp,
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

    async fn send_data(
        write: &mut futures_util::stream::SplitSink<tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>, Message>,
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
        debug!("Sent telemetry: {} sensors, {} fans", sensors.len(), fans.len());
        Ok(())
    }

    async fn handle_message(&self, text: &str, write: &mut futures_util::stream::SplitSink<tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>, Message>) -> Result<()> {
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

                        // Apply filter_duplicate_sensors
                        if let Some(enabled) = config.get("filter_duplicate_sensors").and_then(|v| v.as_bool()) {
                            if let Err(e) = self.set_sensor_deduplication(enabled).await {
                                error!("Failed to apply filter_duplicate_sensors: {}", e);
                            } else {
                                info!("Applied filter_duplicate_sensors: {}", enabled);
                            }
                        }

                        // Apply duplicate_sensor_tolerance
                        if let Some(tolerance) = config.get("duplicate_sensor_tolerance").and_then(|v| v.as_f64()) {
                            if let Err(e) = self.set_sensor_tolerance(tolerance).await {
                                error!("Failed to apply duplicate_sensor_tolerance: {}", e);
                            } else {
                                info!("Applied duplicate_sensor_tolerance: {}", tolerance);
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
                    }
                }
                _ => {
                    debug!("Received message type: {}", msg_type);
                }
            }
        }

        Ok(())
    }

    async fn handle_command(&self, data: &serde_json::Value, write: &mut futures_util::stream::SplitSink<tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>, Message>) -> Result<()> {
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
                if let (Some(fan_id), Some(speed)) = (
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
            "setSensorDeduplication" => {
                if let Some(enabled) = payload.get("enabled").and_then(|v| v.as_bool()) {
                    match self.set_sensor_deduplication(enabled).await {
                        Ok(_) => (true, None, serde_json::json!({"enabled": enabled})),
                        Err(e) => (false, Some(e.to_string()), serde_json::json!({})),
                    }
                } else {
                    (false, Some("Missing or invalid enabled flag".to_string()), serde_json::json!({}))
                }
            }
            "setSensorTolerance" => {
                if let Some(tolerance) = payload.get("tolerance").and_then(|v| v.as_f64()) {
                    match self.set_sensor_tolerance(tolerance).await {
                        Ok(_) => (true, None, serde_json::json!({"tolerance": tolerance})),
                        Err(e) => (false, Some(e.to_string()), serde_json::json!({})),
                    }
                } else {
                    (false, Some("Missing or invalid tolerance".to_string()), serde_json::json!({}))
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
            "ping" => (true, None, serde_json::json!({"pong": true})),
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

    async fn set_update_interval(&self, interval: f64) -> Result<()> {
        // Validate interval range (0.5-30 seconds)
        if interval < 0.5 || interval > 30.0 {
            return Err(anyhow::anyhow!("Invalid interval: {}. Must be between 0.5 and 30 seconds", interval));
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

    async fn set_sensor_deduplication(&self, enabled: bool) -> Result<()> {
        // Update config quickly with minimal lock time
        {
            let mut config = self.config.write().await;
            config.hardware.filter_duplicate_sensors = enabled;
        } // Lock released here

        // Perform I/O outside of lock
        let config_path = std::env::current_exe()?
            .parent()
            .ok_or_else(|| anyhow::anyhow!("Cannot determine executable directory"))?
            .join("config.json");

        save_config(&*self.config.read().await, config_path.to_str().unwrap()).await?;

        info!("Sensor deduplication changed to: {} (saved to config)", enabled);
        Ok(())
    }

    async fn set_sensor_tolerance(&self, tolerance: f64) -> Result<()> {
        // Validate tolerance range (0.25-5.0°C)
        if tolerance < 0.25 || tolerance > 5.0 {
            return Err(anyhow::anyhow!("Invalid tolerance: {}. Must be between 0.25 and 5.0°C", tolerance));
        }

        // Update config quickly with minimal lock time
        {
            let mut config = self.config.write().await;
            config.hardware.duplicate_sensor_tolerance = tolerance;
        } // Lock released here

        // Perform I/O outside of lock
        let config_path = std::env::current_exe()?
            .parent()
            .ok_or_else(|| anyhow::anyhow!("Cannot determine executable directory"))?
            .join("config.json");

        save_config(&*self.config.read().await, config_path.to_str().unwrap()).await?;

        info!("Sensor tolerance changed to: {}°C (saved to config)", tolerance);
        Ok(())
    }

    async fn set_fan_step(&self, step: u8) -> Result<()> {
        // Validate: 3, 5, 10, 15, 25, 50, 100
        let valid = [3, 5, 10, 15, 25, 50, 100];
        if !valid.contains(&step) {
            return Err(anyhow::anyhow!("Invalid fan step: {}. Must be one of: 3, 5, 10, 15, 25, 50, 100 (disable)", step));
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

        info!("Fan step changed to: {}% (saved to config)", step);
        Ok(())
    }

    async fn set_hysteresis(&self, hysteresis: f64) -> Result<()> {
        // Validate: 0.0 (disable), 0.5-10.0°C
        if hysteresis < 0.0 || hysteresis > 10.0 {
            return Err(anyhow::anyhow!("Invalid hysteresis: {}. Must be between 0.0 (disable) and 10.0°C", hysteresis));
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

        info!("Hysteresis changed to: {}°C (saved to config)", hysteresis);
        Ok(())
    }

    async fn set_emergency_temp(&self, temp: f64) -> Result<()> {
        // Validate: 70-100°C
        if temp < 70.0 || temp > 100.0 {
            return Err(anyhow::anyhow!("Invalid emergency temp: {}. Must be between 70.0 and 100.0°C", temp));
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

        info!("Emergency temperature changed to: {}°C (saved to config)", temp);
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

    // Load existing config if present
    let existing_config = if config_file.exists() {
        println!("⚠️  Config file already exists: {:?}", config_file);
        print!("Overwrite? (y/N): ");
        io::stdout().flush()?;
        let mut response = String::new();
        io::stdin().read_line(&mut response)?;
        if !response.trim().eq_ignore_ascii_case("y") {
            println!("Setup cancelled.");
            return Ok(());
        }
        // Load existing config to use as defaults
        load_config(config_file.to_str()).await.ok()
    } else {
        None
    };

    let hostname = hostname::get()
        .unwrap_or_else(|_| std::ffi::OsString::from("unknown"))
        .to_string_lossy()
        .to_string();

    println!("\n📋 Configuration:\n");
    println!("Values in [brackets] are defaults - press Enter to use them.\n");

    // Agent ID - Generate silently (don't ask user)
    let agent_id = if let Some(existing) = &existing_config {
        // Keep existing ID
        existing.agent.id.clone()
    } else {
        // Generate new ID: OS-hostname-UUID (short UUID: first 8 chars)
        let os_name = std::env::consts::OS;
        let unique_id = Uuid::new_v4();
        let short_uuid = &unique_id.to_string()[..8];
        format!("{}-{}-{}", os_name, hostname, short_uuid)
    };

    // Agent Name - Just use hostname
    let default_name = if let Some(existing) = &existing_config {
        existing.agent.name.clone()
    } else {
        hostname.clone()
    };
    print!("Agent Name [{}]: ", default_name);
    io::stdout().flush()?;
    let mut agent_name = String::new();
    io::stdin().read_line(&mut agent_name)?;
    let agent_name = agent_name.trim();
    let agent_name = if agent_name.is_empty() { default_name.clone() } else { agent_name.to_string() };

    // Server URL
    let default_url = if let Some(ref existing) = existing_config {
        existing.backend.server_url.clone()
    } else {
        "ws://192.168.100.237:3000/websocket".to_string()
    };
    print!("Backend Server URL [{}]: ", default_url);
    io::stdout().flush()?;
    let mut server_url = String::new();
    io::stdin().read_line(&mut server_url)?;
    let server_url = server_url.trim();
    let server_url = if server_url.is_empty() { default_url } else { server_url.to_string() };

    // Update Interval - 3.0 for new, existing value for re-run
    let default_interval = if let Some(ref existing) = existing_config {
        existing.agent.update_interval
    } else {
        3.0
    };
    print!("Update Interval (seconds) [{}]: ", default_interval);
    io::stdout().flush()?;
    let mut interval_str = String::new();
    io::stdin().read_line(&mut interval_str)?;
    let update_interval = if interval_str.trim().is_empty() {
        default_interval
    } else {
        interval_str.trim().parse::<f64>().unwrap_or(default_interval)
    };

    // Fan Control - default Y
    print!("Enable Fan Control? (Y/n): ");
    io::stdout().flush()?;
    let mut fan_control_str = String::new();
    io::stdin().read_line(&mut fan_control_str)?;
    let enable_fan_control = !fan_control_str.trim().eq_ignore_ascii_case("n");

    // Fan Safety Minimum - default 30
    let default_fan_min = if let Some(ref existing) = existing_config {
        existing.hardware.fan_safety_minimum
    } else {
        30
    };
    print!("Fan safety minimum percentage (0-100%, default {}, 0=allow stop): ", default_fan_min);
    io::stdout().flush()?;
    let mut fan_min_str = String::new();
    io::stdin().read_line(&mut fan_min_str)?;
    let fan_safety_minimum = if fan_min_str.trim().is_empty() {
        default_fan_min
    } else {
        fan_min_str.trim().parse::<u8>().unwrap_or(default_fan_min).min(100)
    };

    // Filter Duplicates - default n (false)
    print!("Filter Duplicate Sensors? (y/N): ");
    io::stdout().flush()?;
    let mut filter_str = String::new();
    io::stdin().read_line(&mut filter_str)?;
    let filter_duplicates = filter_str.trim().eq_ignore_ascii_case("y");

    // Tolerance - default 1.0
    let default_tolerance = if let Some(ref existing) = existing_config {
        existing.hardware.duplicate_sensor_tolerance
    } else {
        1.0
    };
    print!("Sensor Tolerance (°C) [{}]: ", default_tolerance);
    io::stdout().flush()?;
    let mut tolerance_str = String::new();
    io::stdin().read_line(&mut tolerance_str)?;
    let tolerance = if tolerance_str.trim().is_empty() {
        default_tolerance
    } else {
        tolerance_str.trim().parse::<f64>().unwrap_or(default_tolerance)
    };

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
            fan_safety_minimum,
            temperature_critical: 85.0,
            filter_duplicate_sensors: filter_duplicates,
            duplicate_sensor_tolerance: tolerance,
            fan_step_percent: 5,
            hysteresis_temp: 3.0,
            emergency_temp: 85.0,
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
// use std::os::fd::AsRawFd; // Unused import

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

    // Check if config file exists
    let exe_path = std::env::current_exe()?;
    let config_path = exe_path
        .parent()
        .ok_or_else(|| anyhow::anyhow!("Cannot determine executable directory"))?
        .join("config.json");

    if !config_path.exists() {
        eprintln!("ERROR: Configuration file not found: {:?}", config_path);
        eprintln!("\nPlease run the setup wizard first:");
        eprintln!("  ./pankha-agent --setup");
        eprintln!("  or");
        eprintln!("  ./pankha-agent -e");
        process::exit(1);
    }

    println!("Starting Pankha Rust Agent daemon...");

    // Prepare log file
    ensure_directories()?;
    let log_path = format!("{}/agent.log", LOG_DIR);
    let log_file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)?;

    // Spawn new process in daemon mode using --daemon-child (internal flag)
    let child = process::Command::new(&exe_path)
        .arg("--daemon-child")
        .current_dir(std::env::current_dir()?)
        .stdin(process::Stdio::null())
        .stdout(log_file.try_clone()?)
        .stderr(log_file)
        .spawn()?;

    let pid = child.id();

    // Save PID
    save_pid(pid)?;

    println!("Agent started successfully (PID: {})", pid);
    println!("Logs: tail -f {}/agent.log", LOG_DIR);

    Ok(())
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

    // Stop the agent if it's running
    if is_running() {
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
        std::thread::sleep(std::time::Duration::from_secs(1));
    } else {
        println!("Agent not running, starting it...");
    }

    // Always start the agent (whether it was running or not)
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

use clap::{Parser, CommandFactory};

#[derive(Parser, Debug)]
#[command(name = "pankha-agent")]
#[command(about = "Pankha Cross-Platform Hardware Monitoring Agent", long_about = None)]
#[command(disable_help_flag = false)]
struct Args {
    /// Set log level (TRACE, DEBUG, INFO, WARN, ERROR, CRITICAL)
    #[arg(long = "log-level")]
    log_level: Option<String>,

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
    #[arg(short = 'i', long = "status")]
    status: bool,

    /// Show agent logs (tail -f by default, or tail -n <lines> if number provided)
    #[arg(short = 'l', long = "log-show")]
    log_show: Option<Option<usize>>,

    /// Internal flag for daemon child process (do not use directly)
    #[arg(long, hide = true)]
    daemon_child: bool,
}

#[tokio::main]
async fn main() -> Result<()> {
    // Parse arguments with custom error handling
    let args = match Args::try_parse() {
        Ok(args) => args,
        Err(err) => {
            // Print the error first
            eprintln!("{}", err);
            eprintln!();

            // Then print full help
            Args::command().print_help().unwrap();
            eprintln!();
            eprintln!("\nFor more information, try '--help'.");

            process::exit(1);
        }
    };

    // Handle management commands first (before async setup)
    if args.start {
        return start_daemon();  // Spawns new process and exits
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

    if let Some(lines) = args.log_show {
        // Show agent logs
        let log_path = format!("{}/agent.log", LOG_DIR);

        let mut cmd = process::Command::new("tail");

        match lines {
            Some(n) => {
                // Show last N lines: tail -n <lines>
                println!("Showing last {} log entries...\n", n);
                cmd.arg("-n").arg(n.to_string());
            }
            None => {
                // Follow logs: tail -f
                println!("Showing live agent logs (Ctrl+C to exit)...\n");
                cmd.arg("-f");
            }
        }

        cmd.arg(&log_path);
        let status = cmd.status()?;
        process::exit(status.code().unwrap_or(1));
    }

    // Setup logging (daemon child or foreground mode)
    // Priority: 1. --log-level flag, 2. LOG_LEVEL env, 3. config file, 4. default (info)
    let log_level = if let Some(level) = args.log_level.as_ref() {
        level.to_lowercase()
    } else if let Ok(env_level) = std::env::var("LOG_LEVEL") {
        env_level.to_lowercase()
    } else {
        // Will be set from config after loading, default to info for now
        "info".to_string()
    };

    // Note: Rust tracing uses ERROR, WARN, INFO, DEBUG, TRACE
    // CRITICAL is handled as ERROR level with critical context
    let filter = match log_level.as_str() {
        "critical" => "error",  // CRITICAL maps to ERROR level (most severe)
        "trace" => "trace",
        "debug" => "debug",
        "info" => "info",
        "warn" => "warn",
        "error" => "error",
        _ => {
            eprintln!("Invalid log level '{}'. Using INFO. Valid levels: TRACE, DEBUG, INFO, WARN, ERROR, CRITICAL", log_level);
            "info"
        }
    };

    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_timer(tracing_subscriber::fmt::time::LocalTime::rfc_3339())
        .init();

    // If we're a daemon child, save our PID and continue
    if args.daemon_child {
        ensure_directories()?;
        save_pid(process::id())?;
    }

    info!("Pankha Agent v1.0.0 starting ({})", std::env::consts::OS);

    // Show config if requested
    if args.config {
        let config = load_config(None).await?;
        println!("\n{}", serde_json::to_string_pretty(&config)?);
        return Ok(());
    }

    // Run setup wizard if requested
    if args.setup {
        run_setup_wizard(None).await?;
        return Ok(());
    }

    // Check if config file exists (required for normal operation)
    let config_file_path = std::env::current_exe()?
        .parent()
        .ok_or_else(|| anyhow::anyhow!("Cannot determine executable directory"))?
        .join("config.json");

    if !config_file_path.exists() {
        eprintln!("ERROR: Configuration file not found: {:?}", config_file_path);
        eprintln!("\nPlease run the setup wizard first:");
        eprintln!("  ./pankha-agent --setup");
        eprintln!("  or");
        eprintln!("  ./pankha-agent -e");
        process::exit(1);
    }

    // Load configuration
    let config = load_config(None).await?;

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

    // Clean up PID file after shutdown
    if let Ok(Some(pid)) = get_pid() {
        if pid == process::id() {
            let _ = remove_pid_file();
            info!("PID file cleaned up");
        }
    }

    info!("Agent shutdown complete");
    Ok(())
}
