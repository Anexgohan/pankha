//! HardwareMonitor trait definition and IPMI implementation.

use anyhow::Result;
use async_trait::async_trait;

pub mod types;
pub mod ipmi;

pub use ipmi::ipmi_monitor::IpmiHardwareMonitor;

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

    /// Invalidate hardware cache (call on startup/reconnection to force rediscovery)
    async fn invalidate_cache(&self);

    /// Check if last sensor discovery was from cache (for logging)
    async fn last_discovery_from_cache(&self) -> bool;

    /// Generate hardware diagnostic dump (hardware-info.json)
    async fn dump_hardware_info(&self) -> Result<HardwareDumpRoot>;

    /// Reload hardware profile from disk (IPMI agents only).
    /// Default no-op for agents without profiles.
    async fn reload_profile(&self) -> Result<()> {
        Ok(())
    }

    /// Get the assigned profile ID (IPMI agents only).
    /// Default None for agents without profiles.
    fn profile_id(&self) -> Option<String> {
        None
    }
}
