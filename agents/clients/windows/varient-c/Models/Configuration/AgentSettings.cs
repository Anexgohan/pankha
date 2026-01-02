using Newtonsoft.Json;

namespace Pankha.WindowsAgent.Models.Configuration;

/// <summary>
/// Agent identity and basic settings
/// Unified snake_case schema matching Linux agent
/// </summary>
public class AgentSettings
{
    [JsonProperty("id")]
    public string Id { get; set; } = string.Empty;

    [JsonProperty("name")]
    public string Name { get; set; } = "Pankha Windows Agent";

    [JsonProperty("update_interval")]
    public double UpdateInterval { get; set; } = 3.0; // seconds

    [JsonProperty("log_level")]
    public string LogLevel { get; set; } = "INFO";

    public void Validate()
    {
        if (string.IsNullOrWhiteSpace(Id))
        {
            throw new InvalidOperationException("Agent ID cannot be empty");
        }

        if (string.IsNullOrWhiteSpace(Name))
        {
            Name = $"Windows Agent - {Environment.MachineName}";
        }

        if (UpdateInterval < 0.5 || UpdateInterval > 30.0)
        {
            throw new InvalidOperationException("Update interval must be between 0.5 and 30 seconds");
        }

        var validLevels = new[] { "TRACE", "DEBUG", "INFO", "WARN", "ERROR", "CRITICAL" };
        if (!validLevels.Contains(LogLevel.ToUpperInvariant()))
        {
            throw new InvalidOperationException($"Log level must be one of: {string.Join(", ", validLevels)}");
        }
    }
}
