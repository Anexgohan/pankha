//! Windows HardwareMonitor stub (future expansion).

#[cfg(target_os = "windows")]
use std::sync::Arc;
#[cfg(target_os = "windows")]
use tokio::sync::RwLock;
#[cfg(target_os = "windows")]
use anyhow::Result;
#[cfg(target_os = "windows")]
use async_trait::async_trait;
#[cfg(target_os = "windows")]
use tracing::warn;

#[cfg(target_os = "windows")]
use crate::hardware::HardwareMonitor;
#[cfg(target_os = "windows")]
use crate::hardware::types::*;
#[cfg(target_os = "windows")]
use crate::config::types::HardwareSettings;

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

    async fn dump_hardware_info(&self) -> Result<HardwareDumpRoot> {
        Err(anyhow::anyhow!("Windows hardware dump not yet implemented in Rust agent"))
    }
}
