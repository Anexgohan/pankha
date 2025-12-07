using System;
using System.Diagnostics;
using WixSharp;
using WixSharp.CommonTasks;
using WixSharp.UI.Forms;
using System.Windows.Forms;
using IO = System.IO;
using System.Security.Principal;
using Microsoft.Deployment.WindowsInstaller;

namespace Pankha.WixSharpInstaller
{
    class Program
    {
        public static bool IsSelfElevating = false;
        // ... (UpgradeCode remains)
        static readonly Guid UpgradeCode = new Guid("A1B2C3D4-E5F6-4A5B-8C9D-0E1F2A3B4C5D");

        static void Main(string[] args)
        {
            try
            {
                // Set WiX binaries location
                var wixBinPath = IO.Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
                    @".nuget\packages\wixsharp.wix.bin\3.10.0\bin");
                if (IO.Directory.Exists(wixBinPath))
                {
                    Compiler.WixLocation = wixBinPath;
                }

                // Define the service executable
                var agentExe = new WixSharp.File(@"..\publish\win-x64\pankha-agent-windows.exe");

                // Configure Windows Service
                agentExe.ServiceInstaller = new ServiceInstaller
                {
                    Name = "PankhaAgent",
                    DisplayName = "Pankha Hardware Monitoring Agent",
                    Description = "Monitors hardware sensors and controls fan speeds for the Pankha system",
                    StartOn = SvcEvent.Install,
                    StopOn = SvcEvent.InstallUninstall_Wait,
                    RemoveOn = SvcEvent.Uninstall_Wait,
                    Account = @"LocalSystem",
                    Interactive = false
                };

                // Create the project
                var project = new ManagedProject("Pankha Windows Agent",
                    new Dir(@"%ProgramFiles%\Pankha",
                        agentExe,
                        new WixSharp.File(@"..\publish\win-x64\appsettings.json"),
                        new WixSharp.File(@"..\publish\win-x64\config.example.json"),
                        new Dir("logs"),

                        // Installation folder shortcuts
                        new ExeFileShortcut("Configure Pankha Agent", "[INSTALLDIR]pankha-agent-windows.exe", "--setup") { WorkingDirectory = "[INSTALLDIR]" },
                        new ExeFileShortcut("View Pankha Agent Logs", "[INSTALLDIR]pankha-agent-windows.exe", "--logs follow") { WorkingDirectory = "[INSTALLDIR]" },
                        new ExeFileShortcut("Pankha Agent Status", "[System64Folder]cmd.exe",
                            "/K \"cd /d \"[INSTALLDIR]\" && pankha-agent-windows.exe --status && pause\"") { WorkingDirectory = "[INSTALLDIR]" },
                        // Uninstall shortcut with VERBOSE LOGGING (Direct to ProgramData)
                        new ExeFileShortcut("Uninstall Pankha Agent", "[SystemFolder]msiexec.exe", 
                            "/i [ProductCode] /l*v \"[CommonAppDataFolder]Pankha Fan Control\\logs\\uninstall_full.log\"") { WorkingDirectory = "[INSTALLDIR]" }
                    ),

                    // Start Menu shortcuts
                    new Dir(@"%ProgramMenu%\Pankha Agent",
                        new ExeFileShortcut("Configure Pankha Agent", "[INSTALLDIR]pankha-agent-windows.exe", "--setup"),
                        new ExeFileShortcut("View Pankha Agent Logs", "[INSTALLDIR]pankha-agent-windows.exe", "--logs follow"),
                        new ExeFileShortcut("Pankha Agent Status", "[System64Folder]cmd.exe",
                            "/K \"cd /d \"[INSTALLDIR]\" && pankha-agent-windows.exe --status && pause\""),
                        new ExeFileShortcut("Uninstall Pankha Agent", "[SystemFolder]msiexec.exe", 
                            "/i [ProductCode] /l*v \"[CommonAppDataFolder]Pankha Fan Control\\logs\\uninstall_full.log\"")
                    )
                );

                // ... (Metadata) ...
                project.GUID = Guid.NewGuid();
                project.UpgradeCode = UpgradeCode;
                project.Version = new Version("1.0.14");
                project.Platform = Platform.x64;
                project.InstallScope = InstallScope.perMachine;
                
                // Icon
                project.ControlPanelInfo.ProductIcon = @"..\graphics\pankha_icon_256x256.ico";

                // Automatic upgrades
                project.MajorUpgrade = new MajorUpgrade
                {
                    Schedule = UpgradeSchedule.afterInstallInitialize,
                    DowngradeErrorMessage = "A newer version is already installed."
                };

                // Setup ManagedUI
                project.ManagedUI = new ManagedUI();
                project.ManagedUI.Icon = @"..\graphics\pankha_icon_256x256.ico";

                // Install dialogs
                project.ManagedUI.InstallDialogs.Add<WelcomeDialog>()
                                                 .Add<InstallDirDialog>()
                                                 .Add<ProgressDialog>()
                                                 .Add<ConditionalExitDialog>();

                // Maintenance/modify dialogs
                project.ManagedUI.ModifyDialogs.Add<CustomMaintenanceDialog>()
                                                .Add<UninstallConfirmDialog>()
                                                .Add<ProgressDialog>()
                                                .Add<ConditionalExitDialog>();

                // Add Custom Properties
                project.Properties = new[]
                {
                    new Property("KEEP_CONFIG", "1") { Attributes = new System.Collections.Generic.Dictionary<string, string> { { "Secure", "yes" } } }, 
                    new Property("RESET_CONFIG", "0") { Attributes = new System.Collections.Generic.Dictionary<string, string> { { "Secure", "yes" } } },
                    new Property("KEEP_LOGS", "1") { Attributes = new System.Collections.Generic.Dictionary<string, string> { { "Secure", "yes" } } }
                };

                // Enable full UI for uninstall
                project.EnableUninstallFullUI();

                // CRITICAL: Pass these properties to Deferred Actions
                project.DefaultDeferredProperties += ",KEEP_CONFIG,RESET_CONFIG,KEEP_LOGS,INSTALLDIR";

                // Event handlers
                project.BeforeInstall += OnBeforeInstall;
                project.AfterInstall += OnAfterInstall;
                project.UIInitialized += Project_UIInitialized;

                // Build
                project.OutDir = @"bin\x64\Release";
                project.OutFileName = "PankhaAgent";

                Console.WriteLine("Building Pankha Agent MSI installer...");
                project.BuildMsi();

                Console.WriteLine($"\n✅ MSI built: {IO.Path.GetFullPath(project.OutDir)}\\{project.OutFileName}.msi");
            }
            catch (Exception ex)
            {
                Console.WriteLine($"\n❌ FATAL ERROR: {ex}");
                Environment.Exit(1);
            }

        }

        static void Project_UIInitialized(SetupEventArgs e)
        {
            // Force UAC prompt at the very start (Self-Elevation)
            if (!new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator))
            {
                var startInfo = new ProcessStartInfo();
                startInfo.UseShellExecute = true;
                startInfo.WorkingDirectory = Environment.CurrentDirectory;
                startInfo.FileName = "msiexec.exe";
                // Relaunch with same MSI AND Enable Logging for the elevated process
                // Use CommonAppData for PERSISTENT centralized logging
                string logDir = GetCommonAppLogDir();
                IO.Directory.CreateDirectory(logDir); 
                string logPath = IO.Path.Combine(logDir, "install_full_elevated.log");
                startInfo.Arguments = $"/i \"{e.MsiFile}\" /l*v \"{logPath}\"";
                startInfo.Verb = "runas"; // Shows UAC prompt

                try
                {
                    Process.Start(startInfo);
                    Program.IsSelfElevating = true;
                    e.Result = ActionResult.UserExit; 
                }
                catch (Exception)
                {
                    e.Result = ActionResult.UserExit;
                }
            }
        }

        static string GetCommonAppLogDir()
        {
            // Use C:\ProgramData\Pankha Fan Control\logs
            string commonData = Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData);
            return IO.Path.Combine(commonData, "Pankha Fan Control", "logs");
        }

        static void LogToDebugFile(string basePath, string logType, string message)
        {
             // Overridden behavior: Ignroe 'basePath' if we are doing install/uninstall logs 
             // and ALWAYS write to the CommonAppDir, unless explicitly directed otherwise?
             // Actually, the caller should just pass GetCommonAppLogDir() as basePath.
             
            if (string.IsNullOrEmpty(basePath)) return;

            // Adapt: If basePath includes "logs", don't add "logs" again.
            string debugLogPath = basePath.EndsWith("logs") ? basePath : IO.Path.Combine(basePath, "logs");
            
            try
            {
                IO.Directory.CreateDirectory(debugLogPath);
                string filename = $"{logType}.log";
                string fullPath = IO.Path.Combine(debugLogPath, filename);
                IO.File.AppendAllText(fullPath, $"{DateTime.Now:yyyy-MM-dd HH:mm:ss} | {message}{Environment.NewLine}");
            }
            catch
            {
            }
        }

        static void OnBeforeInstall(SetupEventArgs e)
        {
            try
            {
                string removeProp = e.Session["REMOVE"];
                bool isUninstall = e.IsUninstalling || removeProp == "ALL";
                string logType = isUninstall ? "uninstall" : "install";

                // Always log to Central Location
                string logPath = GetCommonAppLogDir();

                LogToDebugFile(logPath, logType, "==========================================");
                LogToDebugFile(logPath, logType, "=== SEQUENCE STARTED (OnBeforeInstall) ===");
                LogToDebugFile(logPath, logType, "==========================================");
                // ... (rest of logging) ...
                LogToDebugFile(logPath, logType, $"Mode: {(isUninstall ? "UNINSTALL" : "INSTALL")}");
                LogToDebugFile(logPath, logType, $"REMOVE Property: '{removeProp}'");
                LogToDebugFile(logPath, logType, $"Installed Property: '{e.Session["Installed"]}'");
                LogToDebugFile(logPath, logType, $"User: {Environment.UserName}");
                LogToDebugFile(logPath, logType, "==========================================");
            }
            catch
            {
            }
        }

        static void OnAfterInstall(SetupEventArgs e)
        {
            // ... (Setup) ...
            string logType = "unknown";
            try
            {
                bool isUninstalling = e.IsUninstalling;
                logType = isUninstalling ? "uninstall" : "install";

                // ... (Property helpers see snippet) ...
                string GetProperty(string name)
                {
                    if (e.Session.CustomActionData.ContainsKey(name))
                        return e.Session.CustomActionData[name];
                    return null;
                }
                
                string keepConfig = GetProperty("KEEP_CONFIG");
                string keepLogs = GetProperty("KEEP_LOGS");
                string resetConfig = GetProperty("RESET_CONFIG");
                string installDirProp = GetProperty("INSTALLDIR");

                // LOGGING: Use Central Directory
                string logBaseDir = GetCommonAppLogDir();
                
                LogToDebugFile(logBaseDir, logType, "=== OnAfterInstall Triggered (Deferred) ===");
                LogToDebugFile(logBaseDir, logType, $"Context: IsUninstalling={isUninstalling}");
                LogToDebugFile(logBaseDir, logType, $"Target InstallDir (for Cleanup): '{installDirProp}'");

                // ... (Cleanup Logic: Reset Config & Uninstall) ...

                // 2. Handle Uninstallation
                if (isUninstalling)
                {
                    try
                    {
                        var dir = installDirProp; 
                        // If dir is null here (rare), fallback
                        if (string.IsNullOrEmpty(dir)) dir = IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Pankha");
                        
                        LogToDebugFile(logBaseDir, logType, $"Target Directory Resolved: '{dir}'");

                        // Stop service
                        LogToDebugFile(logBaseDir, logType, "Phase: Stopping Service...");
                        try
                        {
                            var stopService = Process.Start(new ProcessStartInfo
                            {
                                FileName = "net",
                                Arguments = "stop PankhaAgent",
                                UseShellExecute = false,
                                CreateNoWindow = true
                            });
                            stopService?.WaitForExit(10000);
                            LogToDebugFile(logBaseDir, logType, "Service stop command executed.");
                        }
                        catch (Exception ex) { LogToDebugFile(logBaseDir, logType, $"Service stop failed: {ex.Message}"); }

                        System.Threading.Thread.Sleep(2000);

                        // Kill processes
                        LogToDebugFile(logBaseDir, logType, "Phase: Killing Processes...");
                        foreach (var proc in Process.GetProcessesByName("pankha-agent-windows"))
                        {
                            try 
                            { 
                                proc.Kill(); 
                                proc.WaitForExit(5000);
                                LogToDebugFile(logBaseDir, logType, $"Killed process {proc.Id}");
                            } 
                            catch (Exception ex) { LogToDebugFile(logBaseDir, logType, $"Failed to kill process {proc.Id}: {ex.Message}"); }
                        }

                        System.Threading.Thread.Sleep(1000);

                        // Unload Driver
                        LogToDebugFile(logBaseDir, logType, "Phase: Unloading Driver...");
                        try
                        {
                            Process.Start(new ProcessStartInfo { FileName = "sc", Arguments = "stop pankha-agent-windows", UseShellExecute = false, CreateNoWindow = true })?.WaitForExit(5000);
                            System.Threading.Thread.Sleep(1000);
                            Process.Start(new ProcessStartInfo { FileName = "sc", Arguments = "delete pankha-agent-windows", UseShellExecute = false, CreateNoWindow = true })?.WaitForExit(5000);
                            LogToDebugFile(logBaseDir, logType, "Driver stop/delete commands executed.");
                        }
                        catch (Exception ex) { LogToDebugFile(logBaseDir, logType, $"Driver unload error: {ex.Message}"); }

                        System.Threading.Thread.Sleep(1000);

                        // Clean up driver file
                        try
                        {
                            if (!string.IsNullOrEmpty(dir))
                            {
                                var driverFile = IO.Path.Combine(dir, "pankha-agent-windows.sys");
                                if (IO.File.Exists(driverFile)) 
                                {
                                    IO.File.Delete(driverFile);
                                    LogToDebugFile(logBaseDir, logType, $"Deleted driver file: {driverFile}");
                                }
                            }
                        }
                        catch (Exception ex) { LogToDebugFile(logBaseDir, logType, $"Driver file delete error: {ex.Message}"); }
                        
                        // 3. Files Cleanup
                        LogToDebugFile(logBaseDir, logType, "Phase: File Cleanup...");
                        bool shouldKeep = (keepConfig == "1");
                        bool shouldKeepLogs = (keepLogs == "1");
                        LogToDebugFile(logBaseDir, logType, $"KEEP_CONFIG='{keepConfig}', KEEP_LOGS='{keepLogs}'");

                        if (!string.IsNullOrEmpty(dir) && IO.Directory.Exists(dir))
                        {
                            // A. Config.json
                            if (!shouldKeep)
                            {
                                try 
                                { 
                                    var cfg = IO.Path.Combine(dir, "config.json");
                                    if (IO.File.Exists(cfg)) 
                                    {
                                        IO.File.Delete(cfg);
                                        LogToDebugFile(logBaseDir, logType, "Deleted config.json");
                                    }
                                } 
                                catch (Exception ex) { LogToDebugFile(logBaseDir, logType, $"ERROR deleting config.json: {ex.Message}"); }
                            }
                            
                            // B. Logs folder - NOTE: Since we log to ProgramData now, 
                            // we only delete the [INSTALLDIR]\logs if the user strictly requested valid cleanup?
                            // Actually, [INSTALLDIR]\logs shouldn't really be used anymore with the new strategy, 
                            // except for the shortcuts we made earlier.
                            // But since we are moving to ProgramData, this folder might be empty or non-existent in new installs.
                            // We will keep the logic to clean it just in case.
                            if (!shouldKeepLogs)
                            {
                                try 
                                {
                                    var logs = IO.Path.Combine(dir, "logs");
                                    if (IO.Directory.Exists(logs)) 
                                    {
                                        IO.Directory.Delete(logs, true);
                                    }
                                } 
                                catch (Exception ex) { LogToDebugFile(logBaseDir, logType, $"ERROR deleting logs folder: {ex.Message}"); }
                            }
                            
                            // C. Attempt to remove install dir
                            try 
                            { 
                                 if (IO.Directory.GetFiles(dir).Length == 0 && IO.Directory.GetDirectories(dir).Length == 0)
                                 {
                                     IO.Directory.Delete(dir, false);
                                     LogToDebugFile(logBaseDir, logType, "Deleted empty install directory.");
                                 }
                                 else
                                 {
                                     if (!shouldKeep && !shouldKeepLogs)
                                     {
                                         IO.Directory.Delete(dir, true);
                                         LogToDebugFile(logBaseDir, logType, "Deleted install directory (Recursive).");
                                     }
                                 }
                            } 
                            catch (Exception ex) { LogToDebugFile(logBaseDir, logType, $"Note: Could not delete install directory: {ex.Message}"); } 
                        }

                        // 4. Start Menu Shortcuts
                        var shortcuts = IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonPrograms), "Pankha Agent");
                        if (IO.Directory.Exists(shortcuts))
                        {
                            try 
                            { 
                                IO.Directory.Delete(shortcuts, true); 
                                LogToDebugFile(logBaseDir, logType, "Deleted Start Menu shortcuts.");
                            } 
                            catch (Exception ex) { LogToDebugFile(logBaseDir, logType, $"ERROR deleting shortcuts: {ex.Message}"); }
                        }
                        
                        LogToDebugFile(logBaseDir, logType, "=== Cleanup Phase Complete ===");
                        // LOG MIGRATION LOGIC REMOVED - Logs stay in ProgramData
                    }
                    catch (Exception ex)
                    {
                        LogToDebugFile(logBaseDir, logType, $"CRITICAL FAILED during Cleanup: {ex}");
                    }
                }
            }
            catch {}
        }
        }


    public class ConditionalExitDialog : ExitDialog
    {
        protected override void OnLoad(EventArgs e)
        {
            if (Program.IsSelfElevating)
            {
                // Signalling exit to the shell is enough. 
                // DO NOT call Close() here as it causes ObjectDisposedException during form creation.
                // Just hide it and let the shell loop terminate.
                this.Opacity = 0;
                this.ShowInTaskbar = false;
                this.Visible = false;
                Shell.Exit();
            }
            else
            {
                base.OnLoad(e);
            }
        }
    }
}
