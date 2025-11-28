using Newtonsoft.Json;

namespace Pankha.WindowsAgent.Models.Configuration;

public class AgentConfig
{
    [JsonProperty("agent")]
    public AgentSettings Agent { get; set; } = new();

    [JsonProperty("backend")]
    public BackendSettings Backend { get; set; } = new();

    [JsonProperty("hardware")]
    public HardwareSettings Hardware { get; set; } = new();

    [JsonProperty("monitoring")]
    public MonitoringSettings Monitoring { get; set; } = new();

    [JsonProperty("logging")]
    public LoggingSettings Logging { get; set; } = new();

    public void SaveToFile(string path)
    {
        var json = JsonConvert.SerializeObject(this, Formatting.Indented);
        File.WriteAllText(path, json);
    }

    public static AgentConfig LoadFromFile(string path)
    {
        if (!File.Exists(path))
        {
            var defaultConfig = new AgentConfig();
            defaultConfig.SaveToFile(path);
            return defaultConfig;
        }

        var json = File.ReadAllText(path);
        return JsonConvert.DeserializeObject<AgentConfig>(json) ?? new AgentConfig();
    }
}

public class AgentSettings
{
    [JsonProperty("agent_id")]
    public string AgentId { get; set; } = $"windows-{Environment.MachineName}-{Guid.NewGuid().ToString("N").Substring(0, 8)}";

    [JsonProperty("name")]
    public string Name { get; set; } = Environment.MachineName;
}

public class BackendSettings
{
    [JsonProperty("url")]
    public string Url { get; set; } = "ws://192.168.100.237:3002";

    [JsonProperty("reconnect_interval_ms")]
    public int ReconnectInterval { get; set; } = 5000;
}

public class HardwareSettings
{
    [JsonProperty("update_interval_seconds")]
    public double UpdateInterval { get; set; } = 2.0;

    [JsonProperty("enable_fan_control")]
    public bool EnableFanControl { get; set; } = true;

    [JsonProperty("emergency_temperature")]
    public double EmergencyTemperature { get; set; } = 90.0;
}

public class MonitoringSettings
{
    [JsonProperty("filter_duplicate_sensors")]
    public bool FilterDuplicateSensors { get; set; } = true;

    [JsonProperty("duplicate_sensor_tolerance")]
    public double DuplicateSensorTolerance { get; set; } = 1.0;

    [JsonProperty("fan_step_percent")]
    public int FanStepPercent { get; set; } = 5;

    [JsonProperty("hysteresis_temp")]
    public double HysteresisTemp { get; set; } = 2.0;
}

public class LoggingSettings
{
    [JsonProperty("level")]
    public string LogLevel { get; set; } = "INFO";
}
