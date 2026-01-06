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
    pub fan_step_percent: u8,        // 3, 5, 10, 15, 25, 50, 100 (disable)
    pub hysteresis_temp: f64,        // 0.5-10.0°C (0.0 = disable)
    pub emergency_temp: f64,         // 70-100°C - used for local failsafe mode
    #[serde(default = "default_failsafe_speed")]
    pub failsafe_speed: u8,          // 0-100% - fan speed during failsafe mode
}

fn default_failsafe_speed() -> u8 { 70 }

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

    /// Invalidate hardware cache (call on startup/reconnection to force rediscovery)
    async fn invalidate_cache(&self);

    /// Check if last sensor discovery was from cache (for logging)
    async fn last_discovery_from_cache(&self) -> bool;
}

// ============================================================================
// LINUX HARDWARE MONITOR IMPLEMENTATION
// ============================================================================

#[cfg(target_os = "linux")]
use std::collections::HashMap;

#[cfg(target_os = "linux")]
pub struct LinuxHardwareMonitor {
    hwmon_base: PathBuf,
    #[allow(dead_code)]
    thermal_base: PathBuf,
    discovered_fans: Arc<RwLock<HashMap<String, FanInfo>>>,
    discovered_sensors: Arc<RwLock<HashMap<String, SensorInfo>>>,
    cached_hwmon_count: Arc<RwLock<usize>>,
    last_discovery_from_cache: Arc<RwLock<bool>>,
    system_info: Arc<RwLock<sysinfo::System>>,
    system_info_cache: Arc<RwLock<Option<(SystemHealth, std::time::Instant)>>>,
    cpu_brand: String,
    motherboard_name: String,
    storage_cache: Arc<RwLock<HashMap<String, String>>>,
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

/// Cached sensor metadata and path for efficient reading
#[cfg(target_os = "linux")]
#[derive(Clone)]
struct SensorInfo {
    temp_input_path: PathBuf,
    id: String,
    name: String,
    sensor_type: String,
    max_temp: Option<f64>,
    crit_temp: Option<f64>,
    chip: Option<String>,
    hardware_name: Option<String>,
    source: Option<String>,
}

#[cfg(target_os = "linux")]
impl LinuxHardwareMonitor {
    pub fn new(_config: HardwareSettings) -> Self {
        // Initialize sysinfo synchronously
        let mut sys = sysinfo::System::new_all();
        // We need to refresh CPU to ensure brand is available
        sys.refresh_cpu();
        
        let mut cpu_brand = sys.global_cpu_info().brand().to_string();
        
        // Fallback: Try reading /proc/cpuinfo if sysinfo fails
        if cpu_brand.is_empty() || cpu_brand == "Unknown CPU" {
            if let Ok(cpuinfo) = std::fs::read_to_string("/proc/cpuinfo") {
                for line in cpuinfo.lines() {
                    // Check for "model name" (x86) or "Model" (ARM/RPi)
                    if line.starts_with("model name") || line.starts_with("Model") {
                        if let Some(name) = line.split(':').nth(1) {
                            cpu_brand = name.trim().to_string();
                            break;
                        }
                    }
                }
            }
        }

        let cpu_brand = if cpu_brand.is_empty() {
            "Unknown CPU".to_string()
        } else {
            cpu_brand
        };

        let mut monitor = Self {
            hwmon_base: PathBuf::from("/sys/class/hwmon"),
            thermal_base: PathBuf::from("/sys/class/thermal"),
            discovered_fans: Arc::new(RwLock::new(HashMap::new())),
            discovered_sensors: Arc::new(RwLock::new(HashMap::new())),
            cached_hwmon_count: Arc::new(RwLock::new(0)),
            last_discovery_from_cache: Arc::new(RwLock::new(false)),
            system_info: Arc::new(RwLock::new(sys)),
            system_info_cache: Arc::new(RwLock::new(None)),
            cpu_brand,
            motherboard_name: String::new(),
            storage_cache: Arc::new(RwLock::new(HashMap::new())),
        };

        // Initialize other static hardware names
        monitor.motherboard_name = monitor.get_motherboard_name();
        
        monitor
    }

    // Removed get_cpu_brand as it's now handled in new()

    fn get_motherboard_name(&self) -> String {
        // Try to read DMI info
        let vendor = std::fs::read_to_string("/sys/class/dmi/id/board_vendor")
            .unwrap_or_default()
            .trim()
            .to_string();
        let name = std::fs::read_to_string("/sys/class/dmi/id/board_name")
            .unwrap_or_default()
            .trim()
            .to_string();

        if !vendor.is_empty() && !name.is_empty() {
            format!("{} {}", vendor, name)
        } else if !name.is_empty() {
            name
        } else {
            String::new() // Fallback to empty, will use default logic
        }
    }

    /// Count hwmon directories for hot-plug detection
    async fn count_hwmon_dirs(&self) -> usize {
        match tokio::fs::read_dir(&self.hwmon_base).await {
            Ok(mut entries) => {
                let mut count = 0;
                while let Ok(Some(entry)) = entries.next_entry().await {
                    if entry.path().is_dir() {
                        count += 1;
                    }
                }
                count
            }
            Err(_) => 0,
        }
    }

    /// Read sensor values from cache (fast path - no discovery)
    async fn read_sensors_from_cache(&self) -> Result<Vec<Sensor>> {
        let cache = self.discovered_sensors.read().await;
        let mut sensors = Vec::with_capacity(cache.len());

        for info in cache.values() {
            // Read current temperature from cached path
            let temp_celsius = match self.read_file(&info.temp_input_path).await {
                Ok(raw) => {
                    match raw.parse::<i32>() {
                        Ok(millidegrees) => millidegrees as f64 / 1000.0,
                        Err(_) => continue, // Skip if parse fails
                    }
                }
                Err(_) => continue, // Skip if read fails (sensor may have been removed)
            };

            sensors.push(Sensor {
                id: info.id.clone(),
                name: info.name.clone(),
                temperature: (temp_celsius * 10.0).round() / 10.0,
                sensor_type: info.sensor_type.clone(),
                max_temp: info.max_temp,
                crit_temp: info.crit_temp,
                chip: info.chip.clone(),
                hardware_name: info.hardware_name.clone(),
                source: info.source.clone(),
            });
        }

        Ok(sensors)
    }

    /// Invalidate sensor cache (call on reconnection)
    pub async fn invalidate_sensor_cache(&self) {
        self.discovered_sensors.write().await.clear();
        *self.cached_hwmon_count.write().await = 0;
    }

    async fn resolve_storage_model(&self, hwmon_dir: &Path, chip_name: &str) -> Option<String> {
        // Check cache first using chip_name as key
        {
            let cache = self.storage_cache.read().await;
            if let Some(model) = cache.get(chip_name) {
                return Some(model.clone());
            }
        }

        let mut found_model = None;

        // Strategy 1: Check if 'device/model' exists directly in hwmon dir (some drivers do this)
        let direct_model = hwmon_dir.join("device/model");
        if direct_model.exists() {
             if let Ok(model) = self.read_file(&direct_model).await {
                 found_model = Some(model);
             }
        }

        // Strategy 2: Check for block devices under 'device/block' (common for NVMe/SATA)
        // Path: hwmonX/device/block/nvme0n1/device/model
        if found_model.is_none() {
             let device_block = hwmon_dir.join("device/block");
             if device_block.exists() {
                 if let Ok(mut entries) = tokio::fs::read_dir(&device_block).await {
                     while let Ok(Some(entry)) = entries.next_entry().await {
                         let model_path = entry.path().join("device/model");
                         if model_path.exists() {
                             if let Ok(model) = self.read_file(&model_path).await {
                                 found_model = Some(model);
                                 break;
                             }
                         }
                     }
                 }
             }
        }

        // Strategy 3: Fallback to /sys/class/block lookup if we can guess the name
        if found_model.is_none() {
             let device_name = if chip_name.starts_with("nvme") && !chip_name.contains("n") {
                format!("{}n1", chip_name)
            } else {
                chip_name.to_string()
            };
            let model_path = PathBuf::from(format!("/sys/class/block/{}/device/model", device_name));
            if model_path.exists() {
                if let Ok(model) = self.read_file(&model_path).await {
                    found_model = Some(model);
                }
            }
        }

        if let Some(model) = found_model {
            let model = model.trim().to_string();
            let mut cache = self.storage_cache.write().await;
            cache.insert(chip_name.to_string(), model.clone());
            return Some(model);
        }
        
        None
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

        // Generate descriptive ID
        // Old: k10temp_1
        // New: k10temp_tctl
        let sanitized_label = sensor_label.to_lowercase()
            .replace(" ", "_")
            .replace("-", "_")
            .replace("/", "_")
            .replace("(", "")
            .replace(")", "");
            
        // Ensure ID is unique by combining chip and label
        // Note: This assumes chip_name is unique or we don't have identical sensors.
        // For identical chips, we might need a better strategy later, but this matches Windows parity.
        let sensor_id = format!("{}_{}", chip_name.to_lowercase().replace(" ", "_"), sanitized_label);
        let sensor_type = Self::classify_sensor_type(chip_name);

        // Determine full hardware name based on type
        let mut hardware_name = chip_name.to_string();
        
        if sensor_type == "cpu" && !self.cpu_brand.is_empty() {
             hardware_name = self.cpu_brand.clone();
        } else if sensor_type == "motherboard" && !self.motherboard_name.is_empty() {
             hardware_name = self.motherboard_name.clone();
        } else if sensor_type == "nvme" || chip_name.contains("nvme") || chip_name.contains("sd") {
            // Try to resolve storage model using the hwmon path
            if let Some(model) = self.resolve_storage_model(hwmon_dir, chip_name).await {
                hardware_name = model;
            }
        }

        Ok(Sensor {
            id: sensor_id,
            name: format!("{} {}", Self::get_friendly_chip_name(chip_name), sensor_label),
            temperature: temp_celsius.round() * 10.0 / 10.0,
            sensor_type,
            max_temp,
            crit_temp,
            chip: Some(chip_name.to_string()),
            hardware_name: Some(hardware_name),
            source: Some(temp_file.to_string_lossy().to_string()),
        })
    }

    /// Extract hardware brand from chip name for TYPE-first display
    fn extract_brand(chip_name: &str) -> String {
        let name = chip_name.to_lowercase();

        // CPU brands
        if name.contains("amd") || name.contains("k10temp") || name.contains("ryzen") || name.contains("epyc") {
            return "AMD".to_string();
        }
        if name.contains("intel") || name.contains("coretemp") || name.contains("xeon") || name.contains("pentium") {
            return "Intel".to_string();
        }

        // Storage brands
        if name.contains("samsung") { return "Samsung".to_string(); }
        if name.contains("wd") || name.contains("western digital") { return "WD".to_string(); }
        if name.contains("seagate") { return "Seagate".to_string(); }
        if name.contains("crucial") { return "Crucial".to_string(); }
        if name.contains("kingston") { return "Kingston".to_string(); }
        if name.contains("corsair") { return "Corsair".to_string(); }
        if name.contains("sandisk") { return "SanDisk".to_string(); }
        if name.contains("micron") { return "Micron".to_string(); }
        if name.contains("hynix") { return "SK Hynix".to_string(); }
        if name.contains("toshiba") { return "Toshiba".to_string(); }
        if name.contains("adata") || name.contains("xpg") { return "ADATA".to_string(); }

        // Motherboard/chipset
        if name.contains("asus") { return "ASUS".to_string(); }
        if name.contains("gigabyte") { return "Gigabyte".to_string(); }
        if name.contains("msi") { return "MSI".to_string(); }
        if name.contains("asrock") { return "ASRock".to_string(); }
        if name.contains("it8") || name.contains("ite") { return "ITE".to_string(); }
        if name.contains("nct") || name.contains("nuvoton") { return "Nuvoton".to_string(); }

        String::new()
    }

    /// Get friendly chip name with TYPE-first ordering (CPU AMD, Storage Samsung, etc.)
    fn get_friendly_chip_name(chip_name: &str) -> String {
        let brand = Self::extract_brand(chip_name);
        let chip_lower = chip_name.to_lowercase();

        if chip_lower.contains("k10temp") || chip_lower.contains("coretemp") || chip_lower.contains("cpu") {
            if !brand.is_empty() {
                format!("CPU {}", brand)
            } else {
                "CPU".to_string()
            }
        } else if chip_lower.contains("nvme") || chip_lower.contains("storage") {
            if !brand.is_empty() {
                format!("Storage {}", brand)
            } else {
                "Storage".to_string()
            }
        } else if chip_lower.contains("it8") || chip_lower.contains("nct") {
            if !brand.is_empty() {
                format!("Motherboard {}", brand)
            } else {
                "Motherboard".to_string()
            }
        } else if chip_lower.contains("acpi") {
            "ACPI".to_string()
        } else {
            chip_name.to_string()
        }
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
        // Count-based hot-plug detection
        let current_hwmon_count = self.count_hwmon_dirs().await;
        let cached_count = *self.cached_hwmon_count.read().await;
        let cache_empty = self.discovered_sensors.read().await.is_empty();

        let sensors = if current_hwmon_count != cached_count || cache_empty {
            // Hardware changed or cache empty - full rediscovery
            debug!("Sensor discovery triggered: hwmon_count {} -> {} (cache_empty: {})",
                   cached_count, current_hwmon_count, cache_empty);

            let discovered = self.discover_hwmon_sensors().await?;

            // Populate cache with discovered sensors
            {
                let mut cache = self.discovered_sensors.write().await;
                cache.clear();
                for sensor in &discovered {
                    if let Some(source_path) = &sensor.source {
                        cache.insert(sensor.id.clone(), SensorInfo {
                            temp_input_path: PathBuf::from(source_path),
                            id: sensor.id.clone(),
                            name: sensor.name.clone(),
                            sensor_type: sensor.sensor_type.clone(),
                            max_temp: sensor.max_temp,
                            crit_temp: sensor.crit_temp,
                            chip: sensor.chip.clone(),
                            hardware_name: sensor.hardware_name.clone(),
                            source: sensor.source.clone(),
                        });
                    }
                }
            }

            // Update cached hwmon count
            *self.cached_hwmon_count.write().await = current_hwmon_count;
            *self.last_discovery_from_cache.write().await = false;

            discovered
        } else {
            // Hardware unchanged - read from cache (fast path)
            *self.last_discovery_from_cache.write().await = true;
            self.read_sensors_from_cache().await?
        };

        Ok(sensors)
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
                // Clear cache on failure to force retry on next attempt (self-healing)
                *fan_info.last_pwm_value.write().await = None;
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

    async fn invalidate_cache(&self) {
        self.invalidate_sensor_cache().await;
        debug!("Hardware cache invalidated - next discovery will be full rediscovery");
    }

    async fn last_discovery_from_cache(&self) -> bool {
        *self.last_discovery_from_cache.read().await
    }
}

#[cfg(target_os = "linux")]
impl LinuxHardwareMonitor {
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

    async fn invalidate_cache(&self) {
        // No-op for Windows stub
    }

    async fn last_discovery_from_cache(&self) -> bool {
        false // Windows stub always returns false
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

    async fn invalidate_cache(&self) {
        // No-op for macOS stub
    }

    async fn last_discovery_from_cache(&self) -> bool {
        false // macOS stub always returns false
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
    // Failsafe mode tracking - activates when disconnected from backend
    failsafe_active: Arc<RwLock<bool>>,
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

    async fn send_registration(&self, write: &mut futures_util::stream::SplitSink<tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>, Message>) -> Result<()> {
        let sensors = self.hardware_monitor.discover_sensors().await?;
        let fans = self.hardware_monitor.discover_fans().await?;

        let config = self.config.read().await;
        let registration = serde_json::json!({
            "type": "register",
            "data": {
                "agentId": config.agent.id,
                "name": config.agent.name,
                "agent_version": env!("CARGO_PKG_VERSION"),
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

        // Log with cache status indicator
        let from_cache = hardware_monitor.last_discovery_from_cache().await;
        let source = if from_cache { "from cache" } else { "from hardware" };
        debug!("Sent telemetry: {} sensors, {} fans ({})", sensors.len(), fans.len(), source);
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
        // Validate interval range (0.5-30 seconds, matching SST ui-options.json)
        let valid_intervals = [0.5, 1.0, 2.0, 3.0, 5.0, 7.0, 10.0, 15.0, 30.0];
        if !valid_intervals.contains(&interval) {
            return Err(anyhow::anyhow!("Invalid interval: {}. Must be one of: {:?}", interval, valid_intervals));
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

    async fn set_fan_step(&self, step: u8) -> Result<()> {
        // Validate: 2, 3, 5, 7, 10, 15, 25, 50, 100 (matching SST ui-options.json)
        let valid = [2, 3, 5, 7, 10, 15, 25, 50, 100];
        if !valid.contains(&step) {
            return Err(anyhow::anyhow!("Invalid fan step: {}. Must be one of: {:?}", step, valid));
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

    async fn set_hysteresis(&self, hysteresis: f64) -> Result<()> {
        // Validate hysteresis (matching SST ui-options.json values)
        let valid_hysteresis = [0.0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 4.0, 5.0, 7.5, 10.0];
        if !valid_hysteresis.contains(&hysteresis) {
            return Err(anyhow::anyhow!("Invalid hysteresis: {}. Must be one of: {:?}", hysteresis, valid_hysteresis));
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

    async fn set_emergency_temp(&self, temp: f64) -> Result<()> {
        // Validate emergency temp (matching SST ui-options.json: 60-100°C)
        let valid_temps = [60.0, 65.0, 70.0, 75.0, 80.0, 85.0, 90.0, 95.0, 100.0];
        if !valid_temps.contains(&temp) {
            return Err(anyhow::anyhow!("Invalid emergency temp: {}. Must be one of: {:?}", temp, valid_temps));
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

    async fn set_log_level(&self, level: &str) -> Result<()> {
        // Validate log level
        let valid_levels = ["trace", "debug", "info", "warn", "error", "critical"];
        let level_lower = level.to_lowercase();
        if !valid_levels.contains(&level_lower.as_str()) {
            return Err(anyhow::anyhow!(
                "Invalid log level '{}'. Valid levels: TRACE, DEBUG, INFO, WARN, ERROR, CRITICAL",
                level
            ));
        }

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

    async fn set_failsafe_speed(&self, speed: u8) -> Result<()> {
        // Validate failsafe speed (matching SST ui-options.json: multiples of 10)
        let valid_speeds = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
        if !valid_speeds.contains(&speed) {
            return Err(anyhow::anyhow!("Invalid failsafe speed: {}. Must be one of: {:?}", speed, valid_speeds));
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

    async fn set_enable_fan_control(&self, enabled: bool) -> Result<()> {
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

    pub async fn stop(&self) {
        *self.running.write().await = false;
    }
}

// ============================================================================
// CONFIGURATION MANAGEMENT
// ============================================================================

/// Migrate config to current version (removes deprecated, adds new fields)
/// Phase 3: Config Migration - handles old configs automatically
fn migrate_config(config_path: &Path) -> Result<bool> {
    if !config_path.exists() {
        return Ok(false);
    }
    
    let content = std::fs::read_to_string(config_path)?;
    let mut json: serde_json::Value = serde_json::from_str(&content)?;
    let mut migrated = false;
    
    // === REMOVALS ===
    if let Some(hardware) = json.get_mut("hardware").and_then(|h| h.as_object_mut()) {
        if hardware.remove("filter_duplicate_sensors").is_some() {
            info!("Migrated: removed 'filter_duplicate_sensors'");
            migrated = true;
        }
        if hardware.remove("duplicate_sensor_tolerance").is_some() {
            info!("Migrated: removed 'duplicate_sensor_tolerance'");
            migrated = true;
        }
        if hardware.remove("fan_safety_minimum").is_some() {
            info!("Migrated: removed 'fan_safety_minimum' (replaced by failsafe_speed)");
            migrated = true;
        }
        
        // === ADDITIONS ===
        if !hardware.contains_key("failsafe_speed") {
            hardware.insert("failsafe_speed".to_string(), serde_json::json!(70));
            info!("Migrated: added 'failsafe_speed' with default 70");
            migrated = true;
        }
    }
    
    if migrated {
        std::fs::write(config_path, serde_json::to_string_pretty(&json)?)?;
        info!("Config migrated to latest version: {:?}", config_path);
    }
    
    Ok(migrated)
}

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

    // Migrate config first (handles old configs automatically)
    if let Err(e) = migrate_config(&config_path) {
        warn!("Config migration check failed: {}", e);
    }

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
    println!("║    Pankha Rust Agent Setup Wizard    ║");
    println!("╚══════════════════════════════════════╝");
    println!("Build: \x1b[32mpankha-agent v{} ({})\x1b[0m\n", env!("CARGO_PKG_VERSION"), std::env::consts::ARCH);

    // Load existing config if present
    let existing_config = if config_file.exists() {
        println!("⚠️  Config file already exists: {:?}", config_file);
        print!("Overwrite? (y/N): ");
        io::stdout().flush()?;
        let mut response = String::new();
        io::stdin().read_line(&mut response)?;
        if !response.trim().eq_ignore_ascii_case("y") {
            // User declined to overwrite config - check if autostart is needed
            #[cfg(target_os = "linux")]
            {
                let needs_autostart = has_systemd() && !Path::new(SYSTEMD_SERVICE_PATH).exists();
                if needs_autostart {
                    println!("\nAuto-start service not installed");
                    print!("   Install systemd service to start agent on boot? [Y/n]: ");
                    io::stdout().flush()?;
                    let mut autostart_input = String::new();
                    io::stdin().read_line(&mut autostart_input)?;
                    
                    if !autostart_input.trim().eq_ignore_ascii_case("n") {
                        if unsafe { libc::geteuid() } == 0 {
                            match install_systemd_service() {
                                Ok(_) => {}
                                Err(e) => {
                                    println!("   ⚠ Could not install service: {}", e);
                                    println!("   You can retry later with: sudo ./pankha-agent --install-service");
                                }
                            }
                        } else {
                            println!("   ⚠ Root privileges required to install service.");
                            println!("   Run later with: sudo ./pankha-agent --install-service");
                        }
                    }
                    println!();
                }
            }
            println!("Config unchanged.");
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

    // Failsafe Speed - default 70%
    let default_failsafe = if let Some(ref existing) = existing_config {
        existing.hardware.failsafe_speed
    } else {
        70
    };
    print!("Failsafe speed when backend disconnected (0-100%, default {}): ", default_failsafe);
    io::stdout().flush()?;
    let mut failsafe_str = String::new();
    io::stdin().read_line(&mut failsafe_str)?;
    let failsafe_speed = if failsafe_str.trim().is_empty() {
        default_failsafe
    } else {
        failsafe_str.trim().parse::<u8>().unwrap_or(default_failsafe).min(100)
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
            fan_step_percent: 5,
            hysteresis_temp: 3.0,
            emergency_temp: 85.0,
            failsafe_speed,
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

    // Autostart prompt (show if systemd available and service not installed)
    #[cfg(target_os = "linux")]
    if has_systemd() && !Path::new(SYSTEMD_SERVICE_PATH).exists() {
        println!("\nAuto-start service not installed");
        print!("   Install systemd service to start agent on boot? [Y/n]: ");
        io::stdout().flush()?;
        let mut autostart_input = String::new();
        io::stdin().read_line(&mut autostart_input)?;
        
        if !autostart_input.trim().eq_ignore_ascii_case("n") {
            // Check if running as root
            if unsafe { libc::geteuid() } == 0 {
                match install_systemd_service() {
                    Ok(_) => {}
                    Err(e) => {
                        println!("   ⚠ Could not install service: {}", e);
                        println!("   You can retry later with: sudo ./pankha-agent --install-service");
                    }
                }
            } else {
                println!("   ⚠ Root privileges required to install service.");
                println!("   Run later with: sudo ./pankha-agent --install-service");
            }
        }
    }

    println!("\n✨ Setup complete!");

    // Ask if user wants to start the agent now
    if !is_running() {
        print!("\n   Start the agent now? [Y/n]: ");
        io::stdout().flush()?;
        let mut start_input = String::new();
        io::stdin().read_line(&mut start_input)?;
        
        if !start_input.trim().eq_ignore_ascii_case("n") {
            match start_daemon_with_log_level(None) {
                Ok(_) => {}
                Err(e) => {
                    println!("   ⚠ Could not start agent: {}", e);
                }
            }
        } else {
            #[cfg(target_os = "linux")]
            if has_systemd() && Path::new(SYSTEMD_SERVICE_PATH).exists() {
                println!("\n   Start later with: sudo systemctl start pankha-agent");
            } else {
                println!("\n   Start later with: ./pankha-agent --start");
            }
            
            #[cfg(not(target_os = "linux"))]
            println!("\n   Start later with: ./pankha-agent --start");
        }
    } else {
        println!("   Agent is already running.");
    }

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
const SYSTEMD_SERVICE_PATH: &str = "/etc/systemd/system/pankha-agent.service";

const SYSTEMD_SERVICE_TEMPLATE: &str = r#"[Unit]
Description=Pankha Hardware Monitoring Agent
After=network.target

[Service]
Type=forking
ExecStart={{EXEC_PATH}} --start
ExecStop={{EXEC_PATH}} --stop
ExecReload={{EXEC_PATH}} --restart
PIDFile=/run/pankha-agent/pankha-agent.pid
Restart=on-failure
RestartSec=10
User=root
WorkingDirectory={{WORK_DIR}}
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
"#;

/// Check if systemd is available on this system
fn has_systemd() -> bool {
    Path::new("/run/systemd/system").exists()
}

/// Check if the pankha-agent systemd service is actively managing the process
/// Returns true if systemd service exists and is active/activating
fn is_systemd_service_active() -> bool {
    if !has_systemd() || !Path::new(SYSTEMD_SERVICE_PATH).exists() {
        return false;
    }
    
    // Check if service is active (running) or activating (starting)
    process::Command::new("systemctl")
        .args(["is-active", "--quiet", "pankha-agent"])
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// Install or repair systemd service for auto-start on boot (idempotent)
fn install_systemd_service() -> Result<()> {
    // Check if running as root (using libc for Linux)
    #[cfg(target_os = "linux")]
    if unsafe { libc::geteuid() } != 0 {
        return Err(anyhow::anyhow!(
            "Root privileges required. Run with: sudo ./pankha-agent --install-service"
        ));
    }

    // Check if systemd is available
    if !has_systemd() {
        println!("❌ systemd not detected on this system.");
        println!("   The agent can still run manually with: ./pankha-agent --start");
        println!();
        println!("   For auto-start, consult your init system documentation:");
        println!("   - OpenRC: Add to /etc/init.d/");
        println!("   - SysVinit: Add to /etc/rc.local");
        println!("   - runit: Create service directory in /etc/sv/");
        return Ok(());
    }

    // Get executable path and working directory
    let exe_path = std::env::current_exe()?;
    let work_dir = exe_path
        .parent()
        .ok_or_else(|| anyhow::anyhow!("Cannot determine executable directory"))?;

    // Generate service file content
    let service_content = SYSTEMD_SERVICE_TEMPLATE
        .replace("{{EXEC_PATH}}", exe_path.to_str().unwrap_or("/opt/pankha-agent/pankha-agent"))
        .replace("{{WORK_DIR}}", work_dir.to_str().unwrap_or("/opt/pankha-agent"));

    // Check if service file already exists and is identical
    let service_path = Path::new(SYSTEMD_SERVICE_PATH);
    if service_path.exists() {
        if let Ok(existing_content) = fs::read_to_string(service_path) {
            if existing_content == service_content {
                println!("✓ Service is already installed and up-to-date");
                return Ok(());
            }
        }
        println!("! Existing service file found - updating...");
    }

    // Write service file
    fs::write(service_path, &service_content)
        .context("Failed to write service file")?;
    println!("✓ Service file created: {}", SYSTEMD_SERVICE_PATH);

    // Reload systemd daemon
    let reload_status = process::Command::new("systemctl")
        .args(["daemon-reload"])
        .status();
    match reload_status {
        Ok(status) if status.success() => {
            println!("✓ Systemd daemon reloaded");
        }
        _ => {
            println!("⚠ Failed to reload systemd daemon (run: systemctl daemon-reload)");
        }
    }

    // Enable the service
    let enable_status = process::Command::new("systemctl")
        .args(["enable", "pankha-agent.service"])
        .status();
    match enable_status {
        Ok(status) if status.success() => {
            println!("✓ Service enabled (will start on boot)");
        }
        _ => {
            println!("⚠ Failed to enable service (run: systemctl enable pankha-agent.service)");
        }
    }

    println!();
    println!("Start now with: sudo systemctl start pankha-agent");
    println!("Or use:         ./pankha-agent --start");

    Ok(())
}

/// Uninstall systemd service
fn uninstall_systemd_service() -> Result<()> {
    // Check if running as root (using libc for Linux)
    #[cfg(target_os = "linux")]
    if unsafe { libc::geteuid() } != 0 {
        return Err(anyhow::anyhow!(
            "Root privileges required. Run with: sudo ./pankha-agent --uninstall-service"
        ));
    }

    // Check if systemd is available
    if !has_systemd() {
        println!("❌ systemd not detected on this system.");
        return Ok(());
    }

    let service_path = Path::new(SYSTEMD_SERVICE_PATH);
    if !service_path.exists() {
        println!("✓ Service is not installed");
        return Ok(());
    }

    // Stop the service if running
    let _ = process::Command::new("systemctl")
        .args(["stop", "pankha-agent"])
        .status();
    println!("✓ Service stopped");

    // Disable the service
    let _ = process::Command::new("systemctl")
        .args(["disable", "pankha-agent"])
        .status();
    println!("✓ Service disabled");

    // Remove the service file
    fs::remove_file(service_path)?;
    println!("✓ Service file removed");

    // Reload systemd daemon
    let _ = process::Command::new("systemctl")
        .args(["daemon-reload"])
        .status();
    println!("✓ Systemd daemon reloaded");

    Ok(())
}


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
        let alive = unsafe { libc::kill(pid as i32, 0) == 0 };
        
        if !alive {
            // Process is dead but PID file exists - cleanup stale PID
            if let Err(e) = remove_pid_file() {
                eprintln!("Warning: Could not remove stale PID file: {}", e);
            }
            return false;
        }
        true
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

fn start_daemon_with_log_level(log_level: Option<String>) -> Result<()> {
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

    println!("\x1b[32mStarting pankha-agent v{} ({})\x1b[0m", env!("CARGO_PKG_VERSION"), std::env::consts::ARCH);

    // Prepare log file
    ensure_directories()?;
    let log_path = format!("{}/agent.log", LOG_DIR);
    let log_file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)?;

    // Spawn new process in daemon mode using --daemon-child (internal flag)
    let mut cmd = process::Command::new(&exe_path);
    cmd.arg("--daemon-child");

    // Pass log level to daemon child if specified
    if let Some(level) = log_level {
        cmd.arg("--log-level").arg(level);
    }

    let child = cmd
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
    // Check if systemd service is actively managing the process
    // If so, delegate to systemctl to prevent auto-restart from Restart=on-failure
    if is_systemd_service_active() {
        println!("Agent is managed by systemd. Using systemctl stop...");
        let status = process::Command::new("systemctl")
            .args(["stop", "pankha-agent"])
            .status();
        
        match status {
            Ok(s) if s.success() => {
                println!("Agent stopped via systemd");
                return Ok(());
            }
            Ok(_) => {
                eprintln!("WARNING: systemctl stop failed, falling back to manual stop");
            }
            Err(e) => {
                eprintln!("WARNING: Could not run systemctl: {}, falling back to manual stop", e);
            }
        }
    }

    // Manual stop (for non-systemd systems or systemctl fallback)
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

fn restart_daemon_with_log_level(log_level: Option<String>) -> Result<()> {
    println!("\x1b[32mRestarting pankha-agent v{} ({})\x1b[0m", env!("CARGO_PKG_VERSION"), std::env::consts::ARCH);

    // Check if systemd service is actively managing the process
    // If so, delegate to systemctl to prevent auto-restart conflicts
    if is_systemd_service_active() {
        println!("Agent is managed by systemd. Using systemctl restart...");
        let status = process::Command::new("systemctl")
            .args(["restart", "pankha-agent"])
            .status();
        
        match status {
            Ok(s) if s.success() => {
                println!("Agent restarted via systemd");
                return Ok(());
            }
            Ok(_) => {
                eprintln!("WARNING: systemctl restart failed, falling back to manual restart");
            }
            Err(e) => {
                eprintln!("WARNING: Could not run systemctl: {}, falling back to manual restart", e);
            }
        }
    }

    // Manual restart (for non-systemd systems or systemctl fallback)
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
    start_daemon_with_log_level(log_level)
}

fn set_log_level_runtime(level: &str) -> Result<()> {
    // Validate log level
    let valid_levels = ["trace", "debug", "info", "warn", "error", "critical"];
    let level_lower = level.to_lowercase();
    if !valid_levels.contains(&level_lower.as_str()) {
        return Err(anyhow::anyhow!(
            "Invalid log level '{}'. Valid levels: TRACE, DEBUG, INFO, WARN, ERROR, CRITICAL",
            level
        ));
    }

    // Check if agent is running
    if !is_running() {
        return Err(anyhow::anyhow!(
            "Agent is not running. Start the agent first with: --start"
        ));
    }

    // Load current config
    let config_path = std::env::current_exe()?
        .parent()
        .ok_or_else(|| anyhow::anyhow!("Cannot determine executable directory"))?
        .join("config.json");

    let content = std::fs::read_to_string(&config_path)?;
    let mut config: AgentConfig = serde_json::from_str(&content)?;

    // Update log level in config
    let old_level = config.agent.log_level.clone();
    config.agent.log_level = level.to_uppercase();

    // Save updated config
    let content = serde_json::to_string_pretty(&config)?;
    std::fs::write(&config_path, content)?;

    println!("Log level updated: {} → {}", old_level, level.to_uppercase());
    println!("Configuration saved to: {:?}", config_path);

    // Send SIGHUP to running agent to reload config
    if let Some(pid) = get_pid()? {
        println!("Sending reload signal to agent (PID: {})...", pid);
        unsafe { libc::kill(pid as i32, libc::SIGHUP) };
        println!("✅ Log level changed successfully");
        println!("\nNote: New log level will be applied immediately.");
        println!("      Logs are written to: {}/agent.log", LOG_DIR);
        println!("      View logs with: ./pankha-agent -l");
    }

    Ok(())
}

async fn show_status() -> Result<()> {
    println!("\x1b[32mpankha-agent v{} ({})\x1b[0m", env!("CARGO_PKG_VERSION"), std::env::consts::ARCH);
    println!("================================");

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

/// Run health check to verify agent installation
fn run_health_check() -> Result<()> {
    println!("\x1b[32mpankha-agent v{} ({})\x1b[0m", env!("CARGO_PKG_VERSION"), std::env::consts::ARCH);
    println!("Health Check");
    println!("============\n");
    
    let mut all_ok = true;
    
    // Check config file
    let exe_path = std::env::current_exe()?;
    let config_path = exe_path
        .parent()
        .ok_or_else(|| anyhow::anyhow!("Cannot determine executable directory"))?
        .join("config.json");
    
    if config_path.exists() {
        println!("✓ Config file: {}", config_path.display());
    } else {
        println!("✗ Config file: NOT FOUND");
        println!("  Run: ./pankha-agent --setup");
        all_ok = false;
    }
    
    // Check directories
    if Path::new("/run/pankha-agent").exists() {
        println!("✓ Runtime dir: /run/pankha-agent");
    } else {
        println!("⚠ Runtime dir: Not created (will be created on start)");
    }
    
    if Path::new(LOG_DIR).exists() {
        println!("✓ Log dir: {}", LOG_DIR);
    } else {
        println!("⚠ Log dir: Not created (will be created on start)");
    }
    
    // Check systemd service (Linux only)
    #[cfg(target_os = "linux")]
    {
        if has_systemd() {
            if Path::new(SYSTEMD_SERVICE_PATH).exists() {
                // Check if enabled
                let enabled = process::Command::new("systemctl")
                    .args(["is-enabled", "pankha-agent"])
                    .output()
                    .map(|o| o.status.success())
                    .unwrap_or(false);
                
                if enabled {
                    println!("✓ Systemd service: Installed and enabled");
                } else {
                    println!("⚠ Systemd service: Installed but NOT enabled");
                    println!("  Run: sudo systemctl enable pankha-agent");
                }
            } else {
                println!("✗ Systemd service: NOT INSTALLED");
                println!("  Run: sudo ./pankha-agent --install-service");
                all_ok = false;
            }
        } else {
            println!("- Systemd: Not available on this system");
        }
    }
    
    // Check agent status
    if is_running() {
        if let Ok(Some(pid)) = get_pid() {
            println!("✓ Agent status: Running (PID: {})", pid);
        }
    } else {
        println!("⚠ Agent status: Not running");
        all_ok = false;
    }
    
    println!();
    if all_ok {
        println!("\x1b[32m✓ All checks passed!\x1b[0m");
    } else {
        println!("\x1b[33m⚠ Some issues found - see above\x1b[0m");
    }
    
    Ok(())
}

// ============================================================================
// MAIN APPLICATION
// ============================================================================

use clap::{Parser, CommandFactory};
use tracing_subscriber::{reload, EnvFilter};

// Global reload handle for dynamic log level changes
type ReloadHandle = reload::Handle<EnvFilter, tracing_subscriber::Registry>;
static RELOAD_HANDLE: std::sync::OnceLock<ReloadHandle> = std::sync::OnceLock::new();

// Custom time formatter for logs: "YYYY-MM-DD HH:MM:SS" (local time)
struct LocalTimeFormatter;

impl tracing_subscriber::fmt::time::FormatTime for LocalTimeFormatter {
    fn format_time(&self, w: &mut tracing_subscriber::fmt::format::Writer<'_>) -> std::fmt::Result {
        // Use libc's localtime to get local time components
        #[cfg(unix)]
        unsafe {
            let now = libc::time(std::ptr::null_mut());
            let mut tm: libc::tm = std::mem::zeroed();
            libc::localtime_r(&now, &mut tm);

            write!(w, "{:04}-{:02}-{:02} {:02}:{:02}:{:02}",
                tm.tm_year + 1900,
                tm.tm_mon + 1,
                tm.tm_mday,
                tm.tm_hour,
                tm.tm_min,
                tm.tm_sec)
        }

        #[cfg(not(unix))]
        {
            // Fallback for non-Unix systems
            write!(w, "{}", chrono::Local::now().format("%Y-%m-%d %H:%M:%S"))
        }
    }
}

// Custom event formatter for logs: "YYYY-MM-DD HH:MM:SS [LEVEL] message"
struct CustomEventFormat;

impl<S, N> tracing_subscriber::fmt::FormatEvent<S, N> for CustomEventFormat
where
    S: tracing::Subscriber + for<'a> tracing_subscriber::registry::LookupSpan<'a>,
    N: for<'a> tracing_subscriber::fmt::FormatFields<'a> + 'static,
{
    fn format_event(
        &self,
        ctx: &tracing_subscriber::fmt::FmtContext<'_, S, N>,
        mut writer: tracing_subscriber::fmt::format::Writer<'_>,
        event: &tracing::Event<'_>,
    ) -> std::fmt::Result {
        use tracing_subscriber::fmt::time::FormatTime;

        // Write timestamp
        LocalTimeFormatter.format_time(&mut writer)?;
        write!(writer, " ")?;

        // Write level in brackets with color
        let level = event.metadata().level();
        let level_color = match *level {
            tracing::Level::TRACE => "\x1b[2m",  // Dim/gray
            tracing::Level::DEBUG => "\x1b[34m", // Blue
            tracing::Level::INFO => "\x1b[32m",  // Green
            tracing::Level::WARN => "\x1b[33m",  // Yellow
            tracing::Level::ERROR => "\x1b[31m", // Red
        };
        write!(writer, "{}[{}]\x1b[0m ", level_color, level)?;

        // Write the message and fields
        ctx.field_format().format_fields(writer.by_ref(), event)?;

        writeln!(writer)
    }
}

const HELP_TEXT: &str = "
Pankha Cross-Platform Hardware Monitoring Agent
Usage: pankha-agent-linux_x86_64 [OPTIONS]

Options:
  -h, --help                    Print help
  -V, --version                 Print version
Setup & Service:
  -e, --setup                   Run interactive setup wizard
  -I, --install-service         Install systemd service for auto-start on boot
  -U, --uninstall-service       Uninstall systemd service
Daemon Control:
  -s, --start                   Start the agent daemon in background
  -x, --stop                    Stop the agent daemon
  -r, --restart                 Restart the agent daemon
Status & Logs:
  -i, --status                  Show agent status
  -l, --log-show [<LOG_SHOW>]   Show agent logs (tail -f by default, or tail -n <lines> if provided)
      --log-level <LOG_LEVEL>   Set log level (TRACE, DEBUG, INFO, WARN, ERROR). Use with --start/--restart
Config & Debug:
  -c, --config                  Show current configuration
      --check                   Run health check (verify config, service, directories)
      --test                    Test mode (hardware discovery only)
";

#[derive(Parser, Debug)]
#[command(name = "pankha-agent")]
#[command(version = env!("CARGO_PKG_VERSION"))]
#[command(about = "Pankha Cross-Platform Hardware Monitoring Agent", long_about = None)]
#[command(after_help = "")]
#[command(disable_help_flag = false)]
struct Args {
    // === Setup & Service ===
    /// Run interactive setup wizard
    #[arg(short = 'e', long, help_heading = "Setup & Service")]
    setup: bool,

    /// Install systemd service for auto-start on boot
    #[arg(short = 'I', long = "install-service", help_heading = "Setup & Service")]
    install_service: bool,

    /// Uninstall systemd service
    #[arg(short = 'U', long = "uninstall-service", help_heading = "Setup & Service")]
    uninstall_service: bool,

    // === Daemon Control ===
    /// Start the agent daemon in background
    #[arg(short = 's', long, help_heading = "Daemon Control")]
    start: bool,

    /// Stop the agent daemon
    #[arg(short = 'x', long, help_heading = "Daemon Control")]
    stop: bool,

    /// Restart the agent daemon
    #[arg(short = 'r', long, help_heading = "Daemon Control")]
    restart: bool,

    // === Status & Logs ===
    /// Show agent status
    #[arg(short = 'i', long = "status", help_heading = "Status & Logs")]
    status: bool,

    /// Show agent logs (tail -f by default, or tail -n <lines> if provided)
    #[arg(short = 'l', long = "log-show", help_heading = "Status & Logs")]
    log_show: Option<Option<usize>>,

    /// Set log level (TRACE, DEBUG, INFO, WARN, ERROR). Use with --start/--restart
    #[arg(long = "log-level", help_heading = "Status & Logs")]
    log_level: Option<String>,

    // === Config & Debug ===
    /// Show current configuration
    #[arg(short = 'c', long, help_heading = "Config & Debug")]
    config: bool,

    /// Run health check (verify config, service, directories)
    #[arg(long, help_heading = "Config & Debug")]
    check: bool,

    /// Test mode (hardware discovery only)
    #[arg(long, help_heading = "Config & Debug")]
    test: bool,

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
            // Check if this is a help request
            if err.kind() == clap::error::ErrorKind::DisplayHelp {
                print!("{}", HELP_TEXT);
                process::exit(0);
            }
            // Custom version output with architecture (green)
            if err.kind() == clap::error::ErrorKind::DisplayVersion {
                println!("\x1b[32mpankha-agent {} ({})\x1b[0m", env!("CARGO_PKG_VERSION"), std::env::consts::ARCH);
                process::exit(0);
            }

            // For other errors, print the error
            eprintln!("{}", err);
            eprintln!();

            // Then print full help for clarity
            print!("{}", HELP_TEXT);
            eprintln!();
            eprintln!("\nFor more information, try '--help'.");

            process::exit(1);
        }
    };

    // Handle management commands first (before async setup)
    if args.start {
        return start_daemon_with_log_level(args.log_level);  // Spawns new process and exits
    }

    if args.stop {
        return stop_daemon();
    }

    if args.restart {
        return restart_daemon_with_log_level(args.log_level);
    }

    if args.status {
        return show_status().await;
    }

    if args.check {
        return run_health_check();
    }

    // Systemd service management (Linux only)
    #[cfg(target_os = "linux")]
    if args.install_service {
        return install_systemd_service();
    }

    #[cfg(target_os = "linux")]
    if args.uninstall_service {
        return uninstall_systemd_service();
    }

    if let Some(lines) = args.log_show {
        // Show agent logs
        let log_path = format!("{}/agent.log", LOG_DIR);

        let mut cmd = process::Command::new("tail");

        match lines {
            Some(n) => {
                // Show last N lines: tail -n <lines>
                println!("Showing last {} log entries...", n);
                println!("\x1b[32mpankha-agent v{} ({})\x1b[0m\n", env!("CARGO_PKG_VERSION"), std::env::consts::ARCH);
                cmd.arg("-n").arg(n.to_string());
            }
            None => {
                // Follow logs: tail -f
                println!("Showing live agent logs (Ctrl+C to exit)...");
                println!("\x1b[32mpankha-agent v{} ({})\x1b[0m\n", env!("CARGO_PKG_VERSION"), std::env::consts::ARCH);
                cmd.arg("-f");
            }
        }

        cmd.arg(&log_path);
        let status = cmd.status()?;
        process::exit(status.code().unwrap_or(1));
    }

    // If user provided --log-level without other commands, set it for running agent
    if let Some(level) = args.log_level.as_ref() {
        if !args.daemon_child && !args.test && !args.config && !args.setup {
            // Set log level for running agent
            return set_log_level_runtime(level);
        }
    }

    // If no command was provided at all (user just ran the binary), show help
    if !args.daemon_child && !args.test && !args.config && !args.setup {
        eprintln!("ERROR: No command specified. You must specify a command.");
        eprintln!();
        Args::command().print_help().unwrap();
        eprintln!();
        eprintln!("Common commands:");
        eprintln!("  ./pankha-agent --start       Start the agent");
        eprintln!("  ./pankha-agent --stop        Stop the agent");
        eprintln!("  ./pankha-agent -i            Show status");
        eprintln!("  ./pankha-agent -l            View logs");
        process::exit(1);
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

    // Set up tracing with reload capability for dynamic log level changes
    use tracing_subscriber::prelude::*;

    let env_filter = EnvFilter::new(filter);
    let (filter_layer, reload_handle) = reload::Layer::new(env_filter);

    tracing_subscriber::registry()
        .with(filter_layer)
        .with(
            tracing_subscriber::fmt::layer()
                .with_timer(LocalTimeFormatter)
                .with_target(false) // Hide the target (crate name)
                .with_level(true)   // Show level
                .fmt_fields(tracing_subscriber::fmt::format::DefaultFields::new())
                .event_format(CustomEventFormat)
        )
        .init();

    // Store reload handle in the global static for signal handler access
    let _ = RELOAD_HANDLE.set(reload_handle);

    // If we're a daemon child, save our PID and continue
    if args.daemon_child {
        ensure_directories()?;
        save_pid(process::id())?;
    }

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

    // Log startup message (only for normal operation, not setup/config commands)
    info!("Pankha Agent v{} starting ({})", env!("CARGO_PKG_VERSION"), std::env::consts::OS);

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

    // Setup SIGHUP handler for log level reload
    #[cfg(target_os = "linux")]
    if args.daemon_child {
        use tokio::signal::unix::{signal, SignalKind};
        let mut sighup = signal(SignalKind::hangup()).expect("Failed to setup SIGHUP handler");

        tokio::spawn(async move {
            loop {
                sighup.recv().await;
                info!("SIGHUP received, reloading log level configuration");

                // Reload config from file
                match load_config(None).await {
                    Ok(new_config) => {
                        let new_level = new_config.agent.log_level.to_lowercase();
                        let filter = match new_level.as_str() {
                            "critical" => "error",
                            "trace" => "trace",
                            "debug" => "debug",
                            "info" => "info",
                            "warn" => "warn",
                            "error" => "error",
                            _ => "info",
                        };

                        // Reload the tracing filter
                        if let Some(handle) = RELOAD_HANDLE.get() {
                            match handle.reload(EnvFilter::new(filter)) {
                                Ok(_) => info!("Log level reloaded: {}", new_level.to_uppercase()),
                                Err(e) => error!("Failed to reload log level: {}", e),
                            }
                        }
                    }
                    Err(e) => error!("Failed to reload config: {}", e),
                }
            }
        });
    }

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
