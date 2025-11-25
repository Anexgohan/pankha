using Newtonsoft.Json;

namespace Pankha.WindowsAgent.Models.Messages;

/// <summary>
/// WebSocket registration message sent to backend on connection
/// </summary>
public class RegisterMessage
{
    [JsonProperty("type")]
    public string Type { get; set; } = "register";

    [JsonProperty("data")]
    public RegisterData Data { get; set; } = new();
}

/// <summary>
/// Registration data payload
/// </summary>
public class RegisterData
{
    [JsonProperty("agentId")]
    public string AgentId { get; set; } = string.Empty;

    [JsonProperty("name")]
    public string Name { get; set; } = string.Empty;

    [JsonProperty("agent_version")]
    public string AgentVersion { get; set; } = "1.0.0-windows";

    [JsonProperty("update_interval")]
    public int UpdateInterval { get; set; } // milliseconds

    [JsonProperty("filter_duplicate_sensors")]
    public bool FilterDuplicateSensors { get; set; }

    [JsonProperty("duplicate_sensor_tolerance")]
    public double DuplicateSensorTolerance { get; set; }

    [JsonProperty("fan_step_percent")]
    public int FanStepPercent { get; set; }

    [JsonProperty("hysteresis_temp")]
    public double HysteresisTemp { get; set; }

    [JsonProperty("emergency_temp")]
    public double EmergencyTemp { get; set; }

    [JsonProperty("log_level")]
    public string LogLevel { get; set; } = "INFO";

    [JsonProperty("capabilities")]
    public Capabilities Capabilities { get; set; } = new();
}

/// <summary>
/// Agent capabilities (hardware discovered)
/// </summary>
public class Capabilities
{
    [JsonProperty("sensors")]
    public List<Sensor> Sensors { get; set; } = new();

    [JsonProperty("fans")]
    public List<Fan> Fans { get; set; } = new();

    [JsonProperty("fan_control")]
    public bool FanControl { get; set; } = true;
}
