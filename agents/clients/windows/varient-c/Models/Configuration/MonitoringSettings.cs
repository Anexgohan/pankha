using Newtonsoft.Json;

namespace Pankha.WindowsAgent.Models.Configuration;

/// <summary>
/// Monitoring behavior settings
/// </summary>
public class MonitoringSettings
{
    [JsonProperty("filterDuplicateSensors")]
    public bool FilterDuplicateSensors { get; set; } = false;

    [JsonProperty("duplicateSensorTolerance")]
    public double DuplicateSensorTolerance { get; set; } = 1.0; // Celsius

    [JsonProperty("fanStepPercent")]
    public int FanStepPercent { get; set; } = 5; // percentage

    [JsonProperty("hysteresisTemp")]
    public double HysteresisTemp { get; set; } = 3.0; // Celsius

    public void Validate()
    {
        if (DuplicateSensorTolerance < 0.25 || DuplicateSensorTolerance > 5.0)
        {
            throw new InvalidOperationException("Duplicate sensor tolerance must be between 0.25°C and 5.0°C");
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
    }
}
