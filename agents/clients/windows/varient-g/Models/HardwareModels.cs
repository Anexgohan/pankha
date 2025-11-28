using Newtonsoft.Json;

namespace Pankha.WindowsAgent.Models;

public class Sensor
{
    [JsonProperty("id")]
    public string Id { get; set; } = "";

    [JsonProperty("name")]
    public string Name { get; set; } = "";

    [JsonProperty("label")]
    public string Label { get; set; } = "";

    [JsonProperty("type")]
    public string Type { get; set; } = "";

    [JsonProperty("temperature")]
    public double Temperature { get; set; }

    [JsonProperty("chip")]
    public string Chip { get; set; } = "";

    [JsonProperty("source")]
    public string Source { get; set; } = "";

    [JsonProperty("status")]
    public string Status { get; set; } = "ok";

    [JsonProperty("maxTemp")]
    public double MaxTemp { get; set; } = 85.0;

    [JsonProperty("critTemp")]
    public double CritTemp { get; set; } = 95.0;

    [JsonIgnore]
    public int Priority { get; set; }

    public void UpdateStatus()
    {
        if (Temperature >= CritTemp) Status = "critical";
        else if (Temperature >= MaxTemp) Status = "warning";
        else Status = "ok";
    }

    public static int GetChipPriority(string chipName)
    {
        chipName = chipName.ToLowerInvariant();
        if (chipName.Contains("cpu") || chipName.Contains("processor") || chipName.Contains("core")) return 100;
        if (chipName.Contains("gpu") || chipName.Contains("nvidia") || chipName.Contains("radeon")) return 90;
        if (chipName.Contains("motherboard") || chipName.Contains("mainboard")) return 80;
        if (chipName.Contains("nvme") || chipName.Contains("ssd")) return 70;
        return 50;
    }
}

public class Fan
{
    [JsonProperty("id")]
    public string Id { get; set; } = "";

    [JsonProperty("name")]
    public string Name { get; set; } = "";

    [JsonProperty("label")]
    public string Label { get; set; } = "";

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

    [JsonIgnore]
    public object? HardwareReference { get; set; }

    [JsonIgnore]
    public int LastPwmValue { get; set; } = -1;

    [JsonIgnore]
    public DateTime LastWriteTime { get; set; } = DateTime.MinValue;

    public void UpdateStatus()
    {
        if (Rpm == 0 && Speed > 0) Status = "stalled";
        else Status = "ok";
    }
}

public class SystemHealth
{
    [JsonProperty("cpuUsage")]
    public double CpuUsage { get; set; }

    [JsonProperty("memoryUsage")]
    public double MemoryUsage { get; set; }

    [JsonProperty("uptime")]
    public double Uptime { get; set; }

    public SystemHealth() { }

    public SystemHealth(double cpu, double memory, double uptime)
    {
        CpuUsage = cpu;
        MemoryUsage = memory;
        Uptime = uptime;
    }
}
