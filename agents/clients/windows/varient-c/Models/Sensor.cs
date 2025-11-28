using Newtonsoft.Json;

namespace Pankha.WindowsAgent.Models;

/// <summary>
/// Represents a temperature sensor reading
/// </summary>
public class Sensor
{
    [JsonProperty("id")]
    public string Id { get; set; } = string.Empty;

    [JsonProperty("name")]
    public string Name { get; set; } = string.Empty;

    [JsonProperty("label")]
    public string Label { get; set; } = string.Empty;

    [JsonProperty("type")]
    public string Type { get; set; } = string.Empty;

    [JsonProperty("temperature")]
    public double Temperature { get; set; }

    [JsonProperty("status")]
    public string Status { get; set; } = "ok";

    [JsonProperty("maxTemp")]
    public double? MaxTemp { get; set; }

    [JsonProperty("critTemp")]
    public double? CritTemp { get; set; }

    [JsonProperty("chip")]
    public string Chip { get; set; } = string.Empty;

    [JsonProperty("source")]
    public string Source { get; set; } = string.Empty;

    /// <summary>
    /// Priority for deduplication (higher = prefer this sensor)
    /// </summary>
    [JsonIgnore]
    public int Priority { get; set; }

    /// <summary>
    /// Calculate sensor status based on temperature thresholds
    /// </summary>
    public void UpdateStatus()
    {
        if (CritTemp.HasValue && Temperature >= CritTemp.Value)
        {
            Status = "critical";
        }
        else if (Temperature >= 70.0)
        {
            Status = "warning";
        }
        else if (Temperature >= 60.0)
        {
            Status = "caution";
        }
        else
        {
            Status = "ok";
        }
    }

    /// <summary>
    /// Determine chip priority for deduplication (Windows-specific)
    /// </summary>
    public static int GetChipPriority(string chipName)
    {
        var lowerChip = chipName.ToLowerInvariant();

        // CPU sensors have highest priority (AMD/Intel)
        if (lowerChip.Contains("cpu") || lowerChip.Contains("amd") || lowerChip.Contains("intel"))
            return 100;

        // GPU sensors (NVIDIA/AMD)
        if (lowerChip.Contains("nvidia") || lowerChip.Contains("amd") || lowerChip.Contains("gpu"))
            return 95;

        // Motherboard sensors (ITE, Nuvoton, etc.)
        if (lowerChip.Contains("it86") || lowerChip.Contains("nct") || lowerChip.Contains("ite") || lowerChip.Contains("nuvoton"))
            return 90;

        // NVMe/Storage sensors
        if (lowerChip.Contains("nvme") || lowerChip.Contains("storage"))
            return 80;

        // WMI sensors (Windows Management Instrumentation)
        if (lowerChip.Contains("wmi"))
            return 50;

        // ACPI thermal zones
        if (lowerChip.Contains("acpi") || lowerChip.Contains("thermal"))
            return 40;

        // Default priority
        return 30;
    }
}
