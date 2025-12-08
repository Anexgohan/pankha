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
    /// <summary>
    /// Base installation directory (Dynamic based on executable location)
    /// Contains: executable, config, logs
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
    /// Main log file path (with rolling date suffix)
    /// </summary>
    public static readonly string LogFilePath = Path.Combine(LogPath, "agent-.log");

    /// <summary>
    /// Executable path
    /// </summary>
    public static readonly string ExecutablePath = System.Diagnostics.Process.GetCurrentProcess().MainModule.FileName;

    /// <summary>
    /// Ensures all required directories exist
    /// </summary>
    public static void EnsureDirectoriesExist()
    {
        Directory.CreateDirectory(InstallPath);
        Directory.CreateDirectory(LogPath);
    }
}
