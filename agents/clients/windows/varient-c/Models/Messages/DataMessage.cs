using Newtonsoft.Json;

namespace Pankha.WindowsAgent.Models.Messages;

/// <summary>
/// Periodic data message sent to backend with sensor/fan readings
/// </summary>
public class DataMessage
{
    [JsonProperty("type")]
    public string Type { get; set; } = "data";

    [JsonProperty("data")]
    public DataPayload Data { get; set; } = new();
}

/// <summary>
/// Data payload with current hardware readings
/// </summary>
public class DataPayload
{
    [JsonProperty("agentId")]
    public string AgentId { get; set; } = string.Empty;

    [JsonProperty("timestamp")]
    public long Timestamp { get; set; }

    [JsonProperty("sensors")]
    public List<Sensor> Sensors { get; set; } = new();

    [JsonProperty("fans")]
    public List<Fan> Fans { get; set; } = new();

    [JsonProperty("systemHealth")]
    public SystemHealth SystemHealth { get; set; } = new();
}
