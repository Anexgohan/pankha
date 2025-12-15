namespace Pankha.WindowsAgent.Platform;

/// <summary>
/// Centralized Windows path management
///
/// Everything in one location: C:\Program Files\Pankha\
/// This works because the agent runs as Windows Service (SYSTEM account)
/// which has write access to Program Files.
/// </summary>
public static class PathResolver
{
    private static string? _executablePath;

    /// <summary>
    /// Executable path (Lazy loaded to avoid static initialization order issues and Service startup crashes)
    /// </summary>
    public static string ExecutablePath
    {
        get
        {
            if (_executablePath == null)
            {
                // Try safe method first for .NET 6+
                _executablePath = Environment.ProcessPath;

                // Fallback if needed (though ProcessPath is reliable in modern .NET)
                if (string.IsNullOrEmpty(_executablePath))
                {
                    try
                    {
                        using var process = System.Diagnostics.Process.GetCurrentProcess();
                        _executablePath = process.MainModule?.FileName;
                    }
                    catch
                    {
                        // Ultimate fallback: construct from BaseDirectory + FriendlyName
                        _executablePath = Path.Combine(AppContext.BaseDirectory, AppDomain.CurrentDomain.FriendlyName);
                    }
                }
            }
            return _executablePath ?? string.Empty;
        }
    }

    /// <summary>
    /// Base installation directory
    /// </summary>
    public static readonly string InstallPath = AppContext.BaseDirectory;

    /// <summary>
    /// Directory for log files
    /// </summary>
    public static readonly string LogPath = Path.Combine(InstallPath, "logs");

    /// <summary>
    /// Configuration file path
    /// </summary>
    public static readonly string ConfigPath = Path.Combine(InstallPath, "config.json");

    /// <summary>
    /// Main log file path (matches executable name from build-config.json)
    /// Example: If AgentExe is "pankha-agent.exe", log file is "pankha-agent.log"
    /// Uses lazy ExecutablePath to avoid static init crashes.
    /// </summary>
    public static readonly string LogFilePath = Path.Combine(LogPath,
        Path.ChangeExtension(Path.GetFileName(ExecutablePath), ".log"));

    /// <summary>
    /// Ensures all required directories exist
    /// </summary>
    public static void EnsureDirectoriesExist()
    {
        try 
        {
            Directory.CreateDirectory(InstallPath);
            Directory.CreateDirectory(LogPath);
        }
        catch { /* Best effort */ }
    }
}
