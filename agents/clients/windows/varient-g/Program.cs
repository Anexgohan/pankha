using System;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Serilog;
using Serilog.Events;

namespace PankhaAgent
{
    public class Program
    {
        public static void Main(string[] args)
        {
            Log.Logger = new LoggerConfiguration()
                .MinimumLevel.Debug()
                .MinimumLevel.Override("Microsoft", LogEventLevel.Warning)
                .Enrich.FromLogContext()
                .WriteTo.Console()
                .WriteTo.File("C:\\ProgramData\\PankhaAgent\\logs\\agent.log", rollingInterval: RollingInterval.Day)
                .CreateLogger();

            try
            {
                Log.Information("Starting Pankha Agent Service");
                CreateHostBuilder(args).Build().Run();
            }
            catch (Exception ex)
            {
                Log.Fatal(ex, "Service terminated unexpectedly");
            }
            finally
            {
                Log.CloseAndFlush();
            }
        }

        public static IHostBuilder CreateHostBuilder(string[] args) =>
            Host.CreateDefaultBuilder(args)
                .UseWindowsService() // Enable running as Windows Service
                .UseSerilog()
                .ConfigureServices((hostContext, services) =>
                {
                    // Register HardwareMonitor as Singleton
                    services.AddSingleton<HardwareMonitor>();

                    // Register PankhaClient as Singleton
                    services.AddSingleton<PankhaClient>(sp => 
                    {
                        var logger = sp.GetRequiredService<Microsoft.Extensions.Logging.ILogger<PankhaClient>>();
                        var hardware = sp.GetRequiredService<HardwareMonitor>();
                        // TODO: Load URL from config
                        return new PankhaClient("ws://192.168.100.237:3002/websocket", hardware, logger);
                    });

                    services.AddHostedService<Worker>();
                });
    }
}
