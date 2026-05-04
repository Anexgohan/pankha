//! IPMI Hardware Monitor - implements HardwareMonitor trait using ipmitool commands.
//! All hardware logic is driven by JSON profiles; this binary contains zero hardcoded hex values.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::RwLock;
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
use crate::profiles::types::{BmcProfile, Parsing};
use crate::profiles::loader::load_profile;
use crate::profiles::interpolator::{translate_speed, reverse_translate_speed, interpolate_command};
use crate::system::executor;
use crate::system::parser;

pub struct IpmiHardwareMonitor {
    settings: HardwareSettings,
    profile: RwLock<Option<BmcProfile>>,
    profile_path: PathBuf,
    initialized: AtomicBool,
    dry_run: bool,
    start_time: Instant,
    /// Cache for last SDR CSV output to avoid double-querying within the same cycle
    last_sdr_cache: Mutex<Option<String>>,
    cache_from_sdr: AtomicBool,
    /// Track last commanded speed per zone (zone_id → speed%).
    /// IPMI SDR only reports RPM, not duty cycle - this lets telemetry report the actual speed we set.
    commanded_speeds: Mutex<HashMap<String, u8>>,
    /// Cached sensor thresholds (SDR name → (max_temp, crit_temp)).
    /// Queried once at init - thresholds don't change at runtime.
    sensor_thresholds: Mutex<HashMap<String, (Option<f64>, Option<f64>)>>,
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
                warn!("No BMC profile loaded from {:?}: {}. Running in monitor-only mode (no fan control).", profile_path, e);
                None
            }
        };

        Self {
            settings,
            profile: RwLock::new(profile),
            profile_path,
            initialized: AtomicBool::new(false),
            dry_run,
            start_time: Instant::now(),
            last_sdr_cache: Mutex::new(None),
            cache_from_sdr: AtomicBool::new(false),
            commanded_speeds: Mutex::new(HashMap::new()),
            sensor_thresholds: Mutex::new(HashMap::new()),
        }
    }

    /// Get the IPMI protocol section from the loaded profile, or None.
    /// Returns a cloned copy - cheap for the small IpmiProtocol struct,
    /// and avoids holding a RwLock guard across async boundaries.
    fn ipmi_protocol(&self) -> Option<crate::profiles::types::IpmiProtocol> {
        let profile = self.profile.read().unwrap();
        profile.as_ref()
            .and_then(|p| p.protocols.as_ref())
            .and_then(|p| p.ipmi.as_ref())
            .cloned()
    }

    /// Default parsing config for profile-less monitor-only mode.
    /// Uses standard IPMI SDR unit strings - universal across all BMC vendors.
    fn default_parsing() -> Parsing {
        Parsing {
            sdr_format: "csv".to_string(),
            fan_match_token: "RPM".to_string(),
            temp_match_token: "degrees C".to_string(),
        }
    }

    /// Run initialization commands (disable BIOS thermal override).
    /// Called once on first sensor discovery.
    async fn run_initialization(&self) -> Result<()> {
        let ipmi = match self.ipmi_protocol() {
            Some(p) => p,  // owned IpmiProtocol - no lock held
            None => {
                info!("No profile loaded - skipping initialization (monitor-only mode)");
                self.initialized.store(true, Ordering::SeqCst);
                return Ok(());
            }
        };

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
                                return Err(anyhow!("Critical init command failed: {} - {}", cmd.name, e));
                            }
                            warn!("Non-critical init command failed: {} - {}", cmd.name, e);
                        }
                    }
                }
            }
        }

        self.initialized.store(true, Ordering::SeqCst);

        // Query sensor thresholds once at init - they don't change at runtime.
        // Uses `ipmitool sensor get "<name>"` per temperature sensor found in SDR.
        match executor::run_ipmitool_sdr_csv().await {
            Ok(csv) => {
                let temp_names: Vec<String> = csv.lines()
                    .filter_map(|line| {
                        let cols: Vec<&str> = line.split(',').collect();
                        if cols.len() >= 4 && cols[2].contains(&ipmi.parsing.temp_match_token) {
                            Some(cols[0].trim().to_string())
                        } else {
                            None
                        }
                    })
                    .collect();

                let mut thresholds = self.sensor_thresholds.lock().await;
                for name in &temp_names {
                    match executor::run_ipmitool_sensor_get(name).await {
                        Ok(output) => {
                            let (max_temp, crit_temp) = parser::parse_sensor_thresholds(&output);
                            if max_temp.is_some() || crit_temp.is_some() {
                                debug!("Thresholds for '{}': max={:?} crit={:?}", name, max_temp, crit_temp);
                            }
                            thresholds.insert(name.clone(), (max_temp, crit_temp));
                        }
                        Err(e) => {
                            debug!("Could not query thresholds for '{}': {}", name, e);
                        }
                    }
                }
                info!("Queried thresholds for {} temperature sensors", thresholds.len());
            }
            Err(e) => {
                warn!("Could not query SDR for threshold init: {}", e);
            }
        }

        info!("IPMI initialization complete");
        Ok(())
    }

    /// Run reset_to_factory commands (restore BMC auto-control).
    /// Called on shutdown, disconnect, or emergency.
    pub async fn run_reset_to_factory(&self) -> Result<()> {
        let ipmi = match self.ipmi_protocol() {
            Some(p) => p,
            None => {
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
                            error!("Reset command failed: {} - {}", cmd.name, e);
                        }
                    }
                }
            }
        }

        // Clear commanded speeds - BMC is back in control, our duty-cycle values are stale
        self.commanded_speeds.lock().await.clear();

        info!("Reset to factory complete - fans returned to BMC auto-control");
        Ok(())
    }

    /// Fetch SDR CSV data, using cache if available in this cycle.
    /// Only updates cache_from_sdr on cache miss (fresh fetch) - matching the
    /// original agent where discover_fans() doesn't touch the flag.
    async fn get_sdr_csv(&self) -> Result<String> {
        let mut cache = self.last_sdr_cache.lock().await;
        if let Some(ref cached) = *cache {
            return Ok(cached.clone());
        }

        self.cache_from_sdr.store(false, Ordering::SeqCst);
        let csv = executor::run_ipmitool_sdr_csv().await?;
        *cache = Some(csv.clone());
        Ok(csv)
    }

    /// Build a map from fan sensor name → zone ID using the profile's fan_zones[].members.
    /// If no zone defines members and there's exactly one zone, all fans are assigned to it.
    fn build_zone_map(&self) -> HashMap<String, String> {
        let mut map = HashMap::new();
        let ipmi = match self.ipmi_protocol() {
            Some(p) => p,
            None => return map,
        };

        let has_any_members = ipmi.fan_zones.iter()
            .any(|z| z.members.as_ref().map_or(false, |m| !m.is_empty()));

        if has_any_members {
            // Explicit mapping: use members arrays
            for zone in &ipmi.fan_zones {
                if let Some(members) = &zone.members {
                    for fan_name in members {
                        map.insert(fan_name.clone(), zone.id.clone());
                    }
                }
            }
        } else if ipmi.fan_zones.len() == 1 {
            // Single zone without members: handled post-parse (tag all fans with this zone)
            // We can't pre-populate the map since we don't know fan names yet.
            // Instead, return a special marker that discover_fans() will handle.
        }

        map
    }

    /// Get the single-zone fallback ID, if applicable.
    fn single_zone_id(&self) -> Option<String> {
        let ipmi = self.ipmi_protocol()?;
        let has_any_members = ipmi.fan_zones.iter()
            .any(|z| z.members.as_ref().map_or(false, |m| !m.is_empty()));
        if !has_any_members && ipmi.fan_zones.len() == 1 {
            Some(ipmi.fan_zones[0].id.clone())
        } else {
            None
        }
    }

    /// Get the hardware name from profile metadata.
    fn hardware_name(&self) -> String {
        let profile = self.profile.read().unwrap();
        profile.as_ref()
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
        let default_parsing = Self::default_parsing();
        let ipmi = self.ipmi_protocol();
        let parsing = ipmi.as_ref()
            .map(|p| &p.parsing)
            .unwrap_or(&default_parsing);

        // Run initialization on first call
        if !self.initialized.load(Ordering::SeqCst) {
            self.run_initialization().await?;
        }

        let csv = self.get_sdr_csv().await?;
        let mut sensors = parser::parse_sensors(&csv, parsing, &self.hardware_name());

        // Inject cached thresholds (queried once at init)
        let thresholds = self.sensor_thresholds.lock().await;
        for sensor in &mut sensors {
            if let Some((max_temp, crit_temp)) = thresholds.get(&sensor.name) {
                sensor.max_temp = *max_temp;
                sensor.crit_temp = *crit_temp;
            }
        }

        debug!("Discovered {} temperature sensors via IPMI SDR", sensors.len());
        Ok(sensors)
    }

    async fn discover_fans(&self) -> Result<Vec<Fan>> {
        let default_parsing = Self::default_parsing();
        let ipmi = self.ipmi_protocol();
        let parsing = ipmi.as_ref().map(|p| &p.parsing).unwrap_or(&default_parsing);
        let has_control = ipmi.as_ref().map_or(false, |p| self.settings.enable_fan_control && !p.fan_zones.is_empty());

        let csv = self.get_sdr_csv().await?;
        let zone_map = self.build_zone_map();
        let mut fans = parser::parse_fans(&csv, parsing, has_control, &zone_map);

        // Single-zone fallback: if no zone defined members and there's exactly one zone,
        // tag all discovered fans with that zone.
        if let Some(zone_id) = self.single_zone_id() {
            for fan in &mut fans {
                if fan.zone.is_none() {
                    fan.zone = Some(zone_id.clone());
                }
            }
        }

        // === 3-Tier Fan Speed % Resolution ===
        // IPMI SDR reports RPM but not PWM duty cycle.
        // We resolve speed% using a cascading fallback:

        // Tier 1: SDR percent sensors (Dell iDRAC, HP iLO, some Lenovo)
        // Some BMCs expose duty cycle as a separate sensor with unit "percent".
        let percent_sensors = parser::parse_fan_percent_sensors(&csv);
        if !percent_sensors.is_empty() {
            let fan_names: Vec<String> = fans.iter().map(|f| f.name.clone()).collect();
            for (pct_name, speed) in &percent_sensors {
                if let Some(fan_name) = parser::match_percent_to_fan(pct_name, &fan_names) {
                    for fan in &mut fans {
                        if fan.name == fan_name && fan.speed == 0 {
                            fan.speed = *speed;
                            fan.target_speed = *speed;
                        }
                    }
                }
            }
            debug!("Tier 1: Injected speed from {} SDR percent sensors", percent_sensors.len());
        }

        // Tier 2: Profile read_speed command (Supermicro, ASRockRack)
        // Query the BMC for current duty cycle per zone via vendor-specific OEM command.
        // Skipped in monitor-only mode (no profile → no zones).
        let fan_zones = ipmi.as_ref().map(|p| p.fan_zones.as_slice()).unwrap_or(&[]);
        for zone in fan_zones {
            // Skip if all fans in this zone already have speed (from Tier 1)
            let zone_needs_speed = fans.iter()
                .any(|f| f.zone.as_deref() == Some(&zone.id) && f.speed == 0);
            if !zone_needs_speed {
                continue;
            }

            if let Some(ref read_cmd) = zone.commands.read_speed {
                if let Some(ref bytes) = read_cmd.bytes {
                    if self.dry_run {
                        debug!("Tier 2: [DRY RUN] Would query read_speed for zone {}: {}", zone.id, bytes);
                    } else {
                        match executor::run_ipmitool_raw(bytes).await {
                            Ok(response) => {
                                // Parse response - typically a single hex byte like " 32" (= 0x32)
                                let trimmed = response.trim();
                                if let Ok(raw_byte) = u8::from_str_radix(trimmed.trim_start_matches("0x"), 16) {
                                    let speed = reverse_translate_speed(raw_byte, &zone.speed_translation);
                                    for fan in &mut fans {
                                        if fan.zone.as_deref() == Some(&zone.id) && fan.speed == 0 {
                                            fan.speed = speed;
                                            fan.target_speed = speed;
                                        }
                                    }
                                    debug!("Tier 2: Zone {} read_speed -> {}% (raw: 0x{:02x})", zone.id, speed, raw_byte);
                                }
                            }
                            Err(e) => {
                                debug!("Tier 2: read_speed failed for zone {}: {}", zone.id, e);
                            }
                        }
                    }
                }
            }
        }

        // Tier 3: Commanded speed tracking (universal fallback)
        // Use the last speed we commanded per zone. Not a true readback
        // but the best we can do when Tier 1 and 2 are unavailable.
        let speeds = self.commanded_speeds.lock().await;
        for fan in &mut fans {
            if fan.speed == 0 {
                if let Some(zone) = &fan.zone {
                    if let Some(&spd) = speeds.get(zone) {
                        fan.speed = spd;
                        fan.target_speed = spd;
                    }
                }
            }
        }

        // Clear SDR cache after fans are parsed - both consumers (sensors + fans)
        // have used this cycle's CSV. Next cycle will fetch fresh readings.
        // (Mirrors the original sysfs agent: cache stores *paths*, not *values*;
        // here the SDR CSV contains live readings, so it must refresh each cycle.)
        {
            let mut cache = self.last_sdr_cache.lock().await;
            *cache = None;
        }

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
        let ipmi = self.ipmi_protocol()
            .ok_or_else(|| anyhow!("No profile loaded - fan control unavailable in monitor-only mode"))?;

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

                // Track commanded speed so telemetry can report it
                // (IPMI SDR only reports RPM, not duty cycle)
                self.commanded_speeds.lock().await.insert(zone.id.clone(), speed);
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
            agent_version: crate::version::VERSION.to_string(),
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

    async fn reload_profile(&self) -> Result<()> {
        let new_profile = load_profile(&self.profile_path)?;
        {
            let mut profile = self.profile.write().unwrap();
            *profile = Some(new_profile);
        }
        // Reset init flag - init commands will re-run on next telemetry cycle
        self.initialized.store(false, Ordering::SeqCst);
        // Clear stale state from previous profile
        self.commanded_speeds.lock().await.clear();
        self.sensor_thresholds.lock().await.clear();
        info!("Profile hot-reloaded from {:?}. Init commands will run on next telemetry cycle.", self.profile_path);
        Ok(())
    }

    fn profile_id(&self) -> Option<String> {
        let profile = self.profile.read().unwrap();
        profile.as_ref().and_then(|p| p.metadata.profile_id.clone())
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
