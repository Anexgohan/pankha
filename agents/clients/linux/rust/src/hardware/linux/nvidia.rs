//! NVIDIA GPU monitoring + fan control via NVML (`libnvidia-ml`).
//!
//! Additive source inside `LinuxHardwareMonitor`: appends GPU temperature sensors and
//! one logical fan per GPU to the sysfs discovery results. NVML is loaded at runtime by
//! `nvml-wrapper` (dlopen); if the NVIDIA driver/NVML is absent, `try_init()` returns
//! `None` and every GPU path is a no-op, so non-NVIDIA hosts are unaffected.
//!
//! Fan writes require root (NVML returns "Insufficient Permissions" otherwise); the agent
//! already runs as a root systemd daemon. The GPU is never put under manual control at
//! discovery - it stays on the driver's auto curve until the backend issues `set_fan_speed`.

use anyhow::{Context, Result};
use nvml_wrapper::enum_wrappers::device::TemperatureSensor;
use nvml_wrapper::Nvml;
use tracing::{debug, warn};

use crate::hardware::types::{Fan, Sensor};

/// Optional NVML-backed GPU source. Present only when the NVIDIA driver/NVML is available.
pub(crate) struct NvmlSource {
    nvml: Nvml,
}

impl NvmlSource {
    /// Returns `None` (not an error) when NVML/driver is absent, so AMD-only or GPU-less
    /// machines degrade gracefully. Also returns `None` if NVML loads but reports no devices.
    pub(crate) fn try_init() -> Option<Self> {
        match Nvml::init() {
            Ok(nvml) => match nvml.device_count() {
                Ok(0) | Err(_) => {
                    debug!("NVML initialized but no usable NVIDIA devices found");
                    None
                }
                Ok(count) => {
                    debug!("NVML initialized: {} NVIDIA device(s)", count);
                    Some(Self { nvml })
                }
            },
            Err(e) => {
                debug!("NVML not available (no NVIDIA driver?): {}", e);
                None
            }
        }
    }

    /// True if `fan_id` is an NVML-owned GPU fan (id form: `nvidia_gpu<idx>_fan`).
    pub(crate) fn owns_fan(fan_id: &str) -> bool {
        fan_id.starts_with("nvidia_gpu") && fan_id.ends_with("_fan")
    }

    /// Parse the GPU index out of an id like `nvidia_gpu0_fan` / `nvidia_gpu0_temp`.
    fn index_from_id(id: &str) -> Option<u32> {
        id.strip_prefix("nvidia_gpu")
            .and_then(|rest| rest.split('_').next())
            .and_then(|n| n.parse::<u32>().ok())
    }

    /// GPU temperature sensors (one per device). Read-only; never moves a fan. Per-device
    /// errors are logged and skipped so a GPU hiccup never breaks sysfs telemetry.
    pub(crate) fn discover_sensors(&self) -> Vec<Sensor> {
        let mut out = Vec::new();
        let count = self.nvml.device_count().unwrap_or(0);
        for idx in 0..count {
            let device = match self.nvml.device_by_index(idx) {
                Ok(d) => d,
                Err(e) => {
                    warn!("NVML device {} unavailable: {}", idx, e);
                    continue;
                }
            };
            let temp = match device.temperature(TemperatureSensor::Gpu) {
                Ok(t) => t as f64,
                Err(e) => {
                    warn!("NVML temp read failed (gpu {}): {}", idx, e);
                    continue;
                }
            };
            let name = device
                .name()
                .unwrap_or_else(|_| format!("NVIDIA GPU {}", idx));
            out.push(Sensor {
                id: format!("nvidia_gpu{}_temp", idx),
                name,
                temperature: temp,
                sensor_type: "gpu".to_string(),
                max_temp: None, // TODO(P3): NVML temperature thresholds (slowdown/shutdown)
                crit_temp: None,
                chip: Some("gpu".to_string()),
                hardware_name: None,
                source: Some("nvidia_nvml".to_string()),
            });
        }
        out
    }

    /// One logical fan per GPU (NVML may expose several fan indices per card; we collapse
    /// to one Pankha fan and fan out on writes). Read-only.
    pub(crate) fn discover_fans(&self) -> Vec<Fan> {
        let mut out = Vec::new();
        let count = self.nvml.device_count().unwrap_or(0);
        for idx in 0..count {
            let device = match self.nvml.device_by_index(idx) {
                Ok(d) => d,
                Err(_) => continue,
            };
            let num = device.num_fans().unwrap_or(0);
            if num == 0 {
                continue;
            }

            // Honest capability probe (no fan movement): advertise control only if the
            // driver genuinely exposes a writable fan-speed range for this card.
            let has_pwm_control = device.min_max_fan_speed().is_ok();

            // Representative readings from fan index 0.
            let speed = device.fan_speed(0).unwrap_or(0).min(100) as u8;
            let rpm = device.fan_speed_rpm(0).ok();
            let name = device
                .name()
                .unwrap_or_else(|_| format!("NVIDIA GPU {}", idx));

            out.push(Fan {
                id: format!("nvidia_gpu{}_fan", idx),
                name: format!("{} Fan", name),
                rpm,
                speed,
                target_speed: speed,
                status: if speed == 0 && rpm == Some(0) {
                    "stopped".to_string()
                } else {
                    "ok".to_string()
                },
                has_pwm_control,
                pwm_file: None,
            });
        }
        out
    }

    /// Set the GPU fan to `pct`% (manual control). `set_fan_speed` takes manual control
    /// implicitly; fans out over all NVML fan indices for this card.
    pub(crate) fn set_fan_speed(&self, fan_id: &str, pct: u8) -> Result<()> {
        let idx = Self::index_from_id(fan_id)
            .with_context(|| format!("malformed NVML fan id: {}", fan_id))?;
        let pct = pct.min(100) as u32;
        let mut device = self
            .nvml
            .device_by_index(idx)
            .with_context(|| format!("NVML device {} not found", idx))?;
        let num = device.num_fans().unwrap_or(1).max(1);
        for fan in 0..num {
            device
                .set_fan_speed(fan, pct)
                .with_context(|| format!("NVML set_fan_speed gpu {} fan {} -> {}%", idx, fan, pct))?;
        }
        debug!("NVML: gpu {} all fans -> {}%", idx, pct);
        Ok(())
    }

    /// Hand the GPU fan(s) back to the driver's automatic, temperature-driven curve.
    pub(crate) fn restore_to_auto(&self, fan_id: &str) -> Result<()> {
        let idx = Self::index_from_id(fan_id)
            .with_context(|| format!("malformed NVML fan id: {}", fan_id))?;
        let mut device = self
            .nvml
            .device_by_index(idx)
            .with_context(|| format!("NVML device {} not found", idx))?;
        let num = device.num_fans().unwrap_or(1).max(1);
        for fan in 0..num {
            device
                .set_default_fan_speed(fan)
                .with_context(|| format!("NVML set_default_fan_speed gpu {} fan {}", idx, fan))?;
        }
        debug!("NVML: gpu {} fans restored to driver auto", idx);
        Ok(())
    }
}
