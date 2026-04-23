using System.Diagnostics;
using Microsoft.Win32;
using Serilog;

namespace Pankha.WindowsAgent.Platform;

/// <summary>
/// Helper for installing and checking PawnIO driver (required for motherboard fan control)
/// </summary>
public static class DriverInstaller
{
    private static readonly ILogger Logger = Log.ForContext(typeof(DriverInstaller));

    /// <summary>
    /// Check if PawnIO driver is installed by querying the Windows service registry.
    /// PawnIO installs to DriverStore (not System32\drivers), so we resolve the path
    /// from HKLM\SYSTEM\CurrentControlSet\Services\PawnIO\ImagePath.
    /// </summary>
    public static bool IsPawnIOInstalled()
    {
        if (!TryGetPawnIODriverPath(out var driverPath) || string.IsNullOrWhiteSpace(driverPath))
            return false;

        return File.Exists(driverPath);
    }

    /// <summary>
    /// Resolve the actual PawnIO driver path from the service registry entry.
    /// Returns false if the service is not registered.
    /// </summary>
    public static bool TryGetPawnIODriverPath(out string? driverPath)
    {
        driverPath = null;
        try
        {
            using var key = Registry.LocalMachine.OpenSubKey(@"SYSTEM\CurrentControlSet\Services\PawnIO");
            if (key == null) return false;

            var imagePathRaw = key.GetValue("ImagePath") as string;
            if (string.IsNullOrWhiteSpace(imagePathRaw)) return false;

            var path = imagePathRaw.Trim().Trim('"');

            // ImagePath typically uses \SystemRoot\ prefix (e.g. \SystemRoot\System32\DriverStore\...)
            if (path.StartsWith(@"\SystemRoot\", StringComparison.OrdinalIgnoreCase))
            {
                var windowsDir = Environment.GetFolderPath(Environment.SpecialFolder.Windows);
                path = Path.Combine(windowsDir, path.Substring(@"\SystemRoot\".Length));
            }
            else
            {
                path = Environment.ExpandEnvironmentVariables(path);
            }

            driverPath = path;
            return true;
        }
        catch (Exception ex)
        {
            Logger.Warning(ex, "Failed to query PawnIO service registry");
            return false;
        }
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
        Console.WriteLine("  • Signed: Yes (digitally signed by namazso)");
        Console.WriteLine("  • Safety: Used by FanControl, OpenRGB, LHM, ZenTimings");
        Console.WriteLine("  • License: GPL v2.0 (open source)");
        Console.WriteLine("  • Source: https://github.com/namazso/PawnIO");
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
    /// Attempt to install the PawnIO driver via bundled PawnIO_setup.exe
    /// </summary>
    public static bool TryInstallDriver()
    {
        try
        {
            Logger.Information("Attempting to install PawnIO driver...");

            // Look for bundled PawnIO_setup.exe in install directory
            var setupPath = Path.Combine(PathResolver.InstallPath, "PawnIO_setup.exe");
            if (!File.Exists(setupPath))
            {
                Logger.Error("PawnIO_setup.exe not found at {Path}", setupPath);
                Console.WriteLine("ERROR: PawnIO installer not found.");
                Console.WriteLine("Download from: https://pawnio.eu");
                return false;
            }

            // Run silent install
            var process = Process.Start(new ProcessStartInfo
            {
                FileName = setupPath,
                Arguments = "-install -silent",
                UseShellExecute = false,
                CreateNoWindow = true
            });

            process?.WaitForExit(30000); // 30s timeout
            var exitCode = process?.ExitCode ?? -1;

            switch (exitCode)
            {
                case 0: // ERROR_SUCCESS
                    Logger.Information("PawnIO driver installed successfully");
                    Console.WriteLine("PawnIO driver installed successfully.");
                    return true;

                case 3010: // ERROR_SUCCESS_REBOOT_REQUIRED
                    Logger.Information("PawnIO installed - reboot required for full functionality");
                    Console.WriteLine("PawnIO installed. A reboot is recommended.");
                    return true;

                default:
                    Logger.Warning("PawnIO installer returned exit code {Code}", exitCode);
                    Console.WriteLine($"PawnIO installation returned code: {exitCode}");
                    return false;
            }
        }
        catch (Exception ex)
        {
            Logger.Error(ex, "Failed to install PawnIO driver");
            Console.WriteLine($"ERROR: {ex.Message}");
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
