using Newtonsoft.Json;

namespace Pankha.WindowsAgent.Models.Configuration;

/// <summary>
/// Backend server connection settings
/// Unified snake_case schema matching Linux agent
/// </summary>
public class BackendSettings
{
    [JsonProperty("server_url")]
    public string ServerUrl { get; set; } = "ws://192.168.100.237:3000/websocket";

    [JsonProperty("reconnect_interval")]
    public double ReconnectInterval { get; set; } = 5.0; // seconds (unified with Linux)

    [JsonProperty("max_reconnect_attempts")]
    public int MaxReconnectAttempts { get; set; } = -1; // -1 = infinite

    [JsonProperty("connection_timeout")]
    public double ConnectionTimeout { get; set; } = 10.0; // seconds

    public void Validate()
    {
        if (string.IsNullOrWhiteSpace(ServerUrl))
        {
            throw new InvalidOperationException("Backend server_url cannot be empty");
        }

        if (!ServerUrl.StartsWith("ws://") && !ServerUrl.StartsWith("wss://"))
        {
            throw new InvalidOperationException("Backend server_url must start with ws:// or wss://");
        }

        if (ReconnectInterval < 1.0)
        {
            throw new InvalidOperationException("Reconnect interval must be at least 1 second");
        }

        if (ConnectionTimeout < 1.0 || ConnectionTimeout > 60.0)
        {
            throw new InvalidOperationException("Connection timeout must be between 1 and 60 seconds");
        }
    }
}
