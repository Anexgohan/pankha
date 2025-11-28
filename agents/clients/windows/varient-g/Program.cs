using Pankha.WindowsAgent;
using Pankha.WindowsAgent.Core;
using Pankha.WindowsAgent.Hardware;
using Pankha.WindowsAgent.Models.Configuration;
using Serilog;

var configPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "config.json");
var config = AgentConfig.LoadFromFile(configPath);

Log.Logger = new LoggerConfiguration()
    .MinimumLevel.Debug()
    .WriteTo.Console()
    .WriteTo.File(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "PankhaAgent", "logs", "agent.log"), rollingInterval: RollingInterval.Day)
    .CreateLogger();

try
{
    var builder = Host.CreateApplicationBuilder(args);
    builder.Services.AddWindowsService(options =>
    {
        options.ServiceName = "PankhaAgent";
    });

    builder.Services.AddSerilog();
    
    // Register Config
    builder.Services.AddSingleton(config);
    builder.Services.AddSingleton(provider => configPath); // Inject path for CommandHandler

    // Register Hardware
    builder.Services.AddSingleton<IHardwareMonitor, LibreHardwareAdapter>();

    // Register Core
    builder.Services.AddSingleton<CommandHandler>();
    builder.Services.AddSingleton<WebSocketClient>();

    builder.Services.AddHostedService<Worker>();

    var host = builder.Build();
    host.Run();
}
catch (Exception ex)
{
    Log.Fatal(ex, "Application terminated unexpectedly");
}
finally
{
    Log.CloseAndFlush();
}
