//! Linux hardware monitor: hwmon sensor discovery and classification.

use std::path::Path;

use anyhow::Result;

use crate::hardware::types::*;

#[cfg(target_os = "linux")]
impl super::monitor::LinuxHardwareMonitor {
    pub(crate) async fn discover_hwmon_sensors(&self) -> Result<Vec<Sensor>> {
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
}
