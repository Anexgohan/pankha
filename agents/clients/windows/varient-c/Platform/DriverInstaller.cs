using Serilog;

namespace Pankha.WindowsAgent.Platform;

/// <summary>
/// Helper for installing and checking PawnIO driver (required for motherboard fan control)
/// </summary>
public static class DriverInstaller
{
    private static readonly ILogger Logger = Log.ForContext(typeof(DriverInstaller));
    private const string PAWN_IO_DRIVER_PATH = @"C:\Windows\System32\drivers\PawnIO.sys";

    /// <summary>
    /// Check if PawnIO driver is installed
    /// </summary>
    public static bool IsPawnIOInstalled()
    {
        return File.Exists(PAWN_IO_DRIVER_PATH);
    }

    /// <summary>
    /// Show detailed help text explaining why the driver is needed
    /// </summary>
    public static void ShowDriverSetupHelp()
    {
        Console.WriteLine();
        Console.WriteLine("═══════════════════════════════════════════════════════════════");
        Console.WriteLine("  PawnIO Driver Setup");
        Console.WriteLine("═══════════════════════════════════════════════════════════════");
        Console.WriteLine();
        Console.WriteLine("The PawnIO driver is REQUIRED for motherboard fan control.");
        Console.WriteLine();
        Console.WriteLine("Why it's needed:");
        Console.WriteLine("  • Provides low-level hardware access for IT87xx/NCT67xx chips");
        Console.WriteLine("  • Enables PWM fan speed control on motherboard headers");
        Console.WriteLine("  • Required for reading motherboard temperature sensors");
        Console.WriteLine();
        Console.WriteLine("What happens if skipped:");
        Console.WriteLine("  • NVIDIA/AMD GPU fans will still work (uses GPU drivers)");
        Console.WriteLine("  • Motherboard fan control will NOT work");
        Console.WriteLine("  • You can install the driver later by running setup again");
        Console.WriteLine();
        Console.WriteLine("Driver Information:");
        Console.WriteLine("  • Source: LibreHardwareMonitor (open source)");
        Console.WriteLine("  • Signed: Yes (Microsoft WHQL)");
        Console.WriteLine("  • Safety: Used by 100,000+ users worldwide");
        Console.WriteLine("  • License: MIT Open Source");
        Console.WriteLine("═══════════════════════════════════════════════════════════════");
        Console.WriteLine();
    }

    /// <summary>
    /// Prompt user for driver installation
    /// </summary>
    public static bool PromptDriverInstall()
    {
        ShowDriverSetupHelp();

        Console.Write("Install PawnIO driver now? (y/N): ");
        var response = Console.ReadLine()?.Trim().ToLowerInvariant();

        return response == "y" || response == "yes";
    }

    /// <summary>
    /// Attempt to install the PawnIO driver
    /// </summary>
    public static bool TryInstallDriver()
    {
        try
        {
            Logger.Information("Attempting to install PawnIO driver...");

            // LibreHardwareMonitor auto-installs driver on first Computer.Open()
            // This requires administrator privileges
            var computer = new LibreHardwareMonitor.Hardware.Computer
            {
                IsMotherboardEnabled = true
            };

            computer.Open();
            computer.Close();

            // Check if driver was installed
            if (IsPawnIOInstalled())
            {
                Logger.Information("PawnIO driver installed successfully");
                Console.WriteLine();
                Console.WriteLine("Driver installed successfully!");
                return true;
            }
            else
            {
                Logger.Warning("Driver installation completed but driver not detected");
                Console.WriteLine("WARNING: Driver installation completed but driver not detected");
                return false;
            }
        }
        catch (UnauthorizedAccessException)
        {
            Logger.Error("Administrator privileges required to install driver");
            Console.WriteLine();
            Console.WriteLine("ERROR: Administrator privileges required!");
            Console.WriteLine("Please run the installer as Administrator.");
            Console.WriteLine();
            Console.WriteLine("Right-click pankha-agent-windows.exe -> Run as Administrator");
            return false;
        }
        catch (Exception ex)
        {
            Logger.Error(ex, "Failed to install PawnIO driver");
            Console.WriteLine();
            Console.WriteLine($"ERROR: Driver installation failed: {ex.Message}");
            Console.WriteLine();
            Console.WriteLine("Common causes:");
            Console.WriteLine("  - Antivirus blocking driver installation");
            Console.WriteLine("  - Windows Secure Boot preventing driver load");
            Console.WriteLine("  - Incompatible motherboard chipset");
            return false;
        }
    }

    /// <summary>
    /// Check if running as Administrator
    /// </summary>
    public static bool IsRunningAsAdmin()
    {
        try
        {
            var identity = System.Security.Principal.WindowsIdentity.GetCurrent();
            var principal = new System.Security.Principal.WindowsPrincipal(identity);
            return principal.IsInRole(System.Security.Principal.WindowsBuiltInRole.Administrator);
        }
        catch
        {
            return false;
        }
    }
}
