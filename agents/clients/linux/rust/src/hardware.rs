//! HardwareMonitor trait definition and platform-conditional re-exports.

use anyhow::Result;
use async_trait::async_trait;

pub mod types;

#[cfg(target_os = "linux")]
pub mod linux;

#[cfg(target_os = "linux")]
pub use linux::monitor::LinuxHardwareMonitor;

use types::{Sensor, Fan, SystemHealth, HardwareDumpRoot};

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

    /// Hand a fan back to hardware/driver automatic control.
    ///
    /// Returns `Ok(true)` if this backend owns the fan and restored it (e.g. an NVIDIA
    /// GPU fan via NVML), `Ok(false)` if the fan is not auto-restorable here (sysfs/IPMI)
    /// so the caller should apply `failsafe_speed` instead. Default: not owned.
    async fn restore_fan_to_auto(&self, _fan_id: &str) -> Result<bool> {
        Ok(false)
    }

    /// Invalidate hardware cache (call on startup/reconnection to force rediscovery)
    async fn invalidate_cache(&self);

    /// Check if last sensor discovery was from cache (for logging)
    async fn last_discovery_from_cache(&self) -> bool;

    /// Generate hardware diagnostic dump (hardware-info.json)
    async fn dump_hardware_info(&self) -> Result<HardwareDumpRoot>;
}
