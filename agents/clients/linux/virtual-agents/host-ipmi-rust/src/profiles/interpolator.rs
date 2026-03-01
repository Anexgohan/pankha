//! Speed interpolator — translates UI percentage (0-100) into BMC command values.
//! Handles all three speed_translation types from the JSON profile schema.

use super::types::SpeedTranslation;

/// Translate a percentage (0-100) into the format required by the BMC.
/// Returns the hex string to substitute into {{SPEED_HEX}} or {{SPEED}}.
pub fn translate_speed(percent: u8, translation: &SpeedTranslation) -> String {
    match translation.translation_type.as_str() {
        "byte_scale" => {
            // 50% -> (50/100) * 255 = 127 -> "0x7f"
            let output_min = translation.params.get("output_min")
                .and_then(|v| v.as_u64()).unwrap_or(0) as u8;
            let output_max = translation.params.get("output_max")
                .and_then(|v| v.as_u64()).unwrap_or(255) as u8;
            let range = (output_max - output_min) as f64;
            let value = ((percent as f64 / 100.0) * range) as u8 + output_min;
            format!("0x{:02x}", value)
        }
        "decimal_hex" => {
            // 50% -> 50 -> "0x32"
            format!("0x{:02x}", percent)
        }
        "integer" => {
            // 50% -> "50" (for Redfish REST)
            percent.to_string()
        }
        _ => {
            // Fallback to decimal_hex
            format!("0x{:02x}", percent)
        }
    }
}

/// Substitute {{SPEED_HEX}} or {{SPEED}} in command bytes string.
pub fn interpolate_command(template: &str, speed_value: &str) -> String {
    template
        .replace("{{SPEED_HEX}}", speed_value)
        .replace("{{SPEED}}", speed_value)
}
