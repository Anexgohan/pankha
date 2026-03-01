//! CSV SDR output parser.
//! Converts ipmitool -c sdr output into Sensor and Fan structs
//! using dynamically provided match tokens from the active JSON profile.

use crate::hardware::types::{Sensor, Fan};
use crate::profiles::types::Parsing;

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
                Some(Sensor {
                    id: name.clone(),
                    name,
                    temperature: value,
                    sensor_type: "temperature".to_string(),
                    max_temp: None,
                    crit_temp: None,
                    chip: Some("ipmi".to_string()),
                    hardware_name: Some(hardware_name.to_string()),
                    source: Some("ipmi_sdr".to_string()),
                })
            } else {
                None
            }
        })
        .collect()
}

/// Parse CSV SDR output into Fan structs.
/// Filter: rows where unit column contains `fan_match_token` ("RPM")
pub fn parse_fans(csv: &str, parsing: &Parsing, has_control: bool) -> Vec<Fan> {
    csv.lines()
        .filter_map(|line| {
            let cols: Vec<&str> = line.split(',').collect();
            if cols.len() >= 4 && cols[2].contains(&parsing.fan_match_token) {
                let name = cols[0].trim().to_string();
                let rpm: u32 = cols[1].trim().parse().ok()?;
                Some(Fan {
                    id: name.clone(),
                    name,
                    rpm: Some(rpm),
                    speed: 0,         // Cannot determine % from RPM alone
                    target_speed: 0,
                    status: if rpm > 0 { "ok".to_string() } else { "stopped".to_string() },
                    has_pwm_control: has_control,
                    pwm_file: None,   // Not applicable for IPMI
                })
            } else {
                None
            }
        })
        .collect()
}
