using System;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace PankhaAgent
{
    public class Worker : BackgroundService
    {
        private readonly ILogger<Worker> _logger;
        private readonly HardwareMonitor _hardware;
        private readonly PankhaClient _client;

        public Worker(ILogger<Worker> logger, HardwareMonitor hardware, PankhaClient client)
        {
            _logger = logger;
            _hardware = hardware;
            _client = client;
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            _logger.LogInformation("Pankha Agent Service running.");

            // Start WebSocket
            await _client.StartAsync();

            while (!stoppingToken.IsCancellationRequested)
            {
                try
                {
                    // 1. Update Hardware Data
                    _hardware.Update();

                    // 2. Send Update to Backend
                    _client.SendUpdate();

                    // 3. Wait for next interval
                    await Task.Delay(3000, stoppingToken);
                }
                catch (TaskCanceledException)
                {
                    // Ignore
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Error in main loop");
                    await Task.Delay(5000, stoppingToken);
                }
            }
        }

        public override void Dispose()
        {
            _hardware.Dispose();
            base.Dispose();
        }
    }
}
