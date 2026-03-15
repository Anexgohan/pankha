//! Interactive setup wizard for first-run configuration.

use std::io::{self, Write};
use std::path::{Path, PathBuf};
use anyhow::Result;
use uuid::Uuid;

use crate::config::types::*;
use crate::config::persistence::{load_config, save_config};
use crate::hardware::HardwareMonitor;
use crate::hardware::IpmiHardwareMonitor;

#[cfg(target_os = "linux")]
use crate::daemon::systemd::{has_systemd, install_systemd_service};
#[cfg(target_os = "linux")]
use crate::daemon::pid::is_running;
#[cfg(target_os = "linux")]
use crate::daemon::control::start_daemon_with_log_level;
#[cfg(target_os = "linux")]
use crate::daemon::SYSTEMD_SERVICE_PATH;

pub async fn run_setup_wizard(config_path: Option<&str>) -> Result<()> {
    let config_file = if let Some(p) = config_path {
        PathBuf::from(p)
    } else {
        std::env::current_exe()?
            .parent()
            .ok_or_else(|| anyhow::anyhow!("Cannot determine executable directory"))?
            .join("config.json")
    };

    println!("\n╔══════════════════════════════════════════╗");
    println!("║    Pankha IPMI Host Agent Setup Wizard   ║");
    println!("╚══════════════════════════════════════════╝");
    println!("Build: \x1b[32mpankha-agent v{} ({})\x1b[0m\n", env!("CARGO_PKG_VERSION"), std::env::consts::ARCH);

    // Load existing config if present
    let existing_config = if config_file.exists() {
        println!("⚠️  Config file already exists: {:?}", config_file);
        print!("Overwrite? (y/N): ");
        io::stdout().flush()?;
        let mut response = String::new();
        io::stdin().read_line(&mut response)?;
        if !response.trim().eq_ignore_ascii_case("y") {
            // User declined to overwrite config - check if autostart is needed
            #[cfg(target_os = "linux")]
            {
                let needs_autostart = has_systemd() && !Path::new(SYSTEMD_SERVICE_PATH).exists();
                if needs_autostart {
                    println!("\nAuto-start service not installed");
                    print!("   Install systemd service to start agent on boot? [Y/n]: ");
                    io::stdout().flush()?;
                    let mut autostart_input = String::new();
                    io::stdin().read_line(&mut autostart_input)?;

                    if !autostart_input.trim().eq_ignore_ascii_case("n") {
                        if unsafe { libc::geteuid() } == 0 {
                            match install_systemd_service() {
                                Ok(_) => {}
                                Err(e) => {
                                    println!("   ⚠ Could not install service: {}", e);
                                    println!("   You can retry later with: sudo ./pankha-agent --install-service");
                                }
                            }
                        } else {
                            println!("   ⚠ Root privileges required to install service.");
                            println!("   Run later with: sudo ./pankha-agent --install-service");
                        }
                    }
                    println!();
                }
            }
            println!("Config unchanged.");
            return Ok(());
        }
        // Load existing config to use as defaults
        load_config(config_file.to_str()).await.ok()
    } else {
        None
    };

    let hostname = hostname::get()
        .unwrap_or_else(|_| std::ffi::OsString::from("unknown"))
        .to_string_lossy()
        .to_string();

    println!("\n📋 Configuration:\n");
    println!("Values in [brackets] are defaults - press Enter to use them.\n");

    // Agent ID - Generate silently (don't ask user)
    let agent_id = if let Some(existing) = &existing_config {
        // Keep existing ID
        existing.agent.id.clone()
    } else {
        // Generate new ID: OS-hostname-UUID (short UUID: first 8 chars)
        let os_name = std::env::consts::OS;
        let unique_id = Uuid::new_v4();
        let short_uuid = &unique_id.to_string()[..8];
        format!("{}-{}-{}", os_name, hostname, short_uuid)
    };

    // Agent Name - Just use hostname
    let default_name = if let Some(existing) = &existing_config {
        existing.agent.name.clone()
    } else {
        hostname.clone()
    };
    print!("Agent Name [{}]: ", default_name);
    io::stdout().flush()?;
    let mut agent_name = String::new();
    io::stdin().read_line(&mut agent_name)?;
    let agent_name = agent_name.trim();
    let agent_name = if agent_name.is_empty() { default_name.clone() } else { agent_name.to_string() };

    // Server URL
    let default_url = if let Some(ref existing) = existing_config {
        existing.backend.server_url.clone()
    } else {
        "ws://[YOUR_HUB_IP]:3143/websocket".to_string()
    };
    print!("Backend Server URL [{}]: ", default_url);
    io::stdout().flush()?;
    let mut server_url = String::new();
    io::stdin().read_line(&mut server_url)?;
    let server_url = server_url.trim();
    let server_url = if server_url.is_empty() { default_url } else { server_url.to_string() };

    // Update Interval - 3.0 for new, existing value for re-run
    let default_interval = if let Some(ref existing) = existing_config {
        existing.agent.update_interval
    } else {
        3.0
    };
    print!("Update Interval (seconds) [{}]: ", default_interval);
    io::stdout().flush()?;
    let mut interval_str = String::new();
    io::stdin().read_line(&mut interval_str)?;
    let update_interval = if interval_str.trim().is_empty() {
        default_interval
    } else {
        interval_str.trim().parse::<f64>().unwrap_or(default_interval)
    };

    // Fan Control - default Y
    print!("Enable Fan Control? (Y/n): ");
    io::stdout().flush()?;
    let mut fan_control_str = String::new();
    io::stdin().read_line(&mut fan_control_str)?;
    let enable_fan_control = !fan_control_str.trim().eq_ignore_ascii_case("n");

    // Failsafe Speed - default 70%
    let default_failsafe = if let Some(ref existing) = existing_config {
        existing.hardware.failsafe_speed
    } else {
        70
    };
    print!("Failsafe speed when backend disconnected (0-100%, default {}): ", default_failsafe);
    io::stdout().flush()?;
    let mut failsafe_str = String::new();
    io::stdin().read_line(&mut failsafe_str)?;
    let failsafe_speed = if failsafe_str.trim().is_empty() {
        default_failsafe
    } else {
        failsafe_str.trim().parse::<u8>().unwrap_or(default_failsafe).min(100)
    };

    // Create config
    let config = AgentConfig {
        agent: AgentSettings {
            id: agent_id,
            name: agent_name,
            update_interval,
            log_level: "INFO".to_string(),
        },
        backend: BackendSettings {
            server_url,
            reconnect_interval: 5.0,
            max_reconnect_attempts: -1,
            connection_timeout: 10.0,
        },
        hardware: HardwareSettings {
            enable_fan_control,
            enable_sensor_monitoring: true,
            fan_step_percent: 5,
            hysteresis_temp: 3.0,
            emergency_temp: 85.0,
            failsafe_speed,
        },
        logging: LoggingSettings {
            enable_file_logging: true,
            log_file: "/var/log/pankha-agent/agent.log".to_string(),
            max_log_size_mb: 10,
            log_retention_days: 7,
        },
    };

    save_config(&config, config_file.to_str().unwrap()).await?;
    println!("\n✅ Configuration saved to: {:?}", config_file);

    // Test hardware discovery
    print!("\n🔍 Test IPMI connectivity now? (Y/n): ");
    io::stdout().flush()?;
    let mut test_str = String::new();
    io::stdin().read_line(&mut test_str)?;
    if !test_str.trim().eq_ignore_ascii_case("n") {
        println!("\nTesting IPMI connectivity...\n");

        let hardware_monitor = IpmiHardwareMonitor::new(config.hardware.clone());

        let sensors = hardware_monitor.discover_sensors().await?;
        let fans = hardware_monitor.discover_fans().await?;

        println!("✅ Discovered {} sensors and {} fans", sensors.len(), fans.len());

        if !sensors.is_empty() {
            println!("\n📊 Sensors:");
            for sensor in sensors.iter().take(5) {
                println!("  • {} - {:.1}°C", sensor.name, sensor.temperature);
            }
            if sensors.len() > 5 {
                println!("  ... and {} more", sensors.len() - 5);
            }
        }

        if !fans.is_empty() {
            println!("\n🌀 Fans:");
            for fan in fans.iter().take(5) {
                println!("  • {} - {} RPM", fan.name, fan.rpm.unwrap_or(0));
            }
            if fans.len() > 5 {
                println!("  ... and {} more", fans.len() - 5);
            }
        }
    }

    // Autostart prompt (show if systemd available and service not installed)
    #[cfg(target_os = "linux")]
    if has_systemd() && !Path::new(SYSTEMD_SERVICE_PATH).exists() {
        println!("\nAuto-start service not installed");
        print!("   Install systemd service to start agent on boot? [Y/n]: ");
        io::stdout().flush()?;
        let mut autostart_input = String::new();
        io::stdin().read_line(&mut autostart_input)?;

        if !autostart_input.trim().eq_ignore_ascii_case("n") {
            // Check if running as root
            if unsafe { libc::geteuid() } == 0 {
                match install_systemd_service() {
                    Ok(_) => {}
                    Err(e) => {
                        println!("   ⚠ Could not install service: {}", e);
                        println!("   You can retry later with: sudo ./pankha-agent --install-service");
                    }
                }
            } else {
                println!("   ⚠ Root privileges required to install service.");
                println!("   Run later with: sudo ./pankha-agent --install-service");
            }
        }
    }

    println!("\n✨ Setup complete!");

    // Ask if user wants to start the agent now
    #[cfg(target_os = "linux")]
    if !is_running() {
        print!("\n   Start the agent now? [Y/n]: ");
        io::stdout().flush()?;
        let mut start_input = String::new();
        io::stdin().read_line(&mut start_input)?;

        if !start_input.trim().eq_ignore_ascii_case("n") {
            match start_daemon_with_log_level(None) {
                Ok(_) => {}
                Err(e) => {
                    println!("   ⚠ Could not start agent: {}", e);
                }
            }
        } else {
            if has_systemd() && Path::new(SYSTEMD_SERVICE_PATH).exists() {
                println!("\n   Start later with: sudo systemctl start pankha-agent");
            } else {
                println!("\n   Start later with: ./pankha-agent --start");
            }
        }
    } else {
        println!("   Agent is already running.");
    }

    // Note: IPMI agent is Linux-only, but keep the non-linux guard for compilation
    #[cfg(not(target_os = "linux"))]
    {
        println!("\n   Start the agent with: ./pankha-agent --start");
    }

    Ok(())
}
