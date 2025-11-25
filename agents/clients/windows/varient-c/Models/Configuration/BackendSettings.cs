using Newtonsoft.Json;

namespace Pankha.WindowsAgent.Models.Configuration;

/// <summary>
/// Backend server connection settings
/// </summary>
public class BackendSettings
{
    [JsonProperty("url")]
    public string Url { get; set; } = "ws://192.168.100.237:3000/websocket";

    [JsonProperty("reconnectInterval")]
    public int ReconnectInterval { get; set; } = 5000;

    [JsonProperty("maxReconnectAttempts")]
    public int MaxReconnectAttempts { get; set; } = -1; // -1 = infinite

    public void Validate()
    {
        if (string.IsNullOrWhiteSpace(Url))
        {
            throw new InvalidOperationException("Backend URL cannot be empty");
        }

        if (!Url.StartsWith("ws://") && !Url.StartsWith("wss://"))
        {
            throw new InvalidOperationException("Backend URL must start with ws:// or wss://");
        }

        if (ReconnectInterval < 1000)
        {
            throw new InvalidOperationException("Reconnect interval must be at least 1000ms");
        }
    }
}
