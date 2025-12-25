using System.Reflection;

namespace Pankha.WindowsAgent.Platform;

/// <summary>
/// Helper for retrieving application version information
/// </summary>
public static class VersionHelper
{
    /// <summary>
    /// Gets the informational version (Product Version) of the application.
    /// This supports semantic versioning strings (e.g., 0.1.8-alpha.1).
    /// </summary>
    /// <returns>The informational version string</returns>
    public static string GetVersion()
    {
        return Assembly.GetEntryAssembly()
            ?.GetCustomAttribute<AssemblyInformationalVersionAttribute>()
            ?.InformationalVersion ?? "0.0.0";
    }
}
