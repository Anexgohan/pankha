using Newtonsoft.Json;

namespace Pankha.WindowsAgent.Models.Configuration;

/// <summary>
/// Hardware monitoring and control settings
/// </summary>
public class HardwareSettings
{
    [JsonProperty("updateInterval")]
    public double UpdateInterval { get; set; } = 3.0; // seconds

    [JsonProperty("enableFanControl")]
    public bool EnableFanControl { get; set; } = true;

    [JsonProperty("minFanSpeed")]
    public int MinFanSpeed { get; set; } = 30; // percentage

    [JsonProperty("emergencyTemperature")]
    public double EmergencyTemperature { get; set; } = 85.0; // Celsius

    public void Validate()
    {
        if (UpdateInterval < 0.5 || UpdateInterval > 30.0)
        {
            throw new InvalidOperationException("Update interval must be between 0.5 and 30 seconds");
        }

        if (MinFanSpeed < 20 || MinFanSpeed > 50)
        {
            throw new InvalidOperationException("Min fan speed must be between 20% and 50%");
        }

        if (EmergencyTemperature < 70.0 || EmergencyTemperature > 100.0)
        {
            throw new InvalidOperationException("Emergency temperature must be between 70°C and 100°C");
        }
    }
}
