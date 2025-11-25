using Newtonsoft.Json;

namespace Pankha.WindowsAgent.Models.Messages;

/// <summary>
/// Base WebSocket message for parsing unknown message types
/// </summary>
public class BaseMessage
{
    [JsonProperty("type")]
    public string Type { get; set; } = string.Empty;

    [JsonProperty("data")]
    public object? Data { get; set; }
}
