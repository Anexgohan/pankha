using Serilog;

namespace Pankha.Tray;

/// <summary>
/// Entry point for the Pankha Tray Application
/// </summary>
static class Program
{
    [STAThread]
    static void Main()
    {
        // Configure logging
        ConfigureLogging();

        Log.Information("=== Pankha Tray Application Starting ===");
        Log.Information("Version: {Version}", Pankha.WindowsAgent.Platform.VersionHelper.GetVersion());

        // Enable visual styles for modern Windows look
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.SetHighDpiMode(HighDpiMode.SystemAware);

        // Handle unhandled exceptions
        Application.ThreadException += (s, e) =>
        {
            Log.Fatal(e.Exception, "Unhandled thread exception");
            MessageBox.Show($"Fatal Error: {e.Exception.Message}", "Pankha Tray",
                MessageBoxButtons.OK, MessageBoxIcon.Error);
        };

        AppDomain.CurrentDomain.UnhandledException += (s, e) =>
        {
            var ex = e.ExceptionObject as Exception;
            Log.Fatal(ex, "Unhandled domain exception");
        };

        try
        {
            // Run with TrayApplicationContext (no main form)
            using var context = new TrayApplicationContext();
            Application.Run(context);
        }
        catch (Exception ex)
        {
            Log.Fatal(ex, "Fatal error in application");
            MessageBox.Show($"Application Error: {ex.Message}", "Pankha Tray",
                MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
        finally
        {
            Log.Information("=== Pankha Tray Application Exiting ===");
            Log.CloseAndFlush();
        }
    }

    private static void ConfigureLogging()
    {
        // Use "Install Path/logs" as requested by user
        // We use the linked PathResolver from the Platform project
        try
        {
            // PathResolver.LogFilePath includes the filename based on executable name
            // For Tray, we want "pankha-tray.log" in the "logs" folder
            string logDir = Pankha.WindowsAgent.Platform.PathResolver.LogPath;
            Directory.CreateDirectory(logDir);
            
            string logFile = Path.Combine(logDir, "pankha-tray.log");

            Log.Logger = new LoggerConfiguration()
                .MinimumLevel.Debug()
                .WriteTo.File(logFile,
                    rollingInterval: RollingInterval.Infinite, // Single file, no rolling
                    fileSizeLimitBytes: 10 * 1024 * 1024, // 10MB max
                    rollOnFileSizeLimit: true,
                    retainedFileCountLimit: 2,
                    shared: true,
                    outputTemplate: "{Timestamp:yyyy-MM-dd HH:mm:ss} [{Level:u3}] {Message:lj}{NewLine}{Exception}")
                .CreateLogger();

            Log.Debug("Logging initialized at {Path}", logFile);
        }
        catch (Exception ex)
        {
            // Fallback to temp if Install Path is not writable (though user said they want Install Path)
            string tempPath = Path.Combine(Path.GetTempPath(), "pankha-tray.log");
            Log.Logger = new LoggerConfiguration().WriteTo.File(tempPath).CreateLogger();
            Log.Error(ex, "Failed to initialize logging in Install Path. Falling back to {Path}", tempPath);
        }
    }
}
