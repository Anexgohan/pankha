using Pankha.WindowsAgent.Platform;
using Serilog;

namespace Pankha.WindowsAgent.Utilities;

/// <summary>
/// Log file viewer utility
/// Provides log viewing capabilities similar to tail command
/// Note: Log file is single file (named after executable from build-config.json)
///       and is overwritten on each service start for clean troubleshooting
/// </summary>
public static class LogViewer
{
    /// <summary>
    /// Get the current log file (single file matching executable name)
    /// </summary>
    private static FileInfo? GetLatestLogFile()
    {
        // Use PathResolver for consistent log file path
        string logPath = PathResolver.LogFilePath;

        if (File.Exists(logPath))
        {
            return new FileInfo(logPath);
        }

        return null;
    }

    /// <summary>
    /// Show last N lines of log file
    /// </summary>
    public static void ShowLastLines(int lineCount = 50)
    {
        var logFile = GetLatestLogFile();

        if (logFile == null || !logFile.Exists)
        {
            Log.Warning("❌ Log file not found: {Path}", PathResolver.LogFilePath);
            return;
        }

        Log.Information("📋 Showing last {Count} lines from {File}", lineCount, logFile.Name);
        Log.Information("");

        try
        {
            // Open with FileShare.ReadWrite to allow reading while service is logging
            using var fileStream = new FileStream(logFile.FullName, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
            using var reader = new StreamReader(fileStream);
            var lines = new List<string>();

            while (!reader.EndOfStream)
            {
                var line = reader.ReadLine();
                if (line != null) lines.Add(line);
            }

            var startIndex = Math.Max(0, lines.Count - lineCount);
            for (int i = startIndex; i < lines.Count; i++)
            {
                Console.WriteLine(lines[i]);
            }
        }
        catch (Exception ex)
        {
            Log.Error(ex, "Failed to read log file");
        }
    }

    /// <summary>
    /// Follow log file (tail -f equivalent)
    /// </summary>
    public static async Task FollowLogAsync(CancellationToken cancellationToken = default)
    {
        var logFile = GetLatestLogFile();

        if (logFile == null || !logFile.Exists)
        {
            Log.Warning("❌ Log file not found: {Path}", PathResolver.LogFilePath);
            return;
        }

        Log.Information("📋 Following log file: {File}", logFile.Name);
        Log.Information("Press Ctrl+C to stop");
        Log.Information("");

        try
        {
            using var fileStream = new FileStream(
                logFile.FullName,
                FileMode.Open,
                FileAccess.Read,
                FileShare.ReadWrite);

            using var reader = new StreamReader(fileStream);

            // Move to end of file
            reader.BaseStream.Seek(0, SeekOrigin.End);

            while (!cancellationToken.IsCancellationRequested)
            {
                var line = await reader.ReadLineAsync(cancellationToken);

                if (line != null)
                {
                    Console.WriteLine(line);
                }
                else
                {
                    // No new data, wait a bit
                    await Task.Delay(100, cancellationToken);

                    // Check if file has been rotated
                    var currentLogFile = GetLatestLogFile();
                    if (currentLogFile?.FullName != logFile.FullName)
                    {
                        Log.Information("");
                        Log.Information("📋 Log file rotated, switching to: {File}", currentLogFile?.Name);
                        Log.Information("");
                        break; // Exit and let caller restart if needed
                    }
                }
            }
        }
        catch (OperationCanceledException)
        {
            // Expected on cancellation
        }
        catch (Exception ex)
        {
            Log.Error(ex, "Failed to follow log file");
        }
    }

    /// <summary>
    /// List all available log files (shows current log + any old files from previous versions)
    /// </summary>
    public static void ListLogFiles()
    {
        string logDirectory = PathResolver.LogPath;

        if (!Directory.Exists(logDirectory))
        {
            Log.Warning("❌ Log directory not found: {Directory}", logDirectory);
            return;
        }

        var directory = new DirectoryInfo(logDirectory);
        var logFiles = directory.GetFiles("*.log*")  // Include .log.1, .log.2 from old config
            .OrderByDescending(f => f.LastWriteTime)
            .ToList();

        if (!logFiles.Any())
        {
            Log.Information("No log files found in {Directory}", logDirectory);
            return;
        }

        Log.Information("📂 Log files in {Directory}:", logDirectory);
        Log.Information("");

        var currentLog = PathResolver.LogFilePath;
        foreach (var file in logFiles)
        {
            var sizeKb = file.Length / 1024.0;
            var age = DateTime.Now - file.LastWriteTime;

            var ageStr = age.TotalDays >= 1
                ? $"{(int)age.TotalDays}d ago"
                : age.TotalHours >= 1
                    ? $"{(int)age.TotalHours}h ago"
                    : $"{(int)age.TotalMinutes}m ago";

            var marker = file.FullName == currentLog ? "→ " : "  ";
            Log.Information("{Marker}• {Name} - {Size:F1} KB - {Age}", marker, file.Name, sizeKb, ageStr);
        }

        Log.Information("");
        Log.Information("Note: Current log file is overwritten on each service start.");
        Log.Information("      Old numbered files (.1, .2) are from previous configuration.");
        Log.Information("");
        Log.Information("To view logs:");
        Log.Information("  {ExeName} --logs 50      # Last 50 lines", Path.GetFileName(PathResolver.ExecutablePath));
        Log.Information("  {ExeName} --logs follow  # Live tail", Path.GetFileName(PathResolver.ExecutablePath));
    }
}
