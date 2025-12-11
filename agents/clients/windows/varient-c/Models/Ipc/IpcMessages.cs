namespace Pankha.WindowsAgent.Models.Ipc;

/// <summary>
/// Root message structure for IPC commands
/// </summary>
public class IpcMessage
{
    public string Type { get; set; } = string.Empty;
    public string? Payload { get; set; } // JSON payload if needed
}

/// <summary>
/// Initial status report from Service
/// </summary>
public class AgentStatus
{
    public string AgentId { get; set; } = string.Empty;
    public string Version { get; set; } = string.Empty;
    public string ConnectionState { get; set; } = "Disconnected"; // "Connected", "Connecting", "Disconnected"
    public int SensorsDiscovered { get; set; }
    public int FansDiscovered { get; set; }
    public TimeSpan Uptime { get; set; }
    public bool IsService { get; set; }
}

public static class IpcCommands
{
    public const string GET_STATUS = "GET_STATUS";
    public const string GET_CONFIG = "GET_CONFIG";
    public const string SET_CONFIG = "SET_CONFIG";
}
