using Serilog;

namespace Pankha.WindowsAgent.Utilities;

/// <summary>
/// Log file viewer utility
/// Provides log viewing capabilities similar to tail command
/// </summary>
public static class LogViewer
{
    // Dynamically determine log directory from executable location
    private static readonly string LOG_DIRECTORY = Path.Combine(AppContext.BaseDirectory, "logs");

    /// <summary>
    /// Get the current log file
    /// </summary>
    private static FileInfo? GetLatestLogFile()
    {
        if (!Directory.Exists(LOG_DIRECTORY))
        {
            return null;
        }

        string logFileName = Path.ChangeExtension(AppDomain.CurrentDomain.FriendlyName, ".log");
        var path = Path.Combine(LOG_DIRECTORY, logFileName);
        if (File.Exists(path))
        {
            return new FileInfo(path);
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
            Log.Warning("❌ No log files found in {Directory}", LOG_DIRECTORY);
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
            Log.Warning("❌ No log files found in {Directory}", LOG_DIRECTORY);
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
    /// List all available log files
    /// </summary>
    public static void ListLogFiles()
    {
        if (!Directory.Exists(LOG_DIRECTORY))
        {
            Log.Warning("❌ Log directory not found: {Directory}", LOG_DIRECTORY);
            return;
        }

        var directory = new DirectoryInfo(LOG_DIRECTORY);
        var logFiles = directory.GetFiles("*.log")
            .OrderByDescending(f => f.LastWriteTime)
            .ToList();

        if (!logFiles.Any())
        {
            Log.Information("No log files found in {Directory}", LOG_DIRECTORY);
            return;
        }

        Log.Information("📂 Log files in {Directory}:", LOG_DIRECTORY);
        Log.Information("");

        foreach (var file in logFiles)
        {
            var sizeKb = file.Length / 1024.0;
            var age = DateTime.Now - file.LastWriteTime;

            var ageStr = age.TotalDays >= 1
                ? $"{(int)age.TotalDays}d ago"
                : age.TotalHours >= 1
                    ? $"{(int)age.TotalHours}h ago"
                    : $"{(int)age.TotalMinutes}m ago";

            Log.Information("  • {Name} - {Size:F1} KB - {Age}", file.Name, sizeKb, ageStr);
        }

        Log.Information("");
        Log.Information("To view logs:");
        Log.Information("  pankha-agent-windows.exe --logs 50      # Last 50 lines");
        Log.Information("  pankha-agent-windows.exe --logs follow  # Live tail");
    }
}
