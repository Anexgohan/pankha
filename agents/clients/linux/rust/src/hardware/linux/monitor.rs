//! Linux hardware monitor: core struct, constructors, trait impl, and utility methods.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use anyhow::{Context, Result};
use async_trait::async_trait;
use tokio::sync::RwLock;
use tracing::{debug, error, warn};

use crate::config::types::HardwareSettings;
use crate::hardware::types::*;
use crate::hardware::HardwareMonitor;

#[cfg(target_os = "linux")]
pub(crate) struct FanInfo {
    pub(crate) pwm_path: PathBuf,
    pub(crate) rpm_path: PathBuf,
    pub(crate) pwm_enable_path: Option<PathBuf>,
    pub(crate) chip_name: String,
    pub(crate) last_pwm_value: Arc<RwLock<Option<u8>>>,
    pub(crate) last_write_time: Arc<RwLock<std::time::Instant>>,
}

/// Cached sensor metadata and path for efficient reading
#[cfg(target_os = "linux")]
#[derive(Clone)]
pub(crate) struct SensorInfo {
    pub(crate) temp_input_path: PathBuf,
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) sensor_type: String,
    pub(crate) max_temp: Option<f64>,
    pub(crate) crit_temp: Option<f64>,
    pub(crate) chip: Option<String>,
    pub(crate) hardware_name: Option<String>,
    pub(crate) source: Option<String>,
}

#[cfg(target_os = "linux")]
pub struct LinuxHardwareMonitor {
    pub(crate) hwmon_base: PathBuf,
    #[allow(dead_code)]
    pub(crate) thermal_base: PathBuf,
    pub(crate) discovered_fans: Arc<RwLock<HashMap<String, FanInfo>>>,
    pub(crate) discovered_sensors: Arc<RwLock<HashMap<String, SensorInfo>>>,
    pub(crate) cached_hwmon_count: Arc<RwLock<usize>>,
    pub(crate) last_discovery_from_cache: Arc<RwLock<bool>>,
    pub(crate) system_info: Arc<RwLock<sysinfo::System>>,
    pub(crate) system_info_cache: Arc<RwLock<Option<(SystemHealth, std::time::Instant)>>>,
    pub(crate) cpu_brand: String,
    pub(crate) motherboard_name: String,
    pub(crate) storage_cache: Arc<RwLock<HashMap<String, String>>>,
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

    pub(crate) async fn resolve_storage_model(&self, hwmon_dir: &Path, chip_name: &str) -> Option<String> {
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

    pub(crate) async fn read_file(&self, path: &Path) -> Result<String> {
        tokio::fs::read_to_string(path)
            .await
            .context(format!("Failed to read file: {:?}", path))
            .map(|s| s.trim().to_string())
    }

    pub(crate) async fn write_file(&self, path: &Path, value: &str) -> Result<()> {
        tokio::fs::write(path, value)
            .await
            .context(format!("Failed to write to file: {:?}", path))
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

    async fn dump_hardware_info(&self) -> Result<HardwareDumpRoot> {
        // Delegate to the inherent impl method
        LinuxHardwareMonitor::dump_hardware_info(self).await
    }
}
