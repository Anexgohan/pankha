using Pankha.WindowsAgent.Core;

namespace Pankha.WindowsAgent;

public class Worker : BackgroundService
{
    private readonly WebSocketClient _client;
    private readonly ILogger<Worker> _logger;

    public Worker(WebSocketClient client, ILogger<Worker> logger)
    {
        _client = client;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("Worker running at: {time}", DateTimeOffset.Now);
        await _client.RunAsync(stoppingToken);
    }
}
