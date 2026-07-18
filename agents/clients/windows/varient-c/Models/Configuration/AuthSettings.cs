using Newtonsoft.Json;

namespace Pankha.WindowsAgent.Models.Configuration;

/// <summary>
/// Hub credentials. Kept as the last section of config.json (property
/// declaration order in AgentConfig controls serialization order).
/// </summary>
public class AuthSettings
{
    /// <summary>
    /// One-time bootstrap credential written by the install flow; removed
    /// when the Hub issues the permanent auth_token.
    /// </summary>
    [JsonProperty("enrollment_token", NullValueHandling = NullValueHandling.Ignore)]
    public string? EnrollmentToken { get; set; }

    /// <summary>
    /// Hub-minted permanent credential, presented on every registration.
    /// </summary>
    [JsonProperty("auth_token", NullValueHandling = NullValueHandling.Ignore)]
    public string? AuthToken { get; set; }
}
