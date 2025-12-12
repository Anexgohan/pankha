using System;
using System.Diagnostics;
using System.Drawing;
using WixSharp;
using WixSharp.CommonTasks;
using WixSharp.UI.Forms;
using System.Windows.Forms;
using IO = System.IO;
using System.Security.Principal;
using Microsoft.Deployment.WindowsInstaller;
using Newtonsoft.Json;
using System.Collections.Generic;

namespace Pankha.WixSharpInstaller
{
    // Configuration Classes
    public class BuildConfig
    {
        public string Manufacturer { get; set; }
        public string Product { get; set; }
        public BuildPaths Paths { get; set; }
        public BuildFilenames Filenames { get; set; }
    }

    public class BuildPaths
    {
        public string WixBin { get; set; }
        public string BuildArtifacts { get; set; }
        public string InstallerOutput { get; set; }
        public string AppIcon_256 { get; set; }
    }

    public class BuildFilenames
    {
        public string AgentExe { get; set; }
        public string AgentUI { get; set; }
        public string InstallerMsi { get; set; }
        public string InstallerExe { get; set; }
        public string ShortName { get; set; }
    }

    class Program
    {
        public static bool IsSelfElevating = false;
        static readonly Guid UpgradeCode = new Guid("A1B2C3D4-E5F6-4A5B-8C9D-0E1F2A3B4C5D");
        
        // Static config to be accessible
        static BuildConfig Config;

        static void Main(string[] args)
        {
            try
            {
                // 1. Load Configuration
                IO.File.AppendAllText("debug.log", $"DEBUG: CWD = {Environment.CurrentDirectory}\n");
                LoadConfiguration();
                IO.File.AppendAllText("debug.log", $"DEBUG: Config loaded. AgentUI = '{Config.Filenames.AgentUI}'\n");

                // 2. Set WiX binaries location
                // Resolve %UserProfile% if present
                string wixBinPath = Config.Paths.WixBin.Replace("%UserProfile%", Environment.GetFolderPath(Environment.SpecialFolder.UserProfile));
                if (IO.Directory.Exists(wixBinPath))
                {
                    Compiler.WixLocation = wixBinPath;
                }
                else
                {
                   Console.WriteLine($"WARNING: WiX Bin path not found: {wixBinPath}. Using default.");
                }

                // 3. Define the service executable
                // Path is relative to the installer project folder, or where we run it.
                // Config.Paths.BuildArtifacts is relative to project root ("publish/win-x64").
                // If running from 'installer' folder, we need "..\publish\win-x64".
                // Since we assume we run from 'installer' folder (as per build.ps1), we prepend "..\"
                string artifactPath = IO.Path.Combine("..", Config.Paths.BuildArtifacts.Replace("/", "\\"));
                string exePath = IO.Path.Combine(artifactPath, Config.Filenames.AgentExe);
                string uiPath = IO.Path.Combine(artifactPath, Config.Filenames.AgentUI);
                
                IO.File.AppendAllText("debug.log", $"DEBUG: Checking AgentExe at '{IO.Path.GetFullPath(exePath)}'\n");
                if (!IO.File.Exists(exePath)) IO.File.AppendAllText("debug.log", "ERROR: AgentExe not found!\n");
                
                IO.File.AppendAllText("debug.log", $"DEBUG: Checking AgentUI at '{IO.Path.GetFullPath(uiPath)}'\n");
                if (!IO.File.Exists(uiPath)) IO.File.AppendAllText("debug.log", "ERROR: AgentUI not found!\n");

                var agentExe = new WixSharp.File(exePath);

                // Configure Windows Service
                agentExe.ServiceInstaller = new ServiceInstaller
                {
                    Name = "PankhaAgent",
                    DisplayName = Config.Product, // "Pankha Windows Agent" or similar (Service Name stays formal)
                    Description = "Monitors hardware sensors and controls fan speeds for the Pankha system",
                    StartOn = SvcEvent.Install,
                    StopOn = SvcEvent.InstallUninstall_Wait,
                    RemoveOn = SvcEvent.Uninstall_Wait,
                    Account = @"LocalSystem",
                    Interactive = false
                };

                // Helper for ShortName (Fallback to Product if missing)
                string shortName = !string.IsNullOrEmpty(Config.Filenames.ShortName) ? Config.Filenames.ShortName : Config.Product;

                // 4. Create the project
                // InstallDir: %ProgramFiles%\<Manufacturer>
                var project = new ManagedProject(Config.Product,
                    new Dir($@"%ProgramFiles%\{Config.Manufacturer}",
                        agentExe,
                        new WixSharp.File(uiPath),
                        
                        // Removed appsettings.json and config.example.json as they are not needed
                        new Dir("logs"),

                        // Installation folder shortcuts
                        // INSTALLDIR is the directory where the app is installed
                        new ExeFileShortcut($"Configure {shortName}", $"[INSTALLDIR]{Config.Filenames.AgentExe}", "--setup") { WorkingDirectory = "[INSTALLDIR]" },
                        new ExeFileShortcut($"View {shortName} Logs", $"[INSTALLDIR]{Config.Filenames.AgentExe}", "--logs follow") { WorkingDirectory = "[INSTALLDIR]" },
                        new ExeFileShortcut($"{shortName} Status", "[System64Folder]cmd.exe",
                            $"/K \"cd /d \"[INSTALLDIR]\" && {Config.Filenames.AgentExe} --status && pause\"") { WorkingDirectory = "[INSTALLDIR]" },
                        
                        // Uninstall shortcut
                        new ExeFileShortcut($"Uninstall {shortName}", "[SystemFolder]msiexec.exe", 
                            $"/i [ProductCode] /l*v \"[CommonAppDataFolder]{Config.Manufacturer}\\logs\\uninstall_full.log\"") { WorkingDirectory = "[INSTALLDIR]" }
                    ),

                    // Start Menu shortcuts
                    new Dir($@"%ProgramMenu%\{Config.Product}",
                        new ExeFileShortcut($"Pankha Tray", $"[INSTALLDIR]{Config.Filenames.AgentUI}", ""),
                        new ExeFileShortcut($"Configure {shortName}", $"[INSTALLDIR]{Config.Filenames.AgentExe}", "--setup"),
                        new ExeFileShortcut($"View {shortName} Logs", $"[INSTALLDIR]{Config.Filenames.AgentExe}", "--logs follow"),
                        new ExeFileShortcut($"{shortName} Status", "[System64Folder]cmd.exe",
                            $"/K \"cd /d \"[INSTALLDIR]\" && {Config.Filenames.AgentExe} --status && pause\""),
                        new ExeFileShortcut($"Uninstall {shortName}", "[SystemFolder]msiexec.exe", 
                            $"/i [ProductCode] /l*v \"[CommonAppDataFolder]{Config.Manufacturer}\\logs\\uninstall_full.log\"")
                    ),

                    // Auto-Start via Startup Folder (More robust than Registry Key)
                    new Dir("%Startup%",
                        new ExeFileShortcut("Pankha Tray", $"[INSTALLDIR]{Config.Filenames.AgentUI}", "")
                    )
                );

                // ... (Metadata) ...
                project.GUID = Guid.NewGuid();
                project.UpgradeCode = UpgradeCode;
                project.Version = new Version("1.0.15"); // Could also be read from config or AssemblyInfo
                project.Platform = Platform.x64;
                project.InstallScope = InstallScope.perMachine;
                
                // Icon
                // Icon
                string iconPath = IO.Path.Combine("..", Config.Paths.AppIcon_256);
                IO.File.AppendAllText("debug.log", $"DEBUG: Checking Icon at '{IO.Path.GetFullPath(iconPath)}'\n");
                if (!IO.File.Exists(iconPath)) IO.File.AppendAllText("debug.log", "ERROR: Icon not found!\n");

                project.ControlPanelInfo.Manufacturer = Config.Manufacturer;
                project.ControlPanelInfo.ProductIcon = iconPath;

                // Automatic upgrades
                project.MajorUpgrade = new MajorUpgrade
                {
                    Schedule = UpgradeSchedule.afterInstallInitialize,
                    DowngradeErrorMessage = "A newer version is already installed.",
                    AllowSameVersionUpgrades = true
                };

                // Setup ManagedUI
                project.ManagedUI = new ManagedUI();
                project.ManagedUI.Icon = IO.Path.Combine("..", Config.Paths.AppIcon_256);

                // Install dialogs
                project.ManagedUI.InstallDialogs.Add<WelcomeDialog>()
                                                 .Add<InstallDirDialog>()
                                                 .Add<ConfigurationDialog>() // Add our custom dialog
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
                    new Property("KEEP_CONFIG", "1") { Attributes = new Dictionary<string, string> { { "Secure", "yes" } } }, 
                    new Property("RESET_CONFIG", "0") { Attributes = new Dictionary<string, string> { { "Secure", "yes" } } },
                    new Property("KEEP_LOGS", "1") { Attributes = new Dictionary<string, string> { { "Secure", "yes" } } },
                    new Property("MSIRESTARTMANAGERCONTROL", "Disable"), // Prevent killing apps like procexp
                    new Property("MSIDISABLERMRESTART", "1") // Legacy disable for Restart Manager interaction
                };

                // Enable full UI for uninstall
                project.EnableUninstallFullUI();

                // Define Properties to carry config values to Runtime
                // Manufacturer and Product are already standard properties set via project.ControlPanelInfo
                project.Properties = new[] 
                {
                    new Property("AgentExe", Config.Filenames.AgentExe),
                    new Property("AgentUI", Config.Filenames.AgentUI)
                };

                // CRITICAL: Pass these properties to Deferred Actions
                // Note: Manufacturer and ProductName are standard properties available in Immediate sequence.
                // We pass them to Deferred here.
                // Note: WixSharp property "Product" might be "ProductName" in MSI? 
                // Let's check wxs. <Product Name="..."/> -> Property `ProductName`.
                // So we should pass `ProductName` instead of `Product`?
                // The wxs shows: <Property Id="Product" Value="Pankha Windows Agent" /> (Line 159) - This was my manual addition colliding.
                // The WXS Product Element has `Name="Pankha Windows Agent"`.
                // In MSI, the property is `ProductName`.
                
                // So my manual property `Product` was creating a valid property named `Product`, 
                // but if I remove it, does `Product` property exist? No. `ProductName` exists.
                
                // So getting `Product` in `OnAfterInstall` using `GetProperty("Product")` failed?
                // Or I should use `ProductName`.
                
                // Let's use standard `ProductName`.
                project.DefaultDeferredProperties += ",KEEP_CONFIG,RESET_CONFIG,KEEP_LOGS,INSTALLDIR,Manufacturer,ProductName,AgentExe,AgentUI,UPGRADINGPRODUCTCODE";

                // Event handlers
                project.BeforeInstall += OnBeforeInstall;
                project.AfterInstall += OnAfterInstall;
                project.UIInitialized += Project_UIInitialized;

                // Build Output
                // Config path is relative to PROJECT ROOT.
                // We are running in 'installer' folder.
                // So we need to prepend "..\" to get to Project Root.
                string outDir = IO.Path.Combine("..", Config.Paths.InstallerOutput.Replace("/", "\\"));
                
                // Attempt to make it relative to current execution (installer folder)
                if (outDir.StartsWith("installer\\"))
                {
                    outDir = outDir.Substring("installer\\".Length);
                }

                project.OutDir = outDir;
                project.OutFileName = Config.Filenames.InstallerMsi.Replace(".msi", ""); 

                Console.WriteLine("Building Pankha Agent MSI installer...");
                IO.File.AppendAllText("debug.log", "DEBUG: Calling project.BuildMsi()...\n");
                string msiPath = project.BuildMsi();
                IO.File.AppendAllText("debug.log", $"DEBUG: BuildMsi returned. Path: {msiPath}\n");
                Console.WriteLine($"\n✅ MSI built: {msiPath}");
            }
            catch (Exception ex)
            {
                IO.File.AppendAllText("debug.log", $"\n❌ FATAL ERROR: {ex}\n");
                Console.WriteLine($"\n❌ FATAL ERROR: {ex}");
                Environment.Exit(1);
            }

        }

        static void LoadConfiguration()
        {
            // Try to find build-config.json
            // We expect it to be one level up if running from 'installer' folder
            string configPath = IO.Path.GetFullPath(@"..\build-config.json");
            
            if (!IO.File.Exists(configPath))
            {
                // Fallback: Check current directory
                configPath = "build-config.json";
                if (!IO.File.Exists(configPath))
                {
                    throw new IO.FileNotFoundException("Could not find build-config.json at " + IO.Path.GetFullPath(@"..\build-config.json"));
                }
            }
            
            string json = IO.File.ReadAllText(configPath);
            Config = JsonConvert.DeserializeObject<BuildConfig>(json);
            
            if (Config == null) throw new Exception("Failed to deserialize build-config.json");
            Console.WriteLine($"Loaded configuration: Manufacturer='{Config.Manufacturer}', Product='{Config.Product}'");
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

        static string GetCommonAppLogDir(string manufacturer = null)
        {
            // Use defaults if not provided (runtime fallback) or Config fallback (build time)
            string mf = manufacturer ?? Config?.Manufacturer ?? "Pankha Fan Control";
            
            string commonData = Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData);
            return IO.Path.Combine(commonData, mf, "logs");
        }

        static void LogToDebugFile(string basePath, string logType, string message)
        {
             // Overridden behavior: Ignore 'basePath' if we are doing install/uninstall logs 
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
                // During Immediate execution, we can access Properties efficiently
                string manufacturer = e.Session["Manufacturer"];
                string logPath = GetCommonAppLogDir(manufacturer);

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
                string manufacturer = GetProperty("Manufacturer");
                string product = GetProperty("ProductName");
                string upgradingProductCode = GetProperty("UPGRADINGPRODUCTCODE");

                // LOGGING: Use Central Directory with Dynamic Manufacturer
                string logBaseDir = GetCommonAppLogDir(manufacturer);
                
                LogToDebugFile(logBaseDir, logType, "=== OnAfterInstall Triggered (Deferred) ===");
                LogToDebugFile(logBaseDir, logType, $"Context: IsUninstalling={isUninstalling}");
                LogToDebugFile(logBaseDir, logType, $"Target InstallDir (for Cleanup): '{installDirProp}'");
                LogToDebugFile(logBaseDir, logType, $"Manufacturer (Dynamic): '{manufacturer}'");
                LogToDebugFile(logBaseDir, logType, $"Upgrade Code Detected: '{upgradingProductCode}'");

                bool isUpgrade = !string.IsNullOrEmpty(upgradingProductCode);

                if (!isUninstalling)
                {
                     // LAUNCH TRAY APP
                     try
                     {
                         string agentUiName = GetProperty("AgentUI");
                         if (!string.IsNullOrEmpty(agentUiName) && !string.IsNullOrEmpty(installDirProp))
                         {
                             string uiPath = IO.Path.Combine(installDirProp, agentUiName);
                             if (IO.File.Exists(uiPath))
                             {
                                 LogToDebugFile(logBaseDir, logType, $"Launching Tray App: {uiPath}");
                                 Process.Start(new ProcessStartInfo
                                 {
                                     FileName = uiPath,
                                     UseShellExecute = true
                                 });
                             }
                             else
                             {
                                 LogToDebugFile(logBaseDir, logType, $"Tray App not found at {uiPath}");
                             }
                         }
                         else
                         {
                              LogToDebugFile(logBaseDir, logType, "Skipping launch: InstallDir or AgentUI property missing.");
                         }
                     }
                     catch (Exception ex)
                     {
                         LogToDebugFile(logBaseDir, logType, $"Failed to launch Tray App: {ex.Message}");
                     }
                }

                // ... (Cleanup Logic: Reset Config & Uninstall) ...

                // 2. Handle Uninstallation
                if (isUninstalling)
                {
                    try
                    {
                        var dir = installDirProp; 
                        
                        // Fallback using Dynamic Manufacturer
                        if (string.IsNullOrEmpty(dir) && !string.IsNullOrEmpty(manufacturer))
                        {
                             dir = IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), manufacturer);
                        }
                        // Ultimate safe fallback
                        if (string.IsNullOrEmpty(dir)) 
                        {
                            // This should rarely happen if Manufacturer is passed correctly
                             dir = IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Pankha Fan Control");
                        }
                        
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
                        
                        // Dynamically determine process name from configured Exe name passed via CustomActionData
                        // Dynamically determine process name from configured Exe name passed via CustomActionData
                        string agentExeName = GetProperty("AgentExe");
                        string agentUiName = GetProperty("AgentUI"); // Get UI name

                        string processName = !string.IsNullOrEmpty(agentExeName) 
                            ? IO.Path.GetFileNameWithoutExtension(agentExeName) 
                            : "pankha-agent-windows"; // Fallback

                        string uiProcessName = !string.IsNullOrEmpty(agentUiName)
                            ? IO.Path.GetFileNameWithoutExtension(agentUiName)
                            : "pankha-tray";

                        LogToDebugFile(logBaseDir, logType, $"Targeting Agent process: '{processName}'");
                        LogToDebugFile(logBaseDir, logType, $"Targeting UI process: '{uiProcessName}'");

                        // Kill UI first
                        foreach (var proc in Process.GetProcessesByName(uiProcessName))
                        {
                            try 
                            { 
                                proc.Kill(); 
                                proc.WaitForExit(5000);
                                LogToDebugFile(logBaseDir, logType, $"Killed UI process {proc.Id}");
                            } 
                            catch (Exception ex) { LogToDebugFile(logBaseDir, logType, $"Failed to kill UI process {proc.Id}: {ex.Message}"); }
                        }

                        // Kill Agent
                        foreach (var proc in Process.GetProcessesByName(processName))
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
                        if (isUpgrade && resetConfig != "1")
                        {
                            LogToDebugFile(logBaseDir, logType, "UPGRADE DETECTED & KEEP CONFIG (Default): Skipping deletion of Config, Logs, and Shortcuts.");
                            // We return early from cleanup
                            LogToDebugFile(logBaseDir, logType, "=== Cleanup Phase Complete (Upgrade Preserved) ===");
                            return; 
                        }

                        if (resetConfig == "1")
                        {
                             LogToDebugFile(logBaseDir, logType, "CLEAN INSTALL REQUESTED (ResetConfig=1). Forcing deletion of config/logs.");
                             // Force variables to false to ensure deletion logic runs
                             keepConfig = "0";
                             keepLogs = "0";
                        }

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
                            
                            // B. Logs folder
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
                        string shortcutProduct = !string.IsNullOrEmpty(product) ? product : "Pankha Windows Agent";
                        
                        var shortcuts = IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonPrograms), shortcutProduct);
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



    public class ConfigurationDialog : ManagedForm, IManagedDialog
    {
        private CheckBox resetConfigCheckBox;
        private Label descriptionLabel;
        private Panel bottomPanel;
        private Button backButton;
        private Button nextButton;
        private Button cancelButton;
        private Panel topBorder;
        private Panel bottomBorder; // We will use predefined panels if possible or create standard shell
        
        // Standard Banner components
        private PictureBox banner;
        private Label bannerTitle;
        private Label bannerDescription;

        public ConfigurationDialog()
        {
            // Basic Form Init
            this.ClientSize = new System.Drawing.Size(494, 312);
            this.Text = "Pankha Windows Agent Setup";
            
            InitializeComponent();
        }

        private void InitializeComponent()
        {
            // 1. Banner
            this.banner = new PictureBox();
            this.banner.Size = new System.Drawing.Size(494, 58);
            this.banner.Location = new System.Drawing.Point(0, 0);
            this.banner.BackColor = System.Drawing.Color.White;
            // banner.Image = ... (ManagedUI handles resources usually, or we skip image)
            
            this.bannerTitle = new Label();
            this.bannerTitle.Text = "Configuration Options";
            this.bannerTitle.Font = new System.Drawing.Font("Tahoma", 9F, System.Drawing.FontStyle.Bold);
            this.bannerTitle.Location = new System.Drawing.Point(15, 15);
            this.bannerTitle.AutoSize = true;
            this.bannerTitle.BackColor = System.Drawing.Color.White;

            this.bannerDescription = new Label();
            this.bannerDescription.Text = "Choose how to handle existing configuration.";
            this.bannerDescription.Location = new System.Drawing.Point(25, 35);
            this.bannerDescription.AutoSize = true;
            this.bannerDescription.BackColor = System.Drawing.Color.White;

            // Lines
            var line1 = new Panel { Location = new Point(0, 58), Size = new Size(494, 1), BackColor = SystemColors.ControlDark };
            var line2 = new Panel { Location = new Point(0, 268), Size = new Size(494, 1), BackColor = SystemColors.ControlDark };

            // 2. Content
            this.descriptionLabel = new Label();
            this.descriptionLabel.Text = "If you are upgrading or reinstalling, you can choose to keep your existing configuration logic and logs, or perform a clean install.";
            this.descriptionLabel.Location = new Point(25, 80);
            this.descriptionLabel.Size = new Size(440, 40);

            this.resetConfigCheckBox = new CheckBox();
            this.resetConfigCheckBox.Text = "Reset configuration (Clean Install)";
            this.resetConfigCheckBox.Location = new Point(25, 140);
            this.resetConfigCheckBox.Size = new Size(400, 20);
            this.resetConfigCheckBox.Font = new Font("Tahoma", 9F, FontStyle.Bold); // Emphasize
            
            var resetDesc = new Label();
            resetDesc.Text = "WARNING: If checked, your existing 'config.json' and 'logs' folder will be DELETED.\nSelect this if you want to start fresh.";
            resetDesc.Location = new Point(42, 165); // Indented under checkbox
            resetDesc.Size = new Size(400, 40);
            resetDesc.ForeColor = Color.DarkRed;

            // 3. Buttons (Bottom Panel)
            
            this.backButton = new Button { Text = "< Back", Location = new Point(224, 279), Size = new Size(75, 23) };
            this.nextButton = new Button { Text = "Next >", Location = new Point(304, 279), Size = new Size(75, 23) };
            this.cancelButton = new Button { Text = "Cancel", Location = new Point(404, 279), Size = new Size(75, 23) };

            this.backButton.Click += (s, e) => Shell.GoPrev();
            this.nextButton.Click += (s, e) => Shell.GoNext();
            this.cancelButton.Click += (s, e) => Shell.Cancel();

            // Add Controls
            this.Controls.Add(bannerTitle);
            this.Controls.Add(bannerDescription);
            this.Controls.Add(banner);
            this.Controls.Add(line1);
            
            this.Controls.Add(descriptionLabel);
            this.Controls.Add(resetConfigCheckBox);
            this.Controls.Add(resetDesc);
            
            this.Controls.Add(line2);
            this.Controls.Add(backButton);
            this.Controls.Add(nextButton);
            this.Controls.Add(cancelButton);

            this.Load += ConfigurationDialog_Load;
        }

        private void ConfigurationDialog_Load(object sender, EventArgs e)
        {
            // Bind Property
            string val = MsiRuntime.Session["RESET_CONFIG"];
            this.resetConfigCheckBox.Checked = (val == "1");

            // Save on change
            this.resetConfigCheckBox.CheckedChanged += (s, ev) => 
            {
                MsiRuntime.Session["RESET_CONFIG"] = this.resetConfigCheckBox.Checked ? "1" : "0";
            };
        }
    }


    public class ConditionalExitDialog : ExitDialog
    {
        protected override void OnLoad(EventArgs e)
        {
            if (Program.IsSelfElevating)
            {
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
