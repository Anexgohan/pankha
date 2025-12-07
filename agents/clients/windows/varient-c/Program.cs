using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Pankha.WindowsAgent.Hardware;
using Pankha.WindowsAgent.Models.Configuration;
using Pankha.WindowsAgent.Platform;
using Pankha.WindowsAgent.Services;
using Pankha.WindowsAgent.Utilities;
using Serilog;
using System.CommandLine;
using System.CommandLine.Invocation;

namespace Pankha.WindowsAgent;

class Program
{
    // Installation paths - dynamically determined from executable location
    // This allows the agent to work regardless of where it's installed
    // Installation paths - dynamically determined from executable location
    // This allows the agent to work regardless of where it's installed
    private static readonly string INSTALL_DIR = PathResolver.InstallPath;
    private static readonly string CONFIG_PATH = PathResolver.ConfigPath;
    private static readonly string LOG_PATH = PathResolver.LogFilePath;

    // Global LoggingLevelSwitch for dynamic log level changes
    // This allows the CommandHandler to change log level at runtime
    public static readonly Serilog.Core.LoggingLevelSwitch LogLevelSwitch = new();

    static async Task<int> Main(string[] args)
    {
        // Create root command
        var rootCommand = new RootCommand("Pankha Windows Agent - Hardware monitoring and fan control");

        // --test option (run hardware test and exit)
        var testOption = new Option<bool>(
            name: "--test",
            description: "Test hardware discovery and exit");

        // --setup option (run interactive setup wizard)
        var setupOption = new Option<bool>(
            name: "--setup",
            description: "Run interactive setup wizard");

        // --foreground option (run in console for debugging)
        var foregroundOption = new Option<bool>(
            name: "--foreground",
            description: "Run in foreground (for debugging, not as service)");

        // --log-level option
        var logLevelOption = new Option<string>(
            name: "--log-level",
            description: "Log level (Trace, Debug, Information, Warning, Error, Critical)",
            getDefaultValue: () => "Information");

        // --logs option (log viewer)
        var logsOption = new Option<string?>(
            name: "--logs",
            description: "View logs (number for last N lines, 'follow' for live tail, 'list' for all files)");

        // --config-show option
        var configShowOption = new Option<bool>(
            name: "--config-show",
            description: "Display current configuration");

        // --status option
        var statusOption = new Option<bool>(
            name: "--status",
            description: "Show agent status and recent logs");

        // --start option (service management)
        var startOption = new Option<bool>(
            name: "--start",
            description: "Start the Windows Service (requires administrator)");

        // --stop option (service management)
        var stopOption = new Option<bool>(
            name: "--stop",
            description: "Stop the Windows Service (requires administrator)");

        // --restart option (service management)
        var restartOption = new Option<bool>(
            name: "--restart",
            description: "Restart the Windows Service (requires administrator)");

        rootCommand.AddOption(testOption);
        rootCommand.AddOption(setupOption);
        rootCommand.AddOption(foregroundOption);
        rootCommand.AddOption(logLevelOption);
        rootCommand.AddOption(logsOption);
        rootCommand.AddOption(configShowOption);
        rootCommand.AddOption(statusOption);
        rootCommand.AddOption(startOption);
        rootCommand.AddOption(stopOption);
        rootCommand.AddOption(restartOption);

        rootCommand.SetHandler(async (InvocationContext context) =>
        {
            var test = context.ParseResult.GetValueForOption(testOption);
            var setup = context.ParseResult.GetValueForOption(setupOption);
            var foreground = context.ParseResult.GetValueForOption(foregroundOption);
            var logLevel = context.ParseResult.GetValueForOption(logLevelOption)!;
            var logs = context.ParseResult.GetValueForOption(logsOption);
            var configShow = context.ParseResult.GetValueForOption(configShowOption);
            var status = context.ParseResult.GetValueForOption(statusOption);
            var start = context.ParseResult.GetValueForOption(startOption);
            var stop = context.ParseResult.GetValueForOption(stopOption);
            var restart = context.ParseResult.GetValueForOption(restartOption);

            // Ensure "Program Files" directory exists
            Directory.CreateDirectory(Path.GetDirectoryName(CONFIG_PATH)!);
            Directory.CreateDirectory(Path.GetDirectoryName(LOG_PATH)!);

            // Initialize logging
            InitializeLogging(logLevel);

            try
            {
                // Service management commands (don't need full initialization)
                if (start)
                {
                    await ServiceManager.StartServiceAsync();
                    return;
                }

                if (stop)
                {
                    await ServiceManager.StopServiceAsync();
                    return;
                }

                if (restart)
                {
                    await ServiceManager.RestartServiceAsync();
                    return;
                }

                // Log viewing commands (don't need full initialization)
                if (logs != null)
                {
                    if (logs.Equals("follow", StringComparison.OrdinalIgnoreCase))
                    {
                        var cts = new CancellationTokenSource();
                        Console.CancelKeyPress += (s, e) => { e.Cancel = true; cts.Cancel(); };
                        await LogViewer.FollowLogAsync(cts.Token);
                    }
                    else if (logs.Equals("list", StringComparison.OrdinalIgnoreCase))
                    {
                        LogViewer.ListLogFiles();
                    }
                    else if (int.TryParse(logs, out var lineCount))
                    {
                        LogViewer.ShowLastLines(lineCount);
                    }
                    else
                    {
                        Log.Error("Invalid --logs argument. Use a number, 'follow', or 'list'");
                    }
                    return;
                }

                Log.Information("Pankha Windows Agent starting...");
                Log.Information("Version: {Version}", typeof(Program).Assembly.GetName().Version);
                Log.Information("OS: {OS}", Environment.OSVersion);
                Log.Information(".NET Runtime: {Runtime}", Environment.Version);

                // Load or create configuration
                AgentConfig config;
                if (File.Exists(CONFIG_PATH))
                {
                    Log.Information("Loading configuration from {Path}", CONFIG_PATH);
                    config = AgentConfig.LoadFromFile(CONFIG_PATH);
                }
                else
                {
                    Log.Warning("Configuration file not found, creating default: {Path}", CONFIG_PATH);
                    config = AgentConfig.CreateDefault();
                    config.SaveToFile(CONFIG_PATH);
                }

                // Validate configuration
                config.Agent.Validate();
                config.Backend.Validate();
                config.Hardware.Validate();
                config.Monitoring.Validate();
                config.Logging.Validate();

                Log.Information("Agent ID: {AgentId}", config.Agent.AgentId);
                Log.Information("Backend: {Url}", config.Backend.Url);

                // Config show command
                if (configShow)
                {
                    ShowConfiguration(config);
                    return;
                }

                // Status command
                if (status)
                {
                    await ShowStatusAsync(config);
                    return;
                }

                // Setup mode
                if (setup)
                {
                    await RunSetupWizard(config);
                    return;
                }

                // Test mode
                if (test)
                {
                    await RunHardwareTest(config);
                    return;
                }

                // Foreground mode (for debugging)
                if (foreground)
                {
                    await RunForeground(config);
                    return;
                }

                // Default: Run as Windows Service
                Log.Information("Starting as Windows Service...");
                await RunAsService(config);
            }
            catch (Exception ex)
            {
                Log.Fatal(ex, "Fatal error occurred");
                Environment.ExitCode = 1;
            }
            finally
            {
                Log.CloseAndFlush();
            }
        });

        return await rootCommand.InvokeAsync(args);
    }

    static void InitializeLogging(string logLevel)
    {
        var level = logLevel.ToLowerInvariant() switch
        {
            "trace" => Serilog.Events.LogEventLevel.Verbose,
            "debug" => Serilog.Events.LogEventLevel.Debug,
            "information" or "info" => Serilog.Events.LogEventLevel.Information,
            "warning" or "warn" => Serilog.Events.LogEventLevel.Warning,
            "error" => Serilog.Events.LogEventLevel.Error,
            "critical" or "fatal" => Serilog.Events.LogEventLevel.Fatal,
            _ => Serilog.Events.LogEventLevel.Information
        };

        // Set initial level on the switch
        LogLevelSwitch.MinimumLevel = level;

        // Create logger using the switch for dynamic level changes
        Log.Logger = new LoggerConfiguration()
            .MinimumLevel.ControlledBy(LogLevelSwitch)  // Use switch instead of .Is()
            .WriteTo.Console(
                outputTemplate: "{Timestamp:yyyy-MM-dd HH:mm:ss} [{Level:u3}] {Message:lj}{NewLine}{Exception}")
            .WriteTo.File(
                path: LOG_PATH,
                rollingInterval: RollingInterval.Day,
                retainedFileCountLimit: 7,
                fileSizeLimitBytes: 52428800, // 50MB
                outputTemplate: "{Timestamp:yyyy-MM-dd HH:mm:ss} [{Level:u3}] {Message:lj}{NewLine}{Exception}")
            .CreateLogger();
    }

    /// <summary>
    /// Run as Windows Service (default mode)
    /// </summary>
    static async Task RunAsService(AgentConfig config)
    {
        var builder = Host.CreateApplicationBuilder();

        // Configure as Windows Service
        builder.Services.AddWindowsService(options =>
        {
            options.ServiceName = "PankhaAgent";
        });

        // Configure Serilog
        builder.Services.AddSerilog();

        // Register configuration as singleton
        builder.Services.AddSingleton(config);

        // Register hosted service
        builder.Services.AddHostedService<AgentWorker>();

        var host = builder.Build();
        await host.RunAsync();
    }

    /// <summary>
    /// Run in foreground for debugging (legacy mode)
    /// </summary>
    static async Task RunForeground(AgentConfig config)
    {
        Log.Information("Running in foreground mode (debugging)...");
        Log.Information("Press Ctrl+C to stop");

        using var hardware = new LibreHardwareAdapter(
            config.Hardware,
            config.Monitoring,
            Log.Logger);

        using var watchdog = new ConnectionWatchdog(
            hardware,
            Microsoft.Extensions.Logging.Abstractions.NullLogger<ConnectionWatchdog>.Instance);

        using var wsClient = new Pankha.WindowsAgent.Core.WebSocketClient(
            config,
            hardware,
            Log.Logger,
            watchdog);

        // Set up cancellation token
        var cts = new CancellationTokenSource();

        // Start watchdog in background
        _ = watchdog.StartAsync(cts.Token);
        Console.CancelKeyPress += (sender, e) =>
        {
            e.Cancel = true;
            cts.Cancel();
            Log.Information("Shutdown requested...");
        };

        try
        {
            // Start watchdog and WebSocket client
            _ = watchdog.StartAsync(cts.Token);
            await wsClient.StartAsync(cts.Token);
        }
        catch (OperationCanceledException)
        {
            // Expected on shutdown
        }
        catch (Exception ex)
        {
            Log.Error(ex, "Fatal error in agent");
        }

        Log.Information("Agent stopped");
    }

    static async Task RunHardwareTest(AgentConfig config)
    {
        Log.Information("=== Hardware Discovery Test ===");
        Log.Information("");

        using var hardware = new LibreHardwareAdapter(
            config.Hardware,
            config.Monitoring,
            Log.Logger);

        // Test sensor discovery
        Log.Information("Discovering sensors...");
        var sensors = await hardware.DiscoverSensorsAsync();
        Log.Information("✅ Discovered {Count} sensors", sensors.Count);

        if (sensors.Any())
        {
            Log.Information("");
            Log.Information("📊 Top 10 Sensors:");
            foreach (var sensor in sensors.Take(10))
            {
                Log.Information("  • {Name} - {Temp:F1}°C ({Status})", sensor.Name, sensor.Temperature, sensor.Status);
            }
            if (sensors.Count > 10)
            {
                Log.Information("  ... and {More} more", sensors.Count - 10);
            }
        }

        Log.Information("");

        // Test fan discovery
        Log.Information("Discovering fans...");
        var fans = await hardware.DiscoverFansAsync();
        Log.Information("✅ Discovered {Count} fans", fans.Count);

        if (fans.Any())
        {
            Log.Information("");
            Log.Information("🌀 Fans:");
            foreach (var fan in fans)
            {
                var controlStatus = fan.HasPwmControl ? "Controllable" : "Read-only";
                Log.Information("  • {Name} - {Rpm} RPM ({Status}, {Control})", fan.Name, fan.Rpm, fan.Status, controlStatus);
            }
        }

        Log.Information("");

        // Test system health
        Log.Information("Reading system health...");
        var health = await hardware.GetSystemHealthAsync();
        Log.Information("✅ System Health:");
        Log.Information("  • CPU Usage: {Cpu:F1}%", health.CpuUsage);
        Log.Information("  • Memory Usage: {Memory:F1}%", health.MemoryUsage);
        Log.Information("  • Agent Uptime: {Uptime:F0}s", health.AgentUptime);

        Log.Information("");
        Log.Information("=== Test Complete ===");
    }

    static async Task RunSetupWizard(AgentConfig config)
    {
        Log.Information("=== Setup Wizard ===");
        Log.Information("");

        // Agent name
        Console.Write($"Agent name [{config.Agent.Name}]: ");
        var name = Console.ReadLine();
        if (!string.IsNullOrWhiteSpace(name))
        {
            config.Agent.Name = name;
        }

        // Backend URL
        Console.Write($"Backend URL [{config.Backend.Url}]: ");
        var url = Console.ReadLine();
        if (!string.IsNullOrWhiteSpace(url))
        {
            config.Backend.Url = url;
        }

        // Update interval
        Console.Write($"Update interval in seconds [{config.Hardware.UpdateInterval}]: ");
        var intervalStr = Console.ReadLine();
        if (double.TryParse(intervalStr, out var interval))
        {
            config.Hardware.UpdateInterval = interval;
        }

        // Fan control
        Console.Write($"Enable fan control? (y/n) [{(config.Hardware.EnableFanControl ? "y" : "n")}]: ");
        var fanControlStr = Console.ReadLine();
        if (!string.IsNullOrWhiteSpace(fanControlStr))
        {
            config.Hardware.EnableFanControl = fanControlStr.ToLowerInvariant().StartsWith("y");
        }

        // Save configuration
        Log.Information("");
        Log.Information("Saving configuration to {Path}...", CONFIG_PATH);
        config.SaveToFile(CONFIG_PATH);
        Log.Information("✅ Configuration saved");

        // Test hardware
        Log.Information("");
        Console.Write("Test hardware discovery? (y/n) [y]: ");
        var testStr = Console.ReadLine();
        if (string.IsNullOrWhiteSpace(testStr) || testStr.ToLowerInvariant().StartsWith("y"))
        {
            await RunHardwareTest(config);
        }

        Log.Information("");
        Log.Information("=== Setup Complete ===");
        Log.Information("To install as Windows Service, run:");
        Log.Information("  install-service.ps1");
        Log.Information("");
        Log.Information("To test in foreground:");
        Log.Information("  pankha-agent-windows.exe --foreground");
    }

    static void ShowConfiguration(AgentConfig config)
    {
        Log.Information("=== Current Configuration ===");
        Log.Information("");

        Log.Information("📋 Agent Settings:");
        Log.Information("  Agent ID: {AgentId}", config.Agent.AgentId);
        Log.Information("  Name: {Name}", config.Agent.Name);
        Log.Information("  Hostname: {Hostname}", config.Agent.Hostname);
        Log.Information("");

        Log.Information("🌐 Backend Settings:");
        Log.Information("  URL: {Url}", config.Backend.Url);
        Log.Information("  Reconnect Interval: {Interval}ms", config.Backend.ReconnectInterval);
        Log.Information("  Max Reconnect Attempts: {Max}", config.Backend.MaxReconnectAttempts == -1 ? "Infinite" : config.Backend.MaxReconnectAttempts.ToString());
        Log.Information("");

        Log.Information("🔧 Hardware Settings:");
        Log.Information("  Update Interval: {Interval}s", config.Hardware.UpdateInterval);
        Log.Information("  Fan Control: {Enabled}", config.Hardware.EnableFanControl ? "Enabled" : "Disabled");
        Log.Information("  Min Fan Speed: {Min}%", config.Hardware.MinFanSpeed);
        Log.Information("  Emergency Temperature: {Temp}°C", config.Hardware.EmergencyTemperature);
        Log.Information("");

        Log.Information("📊 Monitoring Settings:");
        Log.Information("  Filter Duplicate Sensors: {Enabled}", config.Monitoring.FilterDuplicateSensors ? "Enabled" : "Disabled");
        Log.Information("  Sensor Tolerance: {Tolerance}°C", config.Monitoring.DuplicateSensorTolerance);
        Log.Information("  Fan Step: {Step}%", config.Monitoring.FanStepPercent);
        Log.Information("  Hysteresis: {Hysteresis}°C", config.Monitoring.HysteresisTemp);
        Log.Information("");

        Log.Information("📝 Logging Settings:");
        Log.Information("  Log Level: {Level}", config.Logging.LogLevel);
        Log.Information("  Log Directory: {Dir}", config.Logging.LogDirectory);
        Log.Information("  Max Log Files: {Max}", config.Logging.MaxLogFiles);
        Log.Information("  Max Log Size: {Size} MB", config.Logging.MaxLogFileSizeMB);
        Log.Information("");

        Log.Information("Configuration file: {Path}", CONFIG_PATH);
    }

    static async Task ShowStatusAsync(AgentConfig config)
    {
        Log.Information("=== Agent Status ===");
        Log.Information("");

        // Service status
        ServiceManager.ShowServiceStatus();

        Log.Information("");

        // Hardware test
        using var hardware = new LibreHardwareAdapter(
            config.Hardware,
            config.Monitoring,
            Log.Logger);

        var sensors = await hardware.DiscoverSensorsAsync();
        var fans = await hardware.DiscoverFansAsync();
        var health = await hardware.GetSystemHealthAsync();

        Log.Information("💻 Hardware:");
        Log.Information("  Sensors: {Count}", sensors.Count);
        Log.Information("  Fans: {Count}", fans.Count);
        Log.Information("  CPU Usage: {Cpu:F1}%", health.CpuUsage);
        Log.Information("  Memory Usage: {Memory:F1}%", health.MemoryUsage);
        Log.Information("");

        // Last few log lines
        Log.Information("📋 Recent Logs (last 5 lines):");
        LogViewer.ShowLastLines(5);
    }
}

