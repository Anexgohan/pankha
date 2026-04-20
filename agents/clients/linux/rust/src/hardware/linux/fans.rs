//! Linux hardware monitor: hwmon fan discovery.

use std::sync::Arc;

use anyhow::Result;
use tokio::sync::RwLock;

use crate::hardware::types::*;

use super::monitor::FanInfo;

#[cfg(target_os = "linux")]
impl super::monitor::LinuxHardwareMonitor {
    pub(crate) async fn discover_hwmon_fans(&self) -> Result<Vec<Fan>> {
        let mut fans = Vec::new();
        let mut fan_map = self.discovered_fans.write().await;
        // DON'T CLEAR - keep existing entries with their cached state
        // fan_map.clear();  // <- REMOVED - This causes race conditions

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
