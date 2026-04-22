//! CSV SDR output parser.
//! Converts ipmitool -c sdr output into Sensor and Fan structs
//! using dynamically provided match tokens from the active JSON profile.

use std::collections::HashMap;

use crate::hardware::types::{Sensor, Fan};
use crate::profiles::types::Parsing;

/// Normalize an SDR sensor name into a stable, underscore-separated ID.
/// "CPU Temp" → "cpu_temp", "Peripheral Temp" → "peripheral_temp", "PCH Temp" → "pch_temp".
/// The first segment (before the first underscore) becomes the chip group in the
/// frontend's deriveChipName() — each subsystem renders as its own chip group,
/// mirroring how OS sensors group by driver (k10temp, coretemp, nvme).
fn normalize_sensor_id(sdr_name: &str) -> String {
    sdr_name
        .trim()
        .to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '_' })
        .collect()
}

/// Derive the chip group (first id segment) from a normalized sensor id.
/// "cpu_temp" → "cpu", "peripheral_temp" → "peripheral".
fn derive_chip(normalized_id: &str) -> String {
    normalized_id
        .split_once('_')
        .map(|(head, _)| head.to_string())
        .unwrap_or_else(|| normalized_id.to_string())
}

/// Classify the chip group into a sensor_type category the frontend's
/// getSensorIcon() switch recognizes. We preserve fine-grained categories
/// (pch, peripheral, system, memory, vrm, bmc, nic) so each subsystem can
/// render its own icon — the frontend has dedicated icons per category.
fn classify_sensor_type(chip: &str) -> String {
    match chip {
        "cpu" => "cpu".to_string(),
        "gpu" => "gpu".to_string(),
        "pch" => "pch".to_string(),
        "peripheral" | "pcie" => "peripheral".to_string(),
        "system" | "ambient" => "system".to_string(),
        "dimm" | "memory" | "ram" => "memory".to_string(),
        "vrm" => "vrm".to_string(),
        "bmc" => "bmc".to_string(),
        "nic" | "network" | "lan" => "nic".to_string(),
        "motherboard" | "mainboard" | "lpc" | "superio" => "motherboard".to_string(),
        "nvme" | "hdd" | "ssd" | "storage" => "nvme".to_string(),
        "acpi" | "acpitz" | "thermal" => "acpi".to_string(),
        _ => "other".to_string(),
    }
}

/// Parse CSV SDR output into Sensor structs.
/// Input:  "CPU Temp,42,degrees C,ok\nFAN1,1800,RPM,ok\n..."
/// Filter: rows where unit column contains `temp_match_token` ("degrees C")
pub fn parse_sensors(csv: &str, parsing: &Parsing, hardware_name: &str) -> Vec<Sensor> {
    csv.lines()
        .filter_map(|line| {
            let cols: Vec<&str> = line.split(',').collect();
            if cols.len() >= 4 && cols[2].contains(&parsing.temp_match_token) {
                let name = cols[0].trim().to_string();
                let value: f64 = cols[1].trim().parse().ok()?;
                let id = normalize_sensor_id(&name);
                let chip = derive_chip(&id);
                let sensor_type = classify_sensor_type(&chip);
                Some(Sensor {
                    id,
                    name,
                    temperature: value,
                    sensor_type,
                    max_temp: None,
                    crit_temp: None,
                    chip: Some(chip),
                    hardware_name: Some(hardware_name.to_string()),
                    source: Some("ipmi_sdr".to_string()),
                })
            } else {
                None
            }
        })
        .collect()
}

/// Parse `ipmitool sensor get` output for threshold values.
/// Returns (max_temp, crit_temp) extracted from "Upper non-critical" and "Upper critical" lines.
/// Format: " Upper critical        : 90.000\n Upper non-critical    : 85.000\n"
/// Returns None for thresholds that are missing or marked "na".
pub fn parse_sensor_thresholds(output: &str) -> (Option<f64>, Option<f64>) {
    let mut max_temp = None;
    let mut crit_temp = None;

    for line in output.lines() {
        let line = line.trim();
        if let Some((key, val)) = line.split_once(':') {
            let key = key.trim().to_lowercase();
            let val = val.trim();
            if val == "na" || val == "Unspecified" || val.is_empty() {
                continue;
            }
            if key == "upper non-critical" {
                max_temp = val.parse::<f64>().ok();
            } else if key == "upper critical" {
                crit_temp = val.parse::<f64>().ok();
            }
        }
    }

    (max_temp, crit_temp)
}

/// Parse CSV SDR output for fan duty cycle percentage sensors (Tier 1).
/// Some BMCs (Dell iDRAC, HP iLO) report fan duty cycle as separate SDR sensors
/// with unit "percent" (e.g., "Fan 1,39.20,percent,ok").
/// Returns a map of sensor name → speed percentage (0-100).
///
/// Matching strategy: for each "percent" sensor, we try to correlate it to
/// an RPM fan by normalized name prefix (strip non-alphanumeric, compare).
/// If no correlation is found, the entry is keyed by exact sensor name.
pub fn parse_fan_percent_sensors(csv: &str) -> HashMap<String, u8> {
    const PERCENT_TOKEN: &str = "percent";

    csv.lines()
        .filter_map(|line| {
            let cols: Vec<&str> = line.split(',').collect();
            if cols.len() >= 4 && cols[2].contains(PERCENT_TOKEN) {
                let name = cols[0].trim().to_string();
                let value: f64 = cols[1].trim().parse().ok()?;
                let speed = value.round().clamp(0.0, 100.0) as u8;
                Some((name, speed))
            } else {
                None
            }
        })
        .collect()
}

/// Try to match a percent sensor name to an RPM fan name.
/// Strips non-alphanumeric characters and compares case-insensitively.
/// Examples: "Fan 1" matches "FAN1", "Fan1 Duty" matches "FAN1".
pub fn match_percent_to_fan(percent_name: &str, fan_names: &[String]) -> Option<String> {
    let normalized_pct: String = percent_name.chars()
        .filter(|c| c.is_alphanumeric())
        .collect::<String>()
        .to_lowercase();

    for fan_name in fan_names {
        let normalized_fan: String = fan_name.chars()
            .filter(|c| c.is_alphanumeric())
            .collect::<String>()
            .to_lowercase();

        // Check if either name starts with the other (handles "Fan1" vs "Fan1 Duty")
        if normalized_pct.starts_with(&normalized_fan) || normalized_fan.starts_with(&normalized_pct) {
            return Some(fan_name.clone());
        }
    }
    None
}

/// Parse CSV SDR output into Fan structs.
/// Filter: rows where unit column contains `fan_match_token` ("RPM").
/// `zone_map` maps fan sensor name → zone_id (e.g., "FAN1" → "cpu_zone").
pub fn parse_fans(csv: &str, parsing: &Parsing, has_control: bool, zone_map: &HashMap<String, String>) -> Vec<Fan> {
    csv.lines()
        .filter_map(|line| {
            let cols: Vec<&str> = line.split(',').collect();
            if cols.len() >= 4 && cols[2].contains(&parsing.fan_match_token) {
                let name = cols[0].trim().to_string();
                let rpm: u32 = cols[1].trim().parse().ok()?;
                let zone = zone_map.get(&name).cloned();
                Some(Fan {
                    id: name.clone(),
                    name,
                    rpm: Some(rpm),
                    speed: 0,         // Cannot determine % from RPM alone
                    target_speed: 0,
                    status: if rpm > 0 { "ok".to_string() } else { "stopped".to_string() },
                    has_pwm_control: has_control,
                    pwm_file: None,   // Not applicable for IPMI
                    zone,
                })
            } else {
                None
            }
        })
        .collect()
}
