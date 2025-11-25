using Newtonsoft.Json;

namespace Pankha.WindowsAgent.Models.Configuration;

/// <summary>
/// Agent identity and basic settings
/// </summary>
public class AgentSettings
{
    [JsonProperty("name")]
    public string Name { get; set; } = "Pankha Windows Agent";

    [JsonProperty("agentId")]
    public string AgentId { get; set; } = string.Empty;

    [JsonProperty("hostname")]
    public string Hostname { get; set; } = string.Empty;

    public void Validate()
    {
        if (string.IsNullOrWhiteSpace(AgentId))
        {
            throw new InvalidOperationException("Agent ID cannot be empty");
        }

        if (string.IsNullOrWhiteSpace(Hostname))
        {
            Hostname = Environment.MachineName;
        }

        if (string.IsNullOrWhiteSpace(Name))
        {
            Name = $"Windows Agent - {Hostname}";
        }
    }
}
