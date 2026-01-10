using System;
using System.Diagnostics;
using WixSharp;
using WixSharp.CommonTasks;
using WixSharp.UI.Forms;
using System.Windows.Forms;
using IO = System.IO;
using System.Security.Principal;
using Microsoft.Deployment.WindowsInstaller;
using Newtonsoft.Json;
using System.Collections.Generic;
using System.Linq;
using System.Drawing;
using System.Drawing.Imaging;

namespace Pankha.WixSharpInstaller
{
    // Configuration Classes
    public class BuildConfig
    {
        public string Manufacturer { get; set; }
        public string Product { get; set; }
        public BuildPaths Paths { get; set; }
        public BuildFilenames Filenames { get; set; }
        public BrandingConfig Branding { get; set; }
    }

    public class BrandingConfig
    {
        public string ColorPrimary { get; set; }
        public string ColorSecondary { get; set; }
        public string BannerFlag { get; set; }
        public int? BannerWidth { get; set; }
        public int? BannerHeight { get; set; }
        public int? BannerRightMargin { get; set; }
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
                // NOTE: LibreHardwareMonitor 0.9.4 extracts its kernel driver at runtime
                // The driver is embedded in LibreHardwareMonitorLib.dll and extracted automatically
                // No need to ship driver files (.sys) with the installer

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
                var agentVersion = System.Diagnostics.FileVersionInfo.GetVersionInfo(exePath).FileVersion;
                if (agentVersion == null) agentVersion = "1.0.0";
                
                project.Version = new Version(agentVersion);
                Console.WriteLine($"Building MSI version: {project.Version}");
                project.Platform = Platform.x64;
                project.InstallScope = InstallScope.perMachine;
                
                // Icon
                // Icon
                string iconPath = IO.Path.Combine("..", Config.Paths.AppIcon_256);
                IO.File.AppendAllText("debug.log", $"DEBUG: Checking Icon at '{IO.Path.GetFullPath(iconPath)}'\n");
                if (!IO.File.Exists(iconPath)) IO.File.AppendAllText("debug.log", "ERROR: Icon not found!\n");

                project.ControlPanelInfo.Manufacturer = Config.Manufacturer;
                project.ControlPanelInfo.ProductIcon = iconPath;

                // Register logo as a binary resource for custom dialogs to use (Plug & Play)
                project.AddBinary(new Binary(new Id("ProductLogo"), iconPath));

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
                
                // Branded Banners (Plug & Play)
                string bannerPath = CreateBrandedBanner(iconPath);
                if (bannerPath != null)
                {
                    project.BannerImage = bannerPath;
                }

                // Install dialogs
                project.ManagedUI.InstallDialogs.Add<WelcomeDialog>()
                                                 .Add<InstallDirDialog>()
                                                 .Add<ConfigurationDialog>()
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
                    new Property("MSIDISABLERMRESTART", "1"), // Legacy disable for Restart Manager interaction
                    new Property("AgentExe", Config.Filenames.AgentExe),
                    new Property("AgentUI", Config.Filenames.AgentUI)
                };

                // Enable full UI for uninstall
                project.EnableUninstallFullUI();

                // CRITICAL: Pass these properties to Deferred Actions
                // Note: Standard MSI properties like Manufacturer and ProductName must be explicitly included for Deferred actions.
                project.DefaultDeferredProperties += ",KEEP_CONFIG,RESET_CONFIG,KEEP_LOGS,INSTALLDIR,Manufacturer,ProductName,AgentExe,AgentUI,UPGRADINGPRODUCTCODE";

                // Event handlers
                project.BeforeInstall += OnBeforeInstall;
                project.AfterInstall += project_AfterInstall;
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

                // Start fresh: Delete existing log to overwrite instead of append
                try
                {
                    // Ensure directory exists first, otherwise GetFiles/Delete might fail or path logic might be weird
                    if (IO.Directory.Exists(logPath))
                    {
                        string file = IO.Path.Combine(logPath, $"{logType}.log");
                        if (IO.File.Exists(file)) 
                        {
                            IO.File.Delete(file);
                        }
                    }
                }
                catch 
                { 
                    // Best effort: if file is locked or access denied, we just continue appending/ignoring
                }

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

        static void project_AfterInstall(SetupEventArgs e)
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

                     // Configure Service Failure Recovery (SCM)
                     // Restart on failure: 5s → 10s → 15s, reset after 1 day
                     try
                     {
                         LogToDebugFile(logBaseDir, logType, "Configuring service failure recovery...");
                         var scProcess = Process.Start(new ProcessStartInfo
                         {
                             FileName = "sc.exe",
                             // reset= 86400 (1 day in seconds)
                             // actions= restart/5000/restart/10000/restart/15000 (ms)
                             Arguments = "failure PankhaAgent reset= 86400 actions= restart/5000/restart/10000/restart/15000",
                             UseShellExecute = false,
                             CreateNoWindow = true
                         });
                         scProcess?.WaitForExit(5000);
                         LogToDebugFile(logBaseDir, logType, $"Service recovery configured. Exit code: {scProcess?.ExitCode}");
                     }
                     catch (Exception ex)
                     {
                         LogToDebugFile(logBaseDir, logType, $"Failed to configure service recovery: {ex.Message}");
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

                        // Unload and clean up runtime-extracted driver
                        // LibreHardwareMonitor 0.9.4 extracts driver at runtime as {processname}.sys
                        LogToDebugFile(logBaseDir, logType, "Phase: Unloading Runtime Driver...");
                        try
                        {
                            // Derive driver service and file name from AgentExe property
                            // Example: pankha-agent.exe -> service: pankha-agent, file: pankha-agent.sys

                            string driverServiceName = !string.IsNullOrEmpty(agentExeName)
                                ? agentExeName.Replace(".exe", "")
                                : "pankha-agent"; // Fallback

                            string driverFileName = driverServiceName + ".sys";

                            // Stop and delete driver service
                            Process.Start(new ProcessStartInfo { FileName = "sc", Arguments = $"stop {driverServiceName}", UseShellExecute = false, CreateNoWindow = true })?.WaitForExit(5000);
                            System.Threading.Thread.Sleep(1000);
                            Process.Start(new ProcessStartInfo { FileName = "sc", Arguments = $"delete {driverServiceName}", UseShellExecute = false, CreateNoWindow = true })?.WaitForExit(5000);
                            LogToDebugFile(logBaseDir, logType, $"Driver stop/delete executed for service: {driverServiceName}");
                        }
                        catch (Exception ex) { LogToDebugFile(logBaseDir, logType, $"Driver unload error: {ex.Message}"); }

                        System.Threading.Thread.Sleep(1000);

                        // Delete runtime-extracted driver file
                        try
                        {
                            if (!string.IsNullOrEmpty(dir))
                            {
                                string driverFileName = !string.IsNullOrEmpty(agentExeName)
                                    ? agentExeName.Replace(".exe", ".sys")
                                    : "pankha-agent.sys"; // Fallback

                                var driverFile = IO.Path.Combine(dir, driverFileName);
                                if (IO.File.Exists(driverFile))
                                {
                                    IO.File.Delete(driverFile);
                                    LogToDebugFile(logBaseDir, logType, $"Deleted runtime driver: {driverFile}");
                                }
                                else
                                {
                                    LogToDebugFile(logBaseDir, logType, $"Runtime driver not found: {driverFile}");
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

        private static string CreateBrandedBanner(string iconPath)
        {
            try
            {
                Image logo = null;
                bool isIcon = IO.Path.GetExtension(iconPath).ToLower() == ".ico";

                if (isIcon)
                {
                    using (var icon = new Icon(iconPath, 256, 256))
                        logo = icon.ToBitmap();
                }
                else
                {
                    logo = Image.FromFile(iconPath);
                }

                using (logo)
                using (var banner = new Bitmap(493, 58))
                using (var g = Graphics.FromImage(banner))
                {
                    g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
                    g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;

                    // Base background
                    g.Clear(Color.White);

                    // Vertical Accent Frame Dimensions
                    int frameWidth = Config?.Branding?.BannerWidth ?? 72; 
                    int frameHeight = Config?.Branding?.BannerHeight ?? 58; 
                    int rightMargin = Config?.Branding?.BannerRightMargin ?? 16;
                    var frameRect = new Rectangle(493 - frameWidth - rightMargin, 0, frameWidth, frameHeight);
                    
                    // Colors
                    Color primary = Color.FromArgb(45, 65, 90);
                    Color secondary = Color.FromArgb(30, 45, 65);
                    try 
                    {
                        if (!string.IsNullOrEmpty(Config?.Branding?.ColorPrimary))
                            primary = ColorTranslator.FromHtml(Config.Branding.ColorPrimary);
                        if (!string.IsNullOrEmpty(Config?.Branding?.ColorSecondary))
                            secondary = ColorTranslator.FromHtml(Config.Branding.ColorSecondary);
                    } catch { }

                    // Custom Flag Background
                    bool bgDrawn = false;
                    string flagPath = Config?.Branding?.BannerFlag;
                    if (!string.IsNullOrEmpty(flagPath))
                    {
                        try 
                        {
                            string fullPath = flagPath;
                            if (!IO.Path.IsPathRooted(fullPath))
                                fullPath = IO.Path.Combine(IO.Path.GetDirectoryName(iconPath), "..", "..", flagPath);
                            
                            if (IO.File.Exists(fullPath))
                            {
                                using (var bgImg = Image.FromFile(fullPath))
                                {
                                    g.DrawImage(bgImg, frameRect);
                                    bgDrawn = true;
                                }
                            }
                        } catch { }
                    }

                    if (!bgDrawn)
                    {
                        // Procedural ribbon fill
                        using (var brush = new System.Drawing.Drawing2D.LinearGradientBrush(frameRect, primary, secondary, 0f))
                        {
                            var blend = new System.Drawing.Drawing2D.ColorBlend();
                            blend.Colors = new[] { secondary, primary, secondary };
                            blend.Positions = new[] { 0.0f, 0.5f, 1.0f };
                            brush.InterpolationColors = blend;
                            g.FillRectangle(brush, frameRect);
                        }
                    }

                    // Logo Centering
                    int logoSize = 44;
                    int logoX = frameRect.X + (frameRect.Width - logoSize) / 2;
                    int logoY = (frameRect.Height - logoSize) / 2;

                    // Shadow
                    for (int i = 1; i <= 6; i++)
                    {
                        using (var b = new SolidBrush(Color.FromArgb(25 / i, Color.Black)))
                            g.FillEllipse(b, logoX - i, logoY - i + 1, logoSize + (i * 2), logoSize + (i * 2));
                    }

                    // Render Logo
                    g.DrawImage(logo, logoX, logoY, logoSize, logoSize);
                    
                    string tempPath = IO.Path.Combine(IO.Path.GetTempPath(), "pankha_banner.bmp");
                    banner.Save(tempPath, ImageFormat.Bmp);
                    return tempPath;
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine("Warning: Could not create branded banner: " + ex.Message);
                return null;
            }
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
