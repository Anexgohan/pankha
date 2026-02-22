//! Command-line argument definitions (clap) and help text.

use clap::Parser;

pub const HELP_TEXT: &str = "
Pankha Cross-Platform Hardware Monitoring Agent
Usage: pankha-agent-linux_x86_64 [OPTIONS]

Options:
  -h, --help                    Print help
  -V, --version                 Print version
Setup & Service:
  -e, --setup                   Run interactive setup wizard
  -I, --install-service         Install systemd service for auto-start on boot
  -U, --uninstall-service       Uninstall systemd service
Daemon Control:
  -s, --start                   Start the agent daemon in background
  -x, --stop                    Stop the agent daemon
  -r, --restart                 Restart the agent daemon
Status & Logs:
  -i, --status                  Show agent status
  -l, --log-show [<LOG_SHOW>]   Show agent logs (tail -f by default, or tail -n <lines> if provided)
      --log-level <LOG_LEVEL>   Set log level (TRACE, DEBUG, INFO, WARN, ERROR). Use with --start/--restart
Config & Debug:
  -c, --config                  Show current configuration
      --check                   Run health check (verify config, service, directories)
      --test                    Test mode (hardware discovery only)
";

#[derive(Parser, Debug)]
#[command(name = "pankha-agent")]
#[command(version = env!("CARGO_PKG_VERSION"))]
#[command(about = "Pankha Cross-Platform Hardware Monitoring Agent", long_about = None)]
#[command(after_help = "")]
#[command(disable_help_flag = false)]
pub struct Args {
    // === Setup & Service ===
    /// Run interactive setup wizard
    #[arg(short = 'e', long, help_heading = "Setup & Service")]
    pub setup: bool,

    /// Install systemd service for auto-start on boot
    #[arg(short = 'I', long = "install-service", help_heading = "Setup & Service")]
    pub install_service: bool,

    /// Uninstall systemd service
    #[arg(short = 'U', long = "uninstall-service", help_heading = "Setup & Service")]
    pub uninstall_service: bool,

    // === Daemon Control ===
    /// Start the agent daemon in background
    #[arg(short = 's', long, help_heading = "Daemon Control")]
    pub start: bool,

    /// Stop the agent daemon
    #[arg(short = 'x', long, help_heading = "Daemon Control")]
    pub stop: bool,

    /// Restart the agent daemon
    #[arg(short = 'r', long, help_heading = "Daemon Control")]
    pub restart: bool,

    // === Status & Logs ===
    /// Show agent status
    #[arg(short = 'i', long = "status", help_heading = "Status & Logs")]
    pub status: bool,

    /// Show agent logs (tail -f by default, or tail -n <lines> if provided)
    #[arg(short = 'l', long = "log-show", help_heading = "Status & Logs")]
    pub log_show: Option<Option<usize>>,

    /// Set log level (TRACE, DEBUG, INFO, WARN, ERROR). Use with --start/--restart
    #[arg(long = "log-level", help_heading = "Status & Logs")]
    pub log_level: Option<String>,

    // === Config & Debug ===
    /// Show current configuration
    #[arg(short = 'c', long, help_heading = "Config & Debug")]
    pub config: bool,

    /// Run health check (verify config, service, directories)
    #[arg(long, help_heading = "Config & Debug")]
    pub check: bool,

    /// Test mode (hardware discovery only)
    #[arg(long, help_heading = "Config & Debug")]
    pub test: bool,

    /// Internal flag for daemon child process (do not use directly)
    #[arg(long, hide = true)]
    pub daemon_child: bool,
}
