using Newtonsoft.Json;
using Pankha.WindowsAgent.Models;

namespace Pankha.WindowsAgent.Models.Messages;

public class BaseMessage
{
    [JsonProperty("type")]
    public string Type { get; set; } = "";

    [JsonProperty("timestamp")]
    public string Timestamp { get; set; } = DateTime.UtcNow.ToString("o");
}

public class RegisterMessage : BaseMessage
{
    public RegisterMessage()
    {
        Type = "register";
    }

    [JsonProperty("data")]
    public RegisterData Data { get; set; } = new();
}

public class RegisterData
{
    [JsonProperty("agentId")]
    public string AgentId { get; set; } = "";

    [JsonProperty("name")]
    public string Name { get; set; } = "";

    [JsonProperty("version")]
    public string AgentVersion { get; set; } = "1.0.0";

    [JsonProperty("updateInterval")]
    public int UpdateInterval { get; set; }

    [JsonProperty("filterDuplicateSensors")]
    public bool FilterDuplicateSensors { get; set; }

    [JsonProperty("duplicateSensorTolerance")]
    public double DuplicateSensorTolerance { get; set; }

    [JsonProperty("fanStepPercent")]
    public int FanStepPercent { get; set; }

    [JsonProperty("hysteresisTemp")]
    public double HysteresisTemp { get; set; }

    [JsonProperty("emergencyTemp")]
    public double EmergencyTemp { get; set; }

    [JsonProperty("logLevel")]
    public string LogLevel { get; set; } = "INFO";

    [JsonProperty("capabilities")]
    public Capabilities Capabilities { get; set; } = new();
}

public class Capabilities
{
    [JsonProperty("sensors")]
    public List<Sensor> Sensors { get; set; } = new();

    [JsonProperty("fans")]
    public List<Fan> Fans { get; set; } = new();

    [JsonProperty("fanControl")]
    public bool FanControl { get; set; }
}

public class DataMessage : BaseMessage
{
    public DataMessage()
    {
        Type = "data";
    }

    [JsonProperty("data")]
    public DataPayload Data { get; set; } = new();
}

public class DataPayload
{
    [JsonProperty("agentId")]
    public string AgentId { get; set; } = "";

    [JsonProperty("timestamp")]
    public long Timestamp { get; set; }

    [JsonProperty("sensors")]
    public List<Sensor> Sensors { get; set; } = new();

    [JsonProperty("fans")]
    public List<Fan> Fans { get; set; } = new();

    [JsonProperty("system")]
    public SystemHealth SystemHealth { get; set; } = new();
}

public class CommandMessage : BaseMessage
{
    [JsonProperty("data")]
    public CommandData Data { get; set; } = new();
}

public class CommandData
{
    [JsonProperty("commandId")]
    public string CommandId { get; set; } = "";

    [JsonProperty("type")]
    public string Type { get; set; } = "";

    [JsonProperty("payload")]
    public Dictionary<string, object> Payload { get; set; } = new();
}

public class CommandResponse : BaseMessage
{
    public CommandResponse()
    {
        Type = "commandResponse";
    }

    [JsonProperty("commandId")]
    public string CommandId { get; set; } = "";

    [JsonProperty("success")]
    public bool Success { get; set; }

    [JsonProperty("data")]
    public Dictionary<string, object>? Data { get; set; }

    [JsonProperty("error")]
    public string? Error { get; set; }
}
