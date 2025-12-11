using Newtonsoft.Json;
using System.IO;
using System;

namespace Pankha.WindowsAgent.Models.Configuration;

/// <summary>
/// Root configuration object for the agent
/// </summary>
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

    /// <summary>
    /// Load configuration from file
    /// </summary>
    public static AgentConfig LoadFromFile(string path)
    {
        if (!File.Exists(path))
        {
            throw new FileNotFoundException($"Configuration file not found: {path}");
        }

        var json = File.ReadAllText(path);
        var config = JsonConvert.DeserializeObject<AgentConfig>(json);

        if (config == null)
        {
            throw new InvalidOperationException("Failed to deserialize configuration");
        }

        return config;
    }

    /// <summary>
    /// Save configuration to file
    /// </summary>
    public void SaveToFile(string path)
    {
        var json = JsonConvert.SerializeObject(this, Formatting.Indented);
        var directory = Path.GetDirectoryName(path);

        if (!string.IsNullOrEmpty(directory) && !Directory.Exists(directory))
        {
            Directory.CreateDirectory(directory);
        }

        File.WriteAllText(path, json);
    }

    /// <summary>
    /// Create default configuration
    /// </summary>
    public static AgentConfig CreateDefault()
    {
        var hostname = Environment.MachineName;
        var agentId = $"windows-{hostname}-{Guid.NewGuid().ToString("N")[..8]}";

        return new AgentConfig
        {
            Agent = new AgentSettings
            {
                Name = $"{hostname}",
                AgentId = agentId,
                Hostname = hostname
            },
            Backend = new BackendSettings
            {
                Url = "ws://192.168.100.237:3000/websocket",
                ReconnectInterval = 5000,
                MaxReconnectAttempts = -1
            },
            Hardware = new HardwareSettings
            {
                UpdateInterval = 3.0,
                EnableFanControl = true,
                MinFanSpeed = 30,
                EmergencyTemperature = 85.0
            },
            Monitoring = new MonitoringSettings
            {
                FilterDuplicateSensors = false,
                DuplicateSensorTolerance = 1.0,
                FanStepPercent = 5,
                HysteresisTemp = 3.0
            },
            Logging = new LoggingSettings
            {
                LogLevel = "INFO",
                LogDirectory = "logs",
                MaxLogFiles = 7,
                MaxLogFileSizeMB = 50
            }
        };
    }
}
