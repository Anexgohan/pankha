using Newtonsoft.Json;

namespace Pankha.WindowsAgent.Models;

/// <summary>
/// Represents a fan with speed and RPM information
/// </summary>
public class Fan
{
    [JsonProperty("id")]
    public string Id { get; set; } = string.Empty;

    [JsonProperty("name")]
    public string Name { get; set; } = string.Empty;

    [JsonProperty("label")]
    public string Label { get; set; } = string.Empty;

    [JsonProperty("rpm")]
    public int Rpm { get; set; }

    [JsonProperty("speed")]
    public int Speed { get; set; }

    [JsonProperty("targetSpeed")]
    public int TargetSpeed { get; set; }

    [JsonProperty("status")]
    public string Status { get; set; } = "ok";

    [JsonProperty("has_pwm_control")]
    public bool HasPwmControl { get; set; }

    [JsonProperty("pwm_file")]
    public string? PwmFile { get; set; }

    /// <summary>
    /// Internal reference to LibreHardwareMonitor sensor
    /// </summary>
    [JsonIgnore]
    public object? HardwareReference { get; set; }

    /// <summary>
    /// Last time fan speed was changed (for rate limiting)
    /// </summary>
    [JsonIgnore]
    public DateTime LastWriteTime { get; set; } = DateTime.MinValue;

    /// <summary>
    /// Last PWM value written (for deduplication)
    /// </summary>
    [JsonIgnore]
    public int? LastPwmValue { get; set; }

    /// <summary>
    /// Update fan status based on RPM
    /// </summary>
    public void UpdateStatus()
    {
        if (Rpm == 0 && Speed > 0)
        {
            Status = "error"; // Fan should be spinning but isn't
        }
        else if (Rpm == 0)
        {
            Status = "stopped";
        }
        else
        {
            Status = "ok";
        }
    }
}
