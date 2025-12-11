using System.Windows;
using Hardcodet.Wpf.TaskbarNotification;
using Serilog;
using System.Reflection;

namespace Pankha.UI;

public partial class App : Application
{
    private TaskbarIcon? _notifyIcon;

    protected override void OnStartup(StartupEventArgs e)
    {
        // 1. Setup Exception Handling immediately
        AppDomain.CurrentDomain.UnhandledException += (s, args) =>
            LogFatalException((Exception)args.ExceptionObject, "AppDomain.UnhandledException");

        DispatcherUnhandledException += (s, args) =>
        {
            LogFatalException(args.Exception, "DispatcherUnhandledException");
            args.Handled = true; // Try to keep alive? Or at least flush logs.
        };

        // 2. Configure Logging with Fallback
        ConfigureLogging();

        Serilog.Log.Information("--------------------------------------------------");
        Serilog.Log.Information("Tray Application Starting... Version: {Version}", Assembly.GetExecutingAssembly().GetName().Version);
        
        base.OnStartup(e);

        try 
        {
            // 3. Initialize Tray Icon
            // Find the TaskbarIcon resource to ensure it's initialized
            _notifyIcon = (TaskbarIcon)FindResource("TrayIcon");
            Serilog.Log.Information("Tray Icon initialized successfully.");
        }
        catch (Exception ex)
        {
             Serilog.Log.Error(ex, "Failed to initialize Tray Icon.");
             MessageBox.Show($"Critical Error initializing Tray Icon: {ex.Message}", "Pankha Tray Error", MessageBoxButton.OK, MessageBoxImage.Error);
             Shutdown();
        }
    }

    private void ConfigureLogging()
    {
        // Strategy: Try CommonAppData (shared), Fallback to LocalAppData (user private)
        string[] pathsToTry = new[] 
        {
            Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData)
        };

        string? companyName = "Pankha Fan Control";
        string productFilePrefix = "pankha-tray";

        foreach (var basePath in pathsToTry)
        {
            try
            {
                string logDir = System.IO.Path.Combine(basePath, companyName, "logs");
                System.IO.Directory.CreateDirectory(logDir);
                string logFile = System.IO.Path.Combine(logDir, $"{productFilePrefix}-.log");

                Serilog.Log.Logger = new Serilog.LoggerConfiguration()
                    .MinimumLevel.Debug()
                    .WriteTo.File(logFile, 
                        rollingInterval: Serilog.RollingInterval.Day, 
                        retainedFileCountLimit: 7,
                        shared: true, // Important for multiple instances or permission checking
                        outputTemplate: "{Timestamp:yyyy-MM-dd HH:mm:ss} [{Level:u3}] {Message:lj}{NewLine}{Exception}")
                    .CreateLogger();

                // Test write
                Serilog.Log.Debug("Logging initialized at {Path}", logFile);
                return; // Success
            }
            catch (Exception)
            {
                // Try next path
            }
        }
    }

    private void LogFatalException(Exception ex, string context)
    {
        if (Serilog.Log.Logger != null)
        {
            Serilog.Log.Fatal(ex, "FATAL CRASH in {Context}", context);
            Serilog.Log.CloseAndFlush();
        }
        // Last resort UI
        // MessageBox.Show($"Fatal Error ({context}): {ex.Message}", "Pankha Tray Crash", MessageBoxButton.OK, MessageBoxImage.Error);
    }

    protected override void OnExit(ExitEventArgs e)
    {
        Serilog.Log.Information("Tray Application Exiting...");
        Serilog.Log.CloseAndFlush();
        _notifyIcon?.Dispose(); // Check if needed, but good practice
        base.OnExit(e);
    }
}
