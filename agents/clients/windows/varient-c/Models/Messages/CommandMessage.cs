using Newtonsoft.Json;

namespace Pankha.WindowsAgent.Models.Messages;

/// <summary>
/// Command message received from backend
/// </summary>
public class CommandMessage
{
    [JsonProperty("type")]
    public string Type { get; set; } = "command";

    [JsonProperty("data")]
    public CommandData Data { get; set; } = new();
}

/// <summary>
/// Command data with execution details
/// </summary>
public class CommandData
{
    [JsonProperty("type")]
    public string Type { get; set; } = string.Empty;

    [JsonProperty("commandId")]
    public string CommandId { get; set; } = string.Empty;

    [JsonProperty("payload")]
    public Dictionary<string, object> Payload { get; set; } = new();
}

/// <summary>
/// Command response sent back to backend
/// </summary>
public class CommandResponse
{
    [JsonProperty("type")]
    public string Type { get; set; } = "commandResponse";

    [JsonProperty("commandId")]
    public string CommandId { get; set; } = string.Empty;

    [JsonProperty("success")]
    public bool Success { get; set; }

    [JsonProperty("data")]
    public Dictionary<string, object>? Data { get; set; }

    [JsonProperty("error")]
    public string? Error { get; set; }

    [JsonProperty("timestamp")]
    public long Timestamp { get; set; }
}
