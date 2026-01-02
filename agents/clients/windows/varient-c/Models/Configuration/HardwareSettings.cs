using Newtonsoft.Json;

namespace Pankha.WindowsAgent.Models.Configuration;

/// <summary>
/// Hardware monitoring and control settings
/// Unified snake_case schema matching Linux agent (includes former MonitoringSettings)
/// </summary>
public class HardwareSettings
{
    [JsonProperty("enable_fan_control")]
    public bool EnableFanControl { get; set; } = true;

    [JsonProperty("enable_sensor_monitoring")]
    public bool EnableSensorMonitoring { get; set; } = true;

    [JsonProperty("failsafe_speed")]
    public int FailsafeSpeed { get; set; } = 70; // 0-100% - fan speed when backend disconnected

    [JsonProperty("fan_step_percent")]
    public int FanStepPercent { get; set; } = 5; // percentage

    [JsonProperty("hysteresis_temp")]
    public double HysteresisTemp { get; set; } = 3.0; // Celsius

    [JsonProperty("emergency_temp")]
    public double EmergencyTemp { get; set; } = 85.0; // Celsius

    public void Validate()
    {
        if (FailsafeSpeed < 0 || FailsafeSpeed > 100)
        {
            throw new InvalidOperationException("Failsafe speed must be between 0% and 100%");
        }

        var validSteps = new[] { 3, 5, 10, 15, 25, 50, 100 };
        if (!validSteps.Contains(FanStepPercent))
        {
            throw new InvalidOperationException($"Fan step must be one of: {string.Join(", ", validSteps)}");
        }

        if (HysteresisTemp < 0.0 || HysteresisTemp > 10.0)
        {
            throw new InvalidOperationException("Hysteresis temperature must be between 0.0°C and 10.0°C");
        }

        if (EmergencyTemp < 70.0 || EmergencyTemp > 100.0)
        {
            throw new InvalidOperationException("Emergency temperature must be between 70°C and 100°C");
        }
    }
}
