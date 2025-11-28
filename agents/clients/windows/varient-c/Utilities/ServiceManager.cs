using Serilog;
using System.Diagnostics;
using System.Security.Principal;
using System.ServiceProcess;

namespace Pankha.WindowsAgent.Utilities;

/// <summary>
/// Windows Service management utility
/// Provides self-managed service control (start, stop, restart, status)
/// </summary>
public static class ServiceManager
{
    private const string SERVICE_NAME = "PankhaAgent";

    /// <summary>
    /// Check if running as administrator
    /// </summary>
    public static bool IsAdministrator()
    {
        using var identity = WindowsIdentity.GetCurrent();
        var principal = new WindowsPrincipal(identity);
        return principal.IsInRole(WindowsBuiltInRole.Administrator);
    }

    /// <summary>
    /// Get service status
    /// </summary>
    public static ServiceControllerStatus? GetServiceStatus()
    {
        try
        {
            using var service = new ServiceController(SERVICE_NAME);
            return service.Status;
        }
        catch (InvalidOperationException)
        {
            // Service doesn't exist
            return null;
        }
    }

    /// <summary>
    /// Check if service exists
    /// </summary>
    public static bool ServiceExists()
    {
        return GetServiceStatus() != null;
    }

    /// <summary>
    /// Start the Windows Service
    /// </summary>
    public static Task<bool> StartServiceAsync()
    {
        return Task.Run(() => StartService());
    }

    private static bool StartService()
    {
        if (!IsAdministrator())
        {
            Log.Error("❌ Administrator privileges required to start service");
            Log.Information("Please run this command from an elevated (Administrator) command prompt");
            return false;
        }

        if (!ServiceExists())
        {
            Log.Error("❌ Service '{ServiceName}' not found", SERVICE_NAME);
            Log.Information("Please install the service first using install-service.ps1");
            return false;
        }

        try
        {
            using var service = new ServiceController(SERVICE_NAME);

            if (service.Status == ServiceControllerStatus.Running)
            {
                Log.Information("✅ Service is already running");
                return true;
            }

            if (service.Status == ServiceControllerStatus.StartPending)
            {
                Log.Information("⏳ Service is already starting...");
                service.WaitForStatus(ServiceControllerStatus.Running, TimeSpan.FromSeconds(30));
                Log.Information("✅ Service started successfully");
                return true;
            }

            Log.Information("🚀 Starting service...");
            service.Start();
            service.WaitForStatus(ServiceControllerStatus.Running, TimeSpan.FromSeconds(30));

            Log.Information("✅ Service started successfully");
            return true;
        }
        catch (Exception ex)
        {
            Log.Error(ex, "❌ Failed to start service");
            return false;
        }
    }

    /// <summary>
    /// Stop the Windows Service
    /// </summary>
    public static Task<bool> StopServiceAsync()
    {
        return Task.Run(() => StopService());
    }

    private static bool StopService()
    {
        if (!IsAdministrator())
        {
            Log.Error("❌ Administrator privileges required to stop service");
            Log.Information("Please run this command from an elevated (Administrator) command prompt");
            return false;
        }

        if (!ServiceExists())
        {
            Log.Error("❌ Service '{ServiceName}' not found", SERVICE_NAME);
            return false;
        }

        try
        {
            using var service = new ServiceController(SERVICE_NAME);

            if (service.Status == ServiceControllerStatus.Stopped)
            {
                Log.Information("✅ Service is already stopped");
                return true;
            }

            if (service.Status == ServiceControllerStatus.StopPending)
            {
                Log.Information("⏳ Service is already stopping...");
                service.WaitForStatus(ServiceControllerStatus.Stopped, TimeSpan.FromSeconds(30));
                Log.Information("✅ Service stopped successfully");
                return true;
            }

            Log.Information("🛑 Stopping service...");
            service.Stop();
            service.WaitForStatus(ServiceControllerStatus.Stopped, TimeSpan.FromSeconds(30));

            Log.Information("✅ Service stopped successfully");
            return true;
        }
        catch (Exception ex)
        {
            Log.Error(ex, "❌ Failed to stop service");
            return false;
        }
    }

    /// <summary>
    /// Restart the Windows Service
    /// </summary>
    public static async Task<bool> RestartServiceAsync()
    {
        Log.Information("🔄 Restarting service...");

        var stopped = await StopServiceAsync();
        if (!stopped)
            return false;

        // Small delay to ensure clean restart
        await Task.Delay(1000);

        return await StartServiceAsync();
    }

    /// <summary>
    /// Display service status with details
    /// </summary>
    public static void ShowServiceStatus()
    {
        if (!ServiceExists())
        {
            Log.Information("📊 Service Status:");
            Log.Information("  Status: ❌ Not Installed");
            Log.Information("");
            Log.Information("To install the service, run:");
            Log.Information("  install-service.ps1");
            return;
        }

        try
        {
            using var service = new ServiceController(SERVICE_NAME);
            service.Refresh();

            Log.Information("📊 Service Status:");
            Log.Information("  Name: {Name}", service.ServiceName);
            Log.Information("  Display Name: {DisplayName}", service.DisplayName);

            var statusIcon = service.Status switch
            {
                ServiceControllerStatus.Running => "🟢",
                ServiceControllerStatus.Stopped => "🔴",
                ServiceControllerStatus.Paused => "🟡",
                ServiceControllerStatus.StartPending => "🟡",
                ServiceControllerStatus.StopPending => "🟡",
                _ => "⚪"
            };

            Log.Information("  Status: {Icon} {Status}", statusIcon, service.Status);
            Log.Information("  Startup Type: {StartupType}", service.StartType);

            if (service.Status == ServiceControllerStatus.Running)
            {
                Log.Information("");
                Log.Information("To stop the service:");
                Log.Information("  pankha-agent-windows.exe --stop");
            }
            else if (service.Status == ServiceControllerStatus.Stopped)
            {
                Log.Information("");
                Log.Information("To start the service:");
                Log.Information("  pankha-agent-windows.exe --start");
            }
        }
        catch (Exception ex)
        {
            Log.Error(ex, "❌ Failed to query service status");
        }
    }
}
