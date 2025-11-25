using Pankha.WindowsAgent.Hardware;
using Pankha.WindowsAgent.Models.Configuration;
using Serilog;
using System.CommandLine;

namespace Pankha.WindowsAgent;

class Program
{
    static async Task<int> Main(string[] args)
    {
        // Create root command
        var rootCommand = new RootCommand("Pankha Windows Agent - Hardware monitoring and fan control");

        // --config option
        var configOption = new Option<string>(
            name: "--config",
            description: "Path to configuration file",
            getDefaultValue: () => "config.json");

        // --test option
        var testOption = new Option<bool>(
            name: "--test",
            description: "Test hardware discovery and exit");

        // --setup option
        var setupOption = new Option<bool>(
            name: "--setup",
            description: "Run interactive setup wizard");

        // --foreground option
        var foregroundOption = new Option<bool>(
            name: "--foreground",
            description: "Run in foreground (non-service mode)");

        // --log-level option
        var logLevelOption = new Option<string>(
            name: "--log-level",
            description: "Log level (Trace, Debug, Information, Warning, Error, Critical)",
            getDefaultValue: () => "Information");

        rootCommand.AddOption(configOption);
        rootCommand.AddOption(testOption);
        rootCommand.AddOption(setupOption);
        rootCommand.AddOption(foregroundOption);
        rootCommand.AddOption(logLevelOption);

        rootCommand.SetHandler(async (string configPath, bool test, bool setup, bool foreground, string logLevel) =>
        {
            // Initialize logging
            InitializeLogging(logLevel);

            try
            {
                Log.Information("Pankha Windows Agent starting...");
                Log.Information("Version: {Version}", typeof(Program).Assembly.GetName().Version);
                Log.Information("OS: {OS}", Environment.OSVersion);
                Log.Information(".NET Runtime: {Runtime}", Environment.Version);

                // Load or create configuration
                AgentConfig config;
                if (File.Exists(configPath))
                {
                    Log.Information("Loading configuration from {Path}", configPath);
                    config = AgentConfig.LoadFromFile(configPath);
                }
                else
                {
                    Log.Warning("Configuration file not found, creating default: {Path}", configPath);
                    config = AgentConfig.CreateDefault();
                    config.SaveToFile(configPath);
                }

                // Validate configuration
                config.Agent.Validate();
                config.Backend.Validate();
                config.Hardware.Validate();
                config.Monitoring.Validate();
                config.Logging.Validate();

                Log.Information("Agent ID: {AgentId}", config.Agent.AgentId);
                Log.Information("Backend: {Url}", config.Backend.Url);

                // Setup mode
                if (setup)
                {
                    await RunSetupWizard(config, configPath);
                    return;
                }

                // Test mode
                if (test)
                {
                    await RunHardwareTest(config);
                    return;
                }

                // Foreground mode (for now, only support this)
                if (foreground)
                {
                    await RunForeground(config);
                    return;
                }

                // Default: Run in foreground
                Log.Information("Starting in foreground mode...");
                await RunForeground(config);
            }
            catch (Exception ex)
            {
                Log.Fatal(ex, "Fatal error occurred");
                return;
            }
            finally
            {
                Log.CloseAndFlush();
            }
        }, configOption, testOption, setupOption, foregroundOption, logLevelOption);

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

        Log.Logger = new LoggerConfiguration()
            .MinimumLevel.Is(level)
            .WriteTo.Console(
                outputTemplate: "{Timestamp:yyyy-MM-dd HH:mm:ss} [{Level:u3}] {Message:lj}{NewLine}{Exception}")
            .WriteTo.File(
                path: "logs/agent-.log",
                rollingInterval: RollingInterval.Day,
                retainedFileCountLimit: 7,
                fileSizeLimitBytes: 52428800, // 50MB
                outputTemplate: "{Timestamp:yyyy-MM-dd HH:mm:ss} [{Level:u3}] {Message:lj}{NewLine}{Exception}")
            .CreateLogger();
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

    static async Task RunSetupWizard(AgentConfig config, string configPath)
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
        Log.Information("Saving configuration to {Path}...", configPath);
        config.SaveToFile(configPath);
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
        Log.Information("Run 'pankha-agent.exe --foreground' to start the agent");
    }

    static async Task RunForeground(AgentConfig config)
    {
        Log.Information("Running in foreground mode...");
        Log.Information("Press Ctrl+C to stop");

        using var hardware = new LibreHardwareAdapter(
            config.Hardware,
            config.Monitoring,
            Log.Logger);

        using var wsClient = new Pankha.WindowsAgent.Core.WebSocketClient(
            config,
            hardware,
            Log.Logger);

        // Set up cancellation token
        var cts = new CancellationTokenSource();
        Console.CancelKeyPress += (sender, e) =>
        {
            e.Cancel = true;
            cts.Cancel();
            Log.Information("Shutdown requested...");
        };

        try
        {
            // Start WebSocket client (handles connection, registration, data transmission)
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
}
