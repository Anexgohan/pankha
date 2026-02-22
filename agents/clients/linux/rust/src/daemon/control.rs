use std::process;
use std::fs;
use anyhow::Result;

use crate::daemon::pid::*;
use crate::daemon::systemd::is_systemd_service_active;
use crate::daemon::LOG_DIR;
use crate::config::types::AgentConfig;

pub fn start_daemon_with_log_level(log_level: Option<String>) -> Result<()> {
    if is_running() {
        eprintln!("ERROR: Agent is already running (PID: {:?})", get_pid()?);
        process::exit(1);
    }

    // Check if config file exists
    let exe_path = std::env::current_exe()?;
    let config_path = exe_path
        .parent()
        .ok_or_else(|| anyhow::anyhow!("Cannot determine executable directory"))?
        .join("config.json");

    if !config_path.exists() {
        eprintln!("ERROR: Configuration file not found: {:?}", config_path);
        eprintln!("\nPlease run the setup wizard first:");
        eprintln!("  ./pankha-agent --setup");
        eprintln!("  or");
        eprintln!("  ./pankha-agent -e");
        process::exit(1);
    }

    println!("\x1b[32mStarting pankha-agent v{} ({})\x1b[0m", env!("CARGO_PKG_VERSION"), std::env::consts::ARCH);

    // Prepare log file
    ensure_directories()?;
    let log_path = format!("{}/agent.log", LOG_DIR);
    let log_file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)?;

    // Spawn new process in daemon mode using --daemon-child (internal flag)
    let mut cmd = process::Command::new(&exe_path);
    cmd.arg("--daemon-child");

    // Pass log level to daemon child if specified
    if let Some(level) = log_level {
        cmd.arg("--log-level").arg(level);
    }

    let child = cmd
        .current_dir(std::env::current_dir()?)
        .stdin(process::Stdio::null())
        .stdout(log_file.try_clone()?)
        .stderr(log_file)
        .spawn()?;

    let pid = child.id();

    // Save PID
    save_pid(pid)?;

    println!("Agent started successfully (PID: {})", pid);
    println!("Logs: tail -f {}/agent.log", LOG_DIR);

    Ok(())
}

pub fn stop_daemon() -> Result<()> {
    // Check if systemd service is actively managing the process
    // If so, delegate to systemctl to prevent auto-restart from Restart=on-failure
    if is_systemd_service_active() {
        println!("Agent is managed by systemd. Using systemctl stop...");
        let status = process::Command::new("systemctl")
            .args(["stop", "pankha-agent"])
            .status();

        match status {
            Ok(s) if s.success() => {
                println!("Agent stopped via systemd");
                return Ok(());
            }
            Ok(_) => {
                eprintln!("WARNING: systemctl stop failed, falling back to manual stop");
            }
            Err(e) => {
                eprintln!("WARNING: Could not run systemctl: {}, falling back to manual stop", e);
            }
        }
    }

    // Manual stop (for non-systemd systems or systemctl fallback)
    if !is_running() {
        eprintln!("WARNING: Agent is not running");
        process::exit(1);
    }

    if let Some(pid) = get_pid()? {
        println!("Stopping Pankha Rust Agent (PID: {})...", pid);

        // Send SIGTERM
        unsafe { libc::kill(pid as i32, libc::SIGTERM) };

        // Wait for graceful shutdown
        for _ in 0..10 {
            if !is_running() {
                break;
            }
            std::thread::sleep(std::time::Duration::from_secs(1));
        }

        // Force kill if necessary
        if is_running() {
            println!("WARNING: Force killing agent...");
            unsafe { libc::kill(pid as i32, libc::SIGKILL) };
        }

        remove_pid_file()?;
        println!("Agent stopped");
    }

    Ok(())
}

pub fn restart_daemon_with_log_level(log_level: Option<String>) -> Result<()> {
    println!("\x1b[32mRestarting pankha-agent v{} ({})\x1b[0m", env!("CARGO_PKG_VERSION"), std::env::consts::ARCH);

    // Check if systemd service is actively managing the process
    // If so, delegate to systemctl to prevent auto-restart conflicts
    if is_systemd_service_active() {
        println!("Agent is managed by systemd. Using systemctl restart...");
        let status = process::Command::new("systemctl")
            .args(["restart", "pankha-agent"])
            .status();

        match status {
            Ok(s) if s.success() => {
                println!("Agent restarted via systemd");
                return Ok(());
            }
            Ok(_) => {
                eprintln!("WARNING: systemctl restart failed, falling back to manual restart");
            }
            Err(e) => {
                eprintln!("WARNING: Could not run systemctl: {}, falling back to manual restart", e);
            }
        }
    }

    // Manual restart (for non-systemd systems or systemctl fallback)
    // Stop the agent if it's running
    if is_running() {
        if let Some(pid) = get_pid()? {
            println!("Stopping Pankha Rust Agent (PID: {})...", pid);

            // Send SIGTERM
            unsafe { libc::kill(pid as i32, libc::SIGTERM) };

            // Wait for graceful shutdown
            for _ in 0..10 {
                if !is_running() {
                    break;
                }
                std::thread::sleep(std::time::Duration::from_secs(1));
            }

            // Force kill if necessary
            if is_running() {
                println!("WARNING: Force killing agent...");
                unsafe { libc::kill(pid as i32, libc::SIGKILL) };
            }

            remove_pid_file()?;
            println!("Agent stopped");
        }
        std::thread::sleep(std::time::Duration::from_secs(1));
    } else {
        println!("Agent not running, starting it...");
    }

    // Always start the agent (whether it was running or not)
    start_daemon_with_log_level(log_level)
}

pub fn set_log_level_runtime(level: &str) -> Result<()> {
    // Validate log level
    let valid_levels = ["trace", "debug", "info", "warn", "error", "critical"];
    let level_lower = level.to_lowercase();
    if !valid_levels.contains(&level_lower.as_str()) {
        return Err(anyhow::anyhow!(
            "Invalid log level '{}'. Valid levels: TRACE, DEBUG, INFO, WARN, ERROR, CRITICAL",
            level
        ));
    }

    // Check if agent is running
    if !is_running() {
        return Err(anyhow::anyhow!(
            "Agent is not running. Start the agent first with: --start"
        ));
    }

    // Load current config
    let config_path = std::env::current_exe()?
        .parent()
        .ok_or_else(|| anyhow::anyhow!("Cannot determine executable directory"))?
        .join("config.json");

    let content = std::fs::read_to_string(&config_path)?;
    let mut config: AgentConfig = serde_json::from_str(&content)?;

    // Update log level in config
    let old_level = config.agent.log_level.clone();
    config.agent.log_level = level.to_uppercase();

    // Save updated config
    let content = serde_json::to_string_pretty(&config)?;
    std::fs::write(&config_path, content)?;

    println!("Log level updated: {} → {}", old_level, level.to_uppercase());
    println!("Configuration saved to: {:?}", config_path);

    // Send SIGHUP to running agent to reload config
    if let Some(pid) = get_pid()? {
        println!("Sending reload signal to agent (PID: {})...", pid);
        unsafe { libc::kill(pid as i32, libc::SIGHUP) };
        println!("✅ Log level changed successfully");
        println!("\nNote: New log level will be applied immediately.");
        println!("      Logs are written to: {}/agent.log", LOG_DIR);
        println!("      View logs with: ./pankha-agent -l");
    }

    Ok(())
}
