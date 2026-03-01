//! IPMI Hardware Monitor — implements HardwareMonitor trait using ipmitool commands.
//! All hardware logic is driven by JSON profiles; this binary contains zero hardcoded hex values.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Instant;

use anyhow::{anyhow, Result};
use async_trait::async_trait;
use tokio::sync::Mutex;
use tracing::{debug, error, info, warn};

use crate::config::types::HardwareSettings;
use crate::hardware::HardwareMonitor;
use crate::hardware::types::{
    Sensor, Fan, SystemHealth,
    HardwareDumpRoot, HardwareDumpMetadata, HardwareDumpItem, HardwareDumpSensor,
};
use crate::profiles::types::BmcProfile;
use crate::profiles::loader::load_profile;
use crate::profiles::interpolator::{translate_speed, interpolate_command};
use crate::system::executor;
use crate::system::parser;

pub struct IpmiHardwareMonitor {
    settings: HardwareSettings,
    profile: Option<BmcProfile>,
    profile_path: PathBuf,
    initialized: AtomicBool,
    dry_run: bool,
    start_time: Instant,
    /// Cache for last SDR CSV output to avoid double-querying within the same cycle
    last_sdr_cache: Mutex<Option<String>>,
    cache_from_sdr: AtomicBool,
}

impl IpmiHardwareMonitor {
    pub fn new(settings: HardwareSettings) -> Self {
        // Determine profile path from CLI args or default
        let profile_path = std::env::args()
            .skip_while(|a| a != "--profile")
            .nth(1)
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                std::env::current_exe()
                    .ok()
                    .and_then(|p| p.parent().map(|d| d.join("profile.json")))
                    .unwrap_or_else(|| PathBuf::from("profile.json"))
            });

        let dry_run = std::env::args().any(|a| a == "--dry-run");

        // Attempt to load profile (may fail if file doesn't exist yet)
        let profile = match load_profile(&profile_path) {
            Ok(p) => {
                info!("BMC profile loaded from {:?}", profile_path);
                Some(p)
            }
            Err(e) => {
                warn!("No BMC profile loaded from {:?}: {}. Sensor discovery will fail until a profile is provided.", profile_path, e);
                None
            }
        };

        Self {
            settings,
            profile,
            profile_path,
            initialized: AtomicBool::new(false),
            dry_run,
            start_time: Instant::now(),
            last_sdr_cache: Mutex::new(None),
            cache_from_sdr: AtomicBool::new(false),
        }
    }

    /// Get the IPMI protocol section from the loaded profile, or error.
    fn ipmi_protocol(&self) -> Result<&crate::profiles::types::IpmiProtocol> {
        self.profile.as_ref()
            .and_then(|p| p.protocols.as_ref())
            .and_then(|p| p.ipmi.as_ref())
            .ok_or_else(|| anyhow!("No IPMI protocol loaded. Provide a valid --profile <path>"))
    }

    /// Run initialization commands (disable BIOS thermal override).
    /// Called once on first sensor discovery.
    async fn run_initialization(&self) -> Result<()> {
        let ipmi = self.ipmi_protocol()?;

        info!("Running {} initialization commands...", ipmi.lifecycle.initialization.len());
        for cmd in &ipmi.lifecycle.initialization {
            if let Some(bytes) = &cmd.bytes {
                info!("  Init: {} -> {}", cmd.name, bytes);
                if self.dry_run {
                    info!("  [DRY RUN] Would execute: ipmitool raw {}", bytes);
                } else {
                    match executor::run_ipmitool_raw(bytes).await {
                        Ok(_) => info!("  Init command succeeded: {}", cmd.name),
                        Err(e) => {
                            if cmd.critical {
                                return Err(anyhow!("Critical init command failed: {} — {}", cmd.name, e));
                            }
                            warn!("Non-critical init command failed: {} — {}", cmd.name, e);
                        }
                    }
                }
            }
        }

        self.initialized.store(true, Ordering::SeqCst);
        info!("IPMI initialization complete");
        Ok(())
    }

    /// Run reset_to_factory commands (restore BMC auto-control).
    /// Called on shutdown, disconnect, or emergency.
    pub async fn run_reset_to_factory(&self) -> Result<()> {
        let ipmi = match self.ipmi_protocol() {
            Ok(p) => p,
            Err(_) => {
                warn!("No profile loaded, skipping reset_to_factory");
                return Ok(());
            }
        };

        if !self.initialized.load(Ordering::SeqCst) {
            debug!("Agent never initialized, skipping reset_to_factory");
            return Ok(());
        }

        info!("Running {} reset_to_factory commands...", ipmi.lifecycle.reset_to_factory.len());
        for cmd in &ipmi.lifecycle.reset_to_factory {
            if let Some(bytes) = &cmd.bytes {
                info!("  Reset: {} -> {}", cmd.name, bytes);
                if self.dry_run {
                    info!("  [DRY RUN] Would execute: ipmitool raw {}", bytes);
                } else {
                    match executor::run_ipmitool_raw(bytes).await {
                        Ok(_) => info!("  Reset command succeeded: {}", cmd.name),
                        Err(e) => {
                            error!("Reset command failed: {} — {}", cmd.name, e);
                        }
                    }
                }
            }
        }

        info!("Reset to factory complete — fans returned to BMC auto-control");
        Ok(())
    }

    /// Fetch SDR CSV data, using cache if available in this cycle.
    async fn get_sdr_csv(&self) -> Result<String> {
        let mut cache = self.last_sdr_cache.lock().await;
        if let Some(ref cached) = *cache {
            self.cache_from_sdr.store(true, Ordering::SeqCst);
            return Ok(cached.clone());
        }

        self.cache_from_sdr.store(false, Ordering::SeqCst);
        let csv = executor::run_ipmitool_sdr_csv().await?;
        *cache = Some(csv.clone());
        Ok(csv)
    }

    /// Get the hardware name from profile metadata.
    fn hardware_name(&self) -> String {
        self.profile.as_ref()
            .map(|p| {
                let vendor = &p.metadata.vendor;
                let model = p.metadata.model_family.as_ref()
                    .and_then(|f| f.first())
                    .map(|s| s.as_str())
                    .unwrap_or("Unknown");
                format!("{} {}", vendor, model)
            })
            .unwrap_or_else(|| "Unknown IPMI".to_string())
    }
}

#[async_trait]
impl HardwareMonitor for IpmiHardwareMonitor {
    async fn discover_sensors(&self) -> Result<Vec<Sensor>> {
        let ipmi = self.ipmi_protocol()?;

        // Run initialization on first call
        if !self.initialized.load(Ordering::SeqCst) {
            self.run_initialization().await?;
        }

        let csv = self.get_sdr_csv().await?;
        let sensors = parser::parse_sensors(&csv, &ipmi.parsing, &self.hardware_name());

        debug!("Discovered {} temperature sensors via IPMI SDR", sensors.len());
        Ok(sensors)
    }

    async fn discover_fans(&self) -> Result<Vec<Fan>> {
        let ipmi = self.ipmi_protocol()?;
        let has_control = self.settings.enable_fan_control && !ipmi.fan_zones.is_empty();

        let csv = self.get_sdr_csv().await?;
        let fans = parser::parse_fans(&csv, &ipmi.parsing, has_control);

        debug!("Discovered {} fans via IPMI SDR", fans.len());
        Ok(fans)
    }

    async fn get_system_info(&self) -> Result<SystemHealth> {
        let uptime = self.start_time.elapsed().as_secs_f64();

        // Basic CPU/memory stats from /proc (no sysinfo crate needed)
        let cpu_usage = read_cpu_usage().unwrap_or(0.0);
        let memory_usage = read_memory_usage().unwrap_or(0.0);

        Ok(SystemHealth {
            cpu_usage,
            memory_usage,
            agent_uptime: uptime,
        })
    }

    async fn set_fan_speed(&self, fan_id: &str, speed: u8) -> Result<()> {
        let ipmi = self.ipmi_protocol()?;

        if !self.settings.enable_fan_control {
            return Err(anyhow!("Fan control is disabled in agent settings"));
        }

        // Find matching fan zone(s)
        let zones: Vec<_> = ipmi.fan_zones.iter()
            .filter(|z| z.id == fan_id || fan_id == "all_fans" || fan_id == "all")
            .collect();

        if zones.is_empty() {
            return Err(anyhow!("No fan zone matching id '{}' in profile", fan_id));
        }

        for zone in zones {
            let speed_value = translate_speed(speed, &zone.speed_translation);

            if let Some(bytes_template) = &zone.commands.set_speed.bytes {
                let bytes = interpolate_command(bytes_template, &speed_value);

                info!("Setting {} to {}% -> {} -> ipmitool raw {}", zone.name, speed, speed_value, bytes);

                if self.dry_run {
                    info!("[DRY RUN] Would execute: ipmitool raw {}", bytes);
                } else {
                    executor::run_ipmitool_raw(&bytes).await?;
                }
            }
        }

        Ok(())
    }

    async fn emergency_stop(&self) -> Result<()> {
        info!("EMERGENCY STOP: Setting all fans to 100%");
        // Run reset_to_factory to return fans to BMC auto-control (max safe speed)
        self.run_reset_to_factory().await
    }

    async fn invalidate_cache(&self) {
        let mut cache = self.last_sdr_cache.lock().await;
        *cache = None;
    }

    async fn last_discovery_from_cache(&self) -> bool {
        self.cache_from_sdr.load(Ordering::SeqCst)
    }

    async fn dump_hardware_info(&self) -> Result<HardwareDumpRoot> {
        let hw_name = self.hardware_name();

        // Get FRU data for metadata
        let fru_output = executor::run_ipmitool_fru().await.unwrap_or_default();
        let motherboard = parse_fru_field(&fru_output, "Product Name");

        // Get mc info for additional context
        let mc_output = executor::run_ipmitool_mc_info().await.unwrap_or_default();
        let ipmi_version = parse_mc_field(&mc_output, "IPMI Version");

        // Build sensor dump from SDR
        let mut sensors = Vec::new();

        if let Ok(csv) = self.get_sdr_csv().await {
            for line in csv.lines() {
                let cols: Vec<&str> = line.split(',').collect();
                if cols.len() >= 4 {
                    sensors.push(HardwareDumpSensor {
                        name: cols[0].trim().to_string(),
                        identifier: format!("/ipmi/{}", cols[0].trim()),
                        sensor_type: cols[2].trim().to_string(),
                        value: cols[1].trim().parse().ok(),
                        min: "N/A".to_string(),
                        max: "N/A".to_string(),
                        is_monitored: true,
                        is_connected: Some(cols[3].trim() == "ok"),
                        control: None,
                    });
                }
            }
        }

        let metadata = HardwareDumpMetadata {
            agent_version: env!("CARGO_PKG_VERSION").to_string(),
            os_version: format!("{} {}", std::env::consts::OS, std::env::consts::ARCH),
            is_elevated: unsafe { libc::geteuid() == 0 },
            timestamp: chrono::Utc::now().to_rfc3339(),
            motherboard: motherboard.or(Some(hw_name.clone())),
            kernel_version: std::fs::read_to_string("/proc/version")
                .ok()
                .map(|v| v.trim().to_string()),
            cpu_model: None,
        };

        let hardware_item = HardwareDumpItem {
            name: hw_name,
            identifier: "/ipmi/bmc".to_string(),
            hardware_type: "IPMI BMC".to_string(),
            parent: None,
            technical_id: ipmi_version,
            sensors,
            sub_hardware: Vec::new(),
        };

        Ok(HardwareDumpRoot {
            metadata,
            hardware: vec![hardware_item],
        })
    }
}

/// Parse a field from `ipmitool fru print` output.
fn parse_fru_field(output: &str, field: &str) -> Option<String> {
    output.lines()
        .find(|line| line.contains(field))
        .and_then(|line| line.split(':').nth(1))
        .map(|v| v.trim().to_string())
}

/// Parse a field from `ipmitool mc info` output.
fn parse_mc_field(output: &str, field: &str) -> Option<String> {
    output.lines()
        .find(|line| line.contains(field))
        .and_then(|line| line.split(':').nth(1))
        .map(|v| v.trim().to_string())
}

/// Read approximate CPU usage from /proc/stat.
fn read_cpu_usage() -> Option<f64> {
    let stat = std::fs::read_to_string("/proc/stat").ok()?;
    let cpu_line = stat.lines().next()?;
    let vals: Vec<u64> = cpu_line.split_whitespace()
        .skip(1)
        .filter_map(|v| v.parse().ok())
        .collect();

    if vals.len() < 4 { return None; }

    let total: u64 = vals.iter().sum();
    let idle = vals[3];

    if total == 0 { return None; }
    Some(((total - idle) as f64 / total as f64) * 100.0)
}

/// Read memory usage from /proc/meminfo.
fn read_memory_usage() -> Option<f64> {
    let meminfo = std::fs::read_to_string("/proc/meminfo").ok()?;
    let mut total = 0u64;
    let mut available = 0u64;

    for line in meminfo.lines() {
        if line.starts_with("MemTotal:") {
            total = line.split_whitespace().nth(1)?.parse().ok()?;
        } else if line.starts_with("MemAvailable:") {
            available = line.split_whitespace().nth(1)?.parse().ok()?;
        }
    }

    if total == 0 { return None; }
    Some(((total - available) as f64 / total as f64) * 100.0)
}
