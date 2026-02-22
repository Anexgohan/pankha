//! Linux hardware monitor: hardware diagnostic dump generation.

use std::path::{Path, PathBuf};

use anyhow::Result;
use tracing::info;

use crate::hardware::types::*;

#[cfg(target_os = "linux")]
impl super::monitor::LinuxHardwareMonitor {
    /// Generate comprehensive hardware dump for diagnostics
    /// Dynamically discovers all hardware via sysfs - no hardcoded paths
    pub async fn dump_hardware_info(&self) -> Result<HardwareDumpRoot> {
        info!("Generating hardware-info.json dump...");

        let mut dump = HardwareDumpRoot {
            metadata: self.build_dump_metadata().await,
            hardware: Vec::new(),
        };

        // Discover all hwmon devices dynamically
        if self.hwmon_base.exists() {
            let mut entries = tokio::fs::read_dir(&self.hwmon_base).await?;
            while let Some(entry) = entries.next_entry().await? {
                let hwmon_dir = entry.path();
                if !hwmon_dir.is_dir() {
                    continue;
                }

                if let Ok(item) = self.build_hwmon_dump_item(&hwmon_dir).await {
                    dump.hardware.push(item);
                }
            }
        }

        // Add thermal zones as separate hardware items
        let thermal_base = PathBuf::from("/sys/class/thermal");
        if thermal_base.exists() {
            let mut entries = tokio::fs::read_dir(&thermal_base).await?;
            while let Some(entry) = entries.next_entry().await? {
                let zone_dir = entry.path();
                let name = zone_dir.file_name().unwrap_or_default().to_string_lossy();
                if !name.starts_with("thermal_zone") {
                    continue;
                }

                if let Ok(item) = self.build_thermal_zone_dump_item(&zone_dir).await {
                    dump.hardware.push(item);
                }
            }
        }

        info!("Hardware dump complete: {} devices discovered", dump.hardware.len());
        Ok(dump)
    }

    async fn build_dump_metadata(&self) -> HardwareDumpMetadata {
        let agent_version = env!("CARGO_PKG_VERSION").to_string();

        // Get OS version from /etc/os-release or fallback
        let os_version = self.read_file(Path::new("/etc/os-release")).await
            .ok()
            .and_then(|content| {
                content.lines()
                    .find(|l| l.starts_with("PRETTY_NAME="))
                    .map(|l| l.trim_start_matches("PRETTY_NAME=").trim_matches('"').to_string())
            })
            .unwrap_or_else(|| std::env::consts::OS.to_string());

        // Get kernel version
        let kernel_version = self.read_file(Path::new("/proc/version")).await
            .ok()
            .map(|v| v.split_whitespace().nth(2).unwrap_or("").to_string());

        // Check if running as root
        let is_elevated = unsafe { libc::getuid() } == 0;

        // Get motherboard info from DMI
        let motherboard = {
            let vendor = self.read_file(Path::new("/sys/class/dmi/id/board_vendor")).await.ok();
            let name = self.read_file(Path::new("/sys/class/dmi/id/board_name")).await.ok();
            match (vendor, name) {
                (Some(v), Some(n)) => Some(format!("{} {}", v, n)),
                (None, Some(n)) => Some(n),
                (Some(v), None) => Some(v),
                _ => None,
            }
        };

        HardwareDumpMetadata {
            agent_version,
            os_version,
            is_elevated,
            timestamp: chrono::Utc::now().to_rfc3339(),
            motherboard,
            kernel_version,
            cpu_model: Some(self.cpu_brand.clone()),
        }
    }

    async fn build_hwmon_dump_item(&self, hwmon_dir: &Path) -> Result<HardwareDumpItem> {
        let chip_name = self.read_file(&hwmon_dir.join("name")).await
            .unwrap_or_else(|_| "unknown".to_string());

        let hwmon_name = hwmon_dir.file_name().unwrap_or_default().to_string_lossy();
        let identifier = format!("/hwmon/{}", hwmon_name);
        let hardware_type = Self::classify_hardware_type(&chip_name);

        let mut sensors = Vec::new();

        // Discover temperature sensors: temp*_input
        for i in 1..=20 {
            let temp_input = hwmon_dir.join(format!("temp{}_input", i));
            if !temp_input.exists() { continue; }

            if let Ok(sensor) = self.build_temp_sensor_dump(&hwmon_dir, i, &chip_name).await {
                sensors.push(sensor);
            }
        }

        // Discover fan sensors: fan*_input
        for i in 1..=10 {
            let fan_input = hwmon_dir.join(format!("fan{}_input", i));
            if !fan_input.exists() { continue; }

            if let Ok(sensor) = self.build_fan_sensor_dump(&hwmon_dir, i, &chip_name).await {
                sensors.push(sensor);
            }
        }

        // Discover PWM controls: pwm*
        for i in 1..=10 {
            let pwm_file = hwmon_dir.join(format!("pwm{}", i));
            if !pwm_file.exists() { continue; }

            if let Ok(sensor) = self.build_pwm_sensor_dump(&hwmon_dir, i, &chip_name).await {
                sensors.push(sensor);
            }
        }

        // Discover voltage sensors: in*_input
        for i in 0..=15 {
            let in_input = hwmon_dir.join(format!("in{}_input", i));
            if !in_input.exists() { continue; }

            if let Ok(sensor) = self.build_voltage_sensor_dump(&hwmon_dir, i, &chip_name).await {
                sensors.push(sensor);
            }
        }

        Ok(HardwareDumpItem {
            name: chip_name.clone(),
            identifier,
            hardware_type,
            parent: None,
            technical_id: Some(chip_name),
            sensors,
            sub_hardware: Vec::new(),
        })
    }

    async fn build_temp_sensor_dump(&self, hwmon_dir: &Path, index: u32, chip_name: &str) -> Result<HardwareDumpSensor> {
        let temp_input = hwmon_dir.join(format!("temp{}_input", index));
        let temp_label = hwmon_dir.join(format!("temp{}_label", index));
        let temp_max = hwmon_dir.join(format!("temp{}_max", index));
        let temp_crit = hwmon_dir.join(format!("temp{}_crit", index));
        let temp_min = hwmon_dir.join(format!("temp{}_min", index));

        let value_raw: i32 = self.read_file(&temp_input).await?.parse()?;
        let value = value_raw as f32 / 1000.0;

        let label = self.read_file(&temp_label).await.ok()
            .unwrap_or_else(|| format!("temp{}", index));

        let max = self.read_file(&temp_max).await.ok()
            .and_then(|s| s.parse::<i32>().ok())
            .map(|v| format!("{}", v as f32 / 1000.0))
            .unwrap_or_else(|| "null".to_string());

        let min = self.read_file(&temp_min).await.ok()
            .and_then(|s| s.parse::<i32>().ok())
            .map(|v| format!("{}", v as f32 / 1000.0))
            .unwrap_or_else(|| "null".to_string());

        let _crit = self.read_file(&temp_crit).await.ok()
            .and_then(|s| s.parse::<i32>().ok());

        Ok(HardwareDumpSensor {
            name: label.clone(),
            identifier: format!("/{}/temp/{}", chip_name, index),
            sensor_type: "Temperature".to_string(),
            value: Some(value),
            min,
            max,
            is_monitored: true,
            is_connected: None,
            control: None,
        })
    }

    async fn build_fan_sensor_dump(&self, hwmon_dir: &Path, index: u32, chip_name: &str) -> Result<HardwareDumpSensor> {
        let fan_input = hwmon_dir.join(format!("fan{}_input", index));
        let fan_min = hwmon_dir.join(format!("fan{}_min", index));

        let rpm: u32 = self.read_file(&fan_input).await?.parse()?;
        let is_connected = rpm > 0;

        let min = self.read_file(&fan_min).await.ok()
            .unwrap_or_else(|| "0".to_string());

        Ok(HardwareDumpSensor {
            name: format!("Fan {}", index),
            identifier: format!("/{}/fan/{}", chip_name, index),
            sensor_type: "Fan".to_string(),
            value: Some(rpm as f32),
            min,
            max: "null".to_string(),
            is_monitored: true,
            is_connected: Some(is_connected),
            control: Some(HardwareDumpControlInfo {
                linked_sensor_id: Some(format!("/{}/control/{}", chip_name, index)),
                method: "sysfs".to_string(),
                can_write: false,
                can_restore_default: false,
                current_percent: None,
                range: [0, 100],
                mode: None,
            }),
        })
    }

    async fn build_pwm_sensor_dump(&self, hwmon_dir: &Path, index: u32, chip_name: &str) -> Result<HardwareDumpSensor> {
        let pwm_file = hwmon_dir.join(format!("pwm{}", index));
        let pwm_enable = hwmon_dir.join(format!("pwm{}_enable", index));

        let pwm_value: u8 = self.read_file(&pwm_file).await?.parse()?;
        let percent = (pwm_value as f32 / 255.0 * 100.0).round();

        let enable_mode = self.read_file(&pwm_enable).await.ok()
            .and_then(|s| s.parse::<u8>().ok());

        let mode_str = match enable_mode {
            Some(0) => Some("Disabled".to_string()),
            Some(1) => Some("Manual".to_string()),
            Some(2) => Some("Automatic".to_string()),
            _ => None,
        };

        let can_write = pwm_file.metadata()
            .map(|m| {
                use std::os::unix::fs::PermissionsExt;
                m.permissions().mode() & 0o200 != 0
            })
            .unwrap_or(false);

        Ok(HardwareDumpSensor {
            name: format!("Fan Control {}", index),
            identifier: format!("/{}/control/{}", chip_name, index),
            sensor_type: "Control".to_string(),
            value: Some(percent),
            min: "0".to_string(),
            max: "100".to_string(),
            is_monitored: true,
            is_connected: None,
            control: Some(HardwareDumpControlInfo {
                linked_sensor_id: Some(format!("/{}/fan/{}", chip_name, index)),
                method: "sysfs".to_string(),
                can_write,
                can_restore_default: enable_mode == Some(2),
                current_percent: Some(percent),
                range: [0, 100],
                mode: mode_str,
            }),
        })
    }

    async fn build_voltage_sensor_dump(&self, hwmon_dir: &Path, index: u32, chip_name: &str) -> Result<HardwareDumpSensor> {
        let in_input = hwmon_dir.join(format!("in{}_input", index));
        let in_label = hwmon_dir.join(format!("in{}_label", index));
        let in_min = hwmon_dir.join(format!("in{}_min", index));
        let in_max = hwmon_dir.join(format!("in{}_max", index));

        let value_mv: i32 = self.read_file(&in_input).await?.parse()?;
        let value_v = value_mv as f32 / 1000.0;

        let label = self.read_file(&in_label).await.ok()
            .unwrap_or_else(|| format!("in{}", index));

        let min = self.read_file(&in_min).await.ok()
            .and_then(|s| s.parse::<i32>().ok())
            .map(|v| format!("{:.3}", v as f32 / 1000.0))
            .unwrap_or_else(|| "null".to_string());

        let max = self.read_file(&in_max).await.ok()
            .and_then(|s| s.parse::<i32>().ok())
            .map(|v| format!("{:.3}", v as f32 / 1000.0))
            .unwrap_or_else(|| "null".to_string());

        Ok(HardwareDumpSensor {
            name: label,
            identifier: format!("/{}/voltage/{}", chip_name, index),
            sensor_type: "Voltage".to_string(),
            value: Some(value_v),
            min,
            max,
            is_monitored: false,
            is_connected: None,
            control: None,
        })
    }

    async fn build_thermal_zone_dump_item(&self, zone_dir: &Path) -> Result<HardwareDumpItem> {
        let zone_name = zone_dir.file_name().unwrap_or_default().to_string_lossy().to_string();
        let zone_type = self.read_file(&zone_dir.join("type")).await
            .unwrap_or_else(|_| "unknown".to_string());

        let temp_raw: i32 = self.read_file(&zone_dir.join("temp")).await?.parse()?;
        let temp_c = temp_raw as f32 / 1000.0;

        let sensor = HardwareDumpSensor {
            name: zone_type.clone(),
            identifier: format!("/thermal/{}/temp/0", zone_name),
            sensor_type: "Temperature".to_string(),
            value: Some(temp_c),
            min: "null".to_string(),
            max: "null".to_string(),
            is_monitored: true,
            is_connected: None,
            control: None,
        };

        Ok(HardwareDumpItem {
            name: format!("Thermal Zone: {}", zone_type),
            identifier: format!("/thermal/{}", zone_name),
            hardware_type: "ThermalZone".to_string(),
            parent: None,
            technical_id: Some(zone_type),
            sensors: vec![sensor],
            sub_hardware: Vec::new(),
        })
    }

    fn classify_hardware_type(chip_name: &str) -> String {
        let lower = chip_name.to_lowercase();
        if lower.contains("k10temp") || lower.contains("coretemp") || lower.contains("cpu") {
            "Cpu".to_string()
        } else if lower.contains("nvme") {
            "Storage".to_string()
        } else if lower.contains("it8") || lower.contains("nct") || lower.contains("asus") || lower.contains("gigabyte") {
            "SuperIO".to_string()
        } else if lower.contains("acpi") {
            "ACPI".to_string()
        } else if lower.contains("amdgpu") || lower.contains("nouveau") || lower.contains("nvidia") {
            "Gpu".to_string()
        } else {
            "Other".to_string()
        }
    }
}
