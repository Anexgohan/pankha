//! Pankha agent entry point: CLI dispatch, signal handlers, async runtime.

mod app;
mod config;
mod daemon;
mod hardware;
mod websocket;

use anyhow::Result;
use clap::{CommandFactory, Parser};
use std::path::PathBuf;
use std::sync::Arc;
use tracing::{debug, error, info, warn};
use tracing_subscriber::EnvFilter;

use app::cli::{Args, HELP_TEXT};
use app::logging::{init_tracing, RELOAD_HANDLE};
use config::persistence::load_config;
use config::setup::run_setup_wizard;
use daemon::pid::{ensure_directories, get_pid, remove_pid_file, save_pid};
use daemon::control::{start_daemon_with_log_level, stop_daemon, restart_daemon_with_log_level, set_log_level_runtime};
use daemon::status::{show_status, run_health_check};
use hardware::HardwareMonitor;
use websocket::client::WebSocketClient;

#[cfg(target_os = "linux")]
use hardware::LinuxHardwareMonitor;
#[cfg(target_os = "windows")]
use hardware::WindowsHardwareMonitor;
#[cfg(target_os = "macos")]
use hardware::MacOSHardwareMonitor;

#[cfg(target_os = "linux")]
use daemon::systemd::{install_systemd_service, uninstall_systemd_service};

use daemon::LOG_DIR;

#[tokio::main]
async fn main() -> Result<()> {
    // Parse arguments with custom error handling
    let args = match Args::try_parse() {
        Ok(args) => args,
        Err(err) => {
            // Check if this is a help request
            if err.kind() == clap::error::ErrorKind::DisplayHelp {
                print!("{}", HELP_TEXT);
                std::process::exit(0);
            }
            // Custom version output with architecture (green)
            if err.kind() == clap::error::ErrorKind::DisplayVersion {
                println!("\x1b[32mpankha-agent {} ({})\x1b[0m", env!("CARGO_PKG_VERSION"), std::env::consts::ARCH);
                std::process::exit(0);
            }

            // For other errors, print the error
            eprintln!("{}", err);
            eprintln!();

            // Then print full help for clarity
            print!("{}", HELP_TEXT);
            eprintln!();
            eprintln!("\nFor more information, try '--help'.");

            std::process::exit(1);
        }
    };

    // Handle management commands first (before async setup)
    if args.start {
        return start_daemon_with_log_level(args.log_level);  // Spawns new process and exits
    }

    if args.stop {
        return stop_daemon();
    }

    if args.restart {
        return restart_daemon_with_log_level(args.log_level);
    }

    if args.status {
        return show_status().await;
    }

    if args.check {
        return run_health_check();
    }

    // Systemd service management (Linux only)
    #[cfg(target_os = "linux")]
    if args.install_service {
        return install_systemd_service();
    }

    #[cfg(target_os = "linux")]
    if args.uninstall_service {
        return uninstall_systemd_service();
    }

    if let Some(lines) = args.log_show {
        // Show agent logs
        let log_path = format!("{}/agent.log", LOG_DIR);

        let mut cmd = std::process::Command::new("tail");

        match lines {
            Some(n) => {
                // Show last N lines: tail -n <lines>
                println!("Showing last {} log entries...", n);
                println!("\x1b[32mpankha-agent v{} ({})\x1b[0m\n", env!("CARGO_PKG_VERSION"), std::env::consts::ARCH);
                cmd.arg("-n").arg(n.to_string());
            }
            None => {
                // Follow logs: tail -f
                println!("Showing live agent logs (Ctrl+C to exit)...");
                println!("\x1b[32mpankha-agent v{} ({})\x1b[0m\n", env!("CARGO_PKG_VERSION"), std::env::consts::ARCH);
                cmd.arg("-f");
            }
        }

        cmd.arg(&log_path);
        let status = cmd.status()?;
        std::process::exit(status.code().unwrap_or(1));
    }

    // If user provided --log-level without other commands, set it for running agent
    if let Some(level) = args.log_level.as_ref() {
        if !args.daemon_child && !args.test && !args.config && !args.setup {
            // Set log level for running agent
            return set_log_level_runtime(level);
        }
    }

    // If no command was provided at all (user just ran the binary), show help
    if !args.daemon_child && !args.test && !args.config && !args.setup {
        eprintln!("ERROR: No command specified. You must specify a command.");
        eprintln!();
        Args::command().print_help().unwrap();
        eprintln!();
        eprintln!("Common commands:");
        eprintln!("  ./pankha-agent --start       Start the agent");
        eprintln!("  ./pankha-agent --stop        Stop the agent");
        eprintln!("  ./pankha-agent -i            Show status");
        eprintln!("  ./pankha-agent -l            View logs");
        std::process::exit(1);
    }

    // Setup logging (daemon child or foreground mode)
    // Priority: 1. --log-level flag, 2. LOG_LEVEL env, 3. config file, 4. default (info)
    let log_level = if let Some(level) = args.log_level.as_ref() {
        level.to_lowercase()
    } else if let Ok(env_level) = std::env::var("LOG_LEVEL") {
        env_level.to_lowercase()
    } else {
        // Will be set from config after loading, default to info for now
        "info".to_string()
    };

    // Note: Rust tracing uses ERROR, WARN, INFO, DEBUG, TRACE
    // CRITICAL is handled as ERROR level with critical context
    let filter = match log_level.as_str() {
        "critical" => "error",  // CRITICAL maps to ERROR level (most severe)
        "trace" => "trace",
        "debug" => "debug",
        "info" => "info",
        "warn" => "warn",
        "error" => "error",
        _ => {
            eprintln!("Invalid log level '{}'. Using INFO. Valid levels: TRACE, DEBUG, INFO, WARN, ERROR, CRITICAL", log_level);
            "info"
        }
    };

    // Initialize tracing subscriber with reload capability
    init_tracing(filter);

    // If we're a daemon child, save our PID and check for failed update
    if args.daemon_child {
        ensure_directories()?;
        save_pid(std::process::id())?;

        // Check for failed update and rollback if needed
        #[cfg(target_os = "linux")]
        {
            if let Ok(current_exe) = std::env::current_exe() {
                if let Some(exe_dir) = current_exe.parent() {
                    let update_marker = exe_dir.join(".update_pending");
                    let old_binary = current_exe.with_extension("old");

                    if update_marker.exists() && old_binary.exists() {
                        // Read marker content to see if we've already tried booting this binary
                        let marker_content = std::fs::read_to_string(&update_marker).unwrap_or_default();

                        if !marker_content.contains("booted=true") {
                            // This is the FIRST boot of the new binary.
                            // We mark it as booted and continue normally.
                            // If we crash and restart, the next boot will find "booted=true" and rollback.
                            let _ = std::fs::write(&update_marker, format!("{}\nbooted=true", marker_content));
                            debug!("🚀 First boot of new version. Proceeding to verification...");
                        } else {
                            // This is at least the SECOND boot attempts - we likely crashed or failed to register.
                            // We have both marker and .old - this means we crashed after update
                            eprintln!("⚠️ Detected failed update (booted once and restarted). Attempting rollback...");

                            // Rollback: swap .old back to current
                            match std::fs::rename(&old_binary, &current_exe) {
                                Ok(_) => {
                                    eprintln!("✅ Rollback successful. Restarting with previous version...");
                                    let _ = std::fs::remove_file(&update_marker);

                                    // Re-exec into restored binary
                                    use std::os::unix::process::CommandExt;
                                    let mut cmd = std::process::Command::new(&current_exe);
                                    cmd.arg("--daemon-child");
                                    if let Some(level) = args.log_level.as_ref() {
                                        cmd.arg("--log-level").arg(level);
                                    }
                                    let _ = cmd.exec();
                                    // If exec failed, exit and let systemd restart us
                                    std::process::exit(1);
                                }
                                Err(e) => {
                                    eprintln!("❌ Rollback failed: {}. Continuing with current binary...", e);
                                    // Clean up marker to prevent rollback loop
                                    let _ = std::fs::remove_file(&update_marker);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // Show config if requested
    if args.config {
        let config = load_config(None).await?;
        println!("\n{}", serde_json::to_string_pretty(&config)?);
        return Ok(());
    }

    // Run setup wizard if requested
    if args.setup {
        run_setup_wizard(None).await?;
        return Ok(());
    }

    // Log startup message (only for normal operation, not setup/config commands)
    info!("Pankha Agent v{} starting ({})", env!("CARGO_PKG_VERSION"), std::env::consts::OS);

    // Check if config file exists (required for normal operation)
    let config_file_path = std::env::current_exe()?
        .parent()
        .ok_or_else(|| anyhow::anyhow!("Cannot determine executable directory"))?
        .join("config.json");

    if !config_file_path.exists() {
        eprintln!("ERROR: Configuration file not found: {:?}", config_file_path);
        eprintln!("\nPlease run the setup wizard first:");
        eprintln!("  ./pankha-agent --setup");
        eprintln!("  or");
        eprintln!("  ./pankha-agent -e");
        std::process::exit(1);
    }

    // Load configuration
    let config = load_config(None).await?;

    // Create platform-specific hardware monitor
    #[cfg(target_os = "linux")]
    let hardware_monitor: Arc<dyn HardwareMonitor> = Arc::new(LinuxHardwareMonitor::new(config.hardware.clone()));

    #[cfg(target_os = "windows")]
    let hardware_monitor: Arc<dyn HardwareMonitor> = Arc::new(WindowsHardwareMonitor::new(config.hardware.clone()));

    #[cfg(target_os = "macos")]
    let hardware_monitor: Arc<dyn HardwareMonitor> = Arc::new(MacOSHardwareMonitor::new(config.hardware.clone()));

    // Generate hardware-info.json diagnostic dump on startup (matches Windows agent behavior)
    #[cfg(target_os = "linux")]
    {
        let linux_monitor = LinuxHardwareMonitor::new(config.hardware.clone());
        match linux_monitor.dump_hardware_info().await {
            Ok(dump) => {
                let dump_path = std::env::current_exe()
                    .ok()
                    .and_then(|p| p.parent().map(|d| d.join("hardware-info.json")))
                    .unwrap_or_else(|| PathBuf::from("hardware-info.json"));

                match serde_json::to_string_pretty(&dump) {
                    Ok(json) => {
                        if let Err(e) = std::fs::write(&dump_path, json) {
                            warn!("Failed to write hardware-info.json: {}", e);
                        } else {
                            info!("Saved hardware dump to {:?}", dump_path);
                        }
                    }
                    Err(e) => warn!("Failed to serialize hardware dump: {}", e),
                }
            }
            Err(e) => warn!("Failed to generate hardware dump: {}", e),
        }
    }

    // Test mode
    if args.test {
        info!("Running in test mode");
        let sensors = hardware_monitor.discover_sensors().await?;
        let fans = hardware_monitor.discover_fans().await?;
        info!("Discovered {} sensors and {} fans", sensors.len(), fans.len());
        return Ok(());
    }

    // Create and run WebSocket client
    let client = WebSocketClient::new(config, hardware_monitor);
    let client = Arc::new(client);

    // Setup SIGHUP handler for log level reload
    #[cfg(target_os = "linux")]
    if args.daemon_child {
        use tokio::signal::unix::{signal, SignalKind};
        let mut sighup = signal(SignalKind::hangup()).expect("Failed to setup SIGHUP handler");

        tokio::spawn(async move {
            loop {
                sighup.recv().await;
                info!("SIGHUP received, reloading log level configuration");

                // Reload config from file
                match load_config(None).await {
                    Ok(new_config) => {
                        let new_level = new_config.agent.log_level.to_lowercase();
                        let filter = match new_level.as_str() {
                            "critical" => "error",
                            "trace" => "trace",
                            "debug" => "debug",
                            "info" => "info",
                            "warn" => "warn",
                            "error" => "error",
                            _ => "info",
                        };

                        // Reload the tracing filter
                        if let Some(handle) = RELOAD_HANDLE.get() {
                            match handle.reload(EnvFilter::new(filter)) {
                                Ok(_) => info!("Log level reloaded: {}", new_level.to_uppercase()),
                                Err(e) => error!("Failed to reload log level: {}", e),
                            }
                        }
                    }
                    Err(e) => error!("Failed to reload config: {}", e),
                }
            }
        });
    }

    // Setup signal handler with proper cancellation
    let client_clone = Arc::clone(&client);
    let shutdown_signal = tokio::spawn(async move {
        tokio::signal::ctrl_c().await.ok();
        info!("Shutdown signal received (Ctrl+C)");
        client_clone.stop().await;
    });

    // Run client with timeout/select to check for shutdown
    tokio::select! {
        result = client.run() => {
            if let Err(e) = result {
                error!("Client error: {}", e);
            }
        }
        _ = shutdown_signal => {
            info!("Shutdown signal handled");
        }
    }

    // Clean up PID file after shutdown
    if let Ok(Some(pid)) = get_pid() {
        if pid == std::process::id() {
            let _ = remove_pid_file();
            info!("PID file cleaned up");
        }
    }

    info!("Agent shutdown complete");
    Ok(())
}
