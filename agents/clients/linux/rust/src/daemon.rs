//! Daemon management constants and submodule re-exports.

pub mod pid;
pub mod systemd;
pub mod control;
pub mod status;

pub const PID_FILE: &str = "/run/pankha-agent/pankha-agent.pid";
pub const LOG_DIR: &str = "/var/log/pankha-agent";
pub const SYSTEMD_SERVICE_PATH: &str = "/etc/systemd/system/pankha-agent.service";

pub const SYSTEMD_SERVICE_TEMPLATE: &str = r#"[Unit]
Description=Pankha Hardware Monitoring Agent
After=network.target

[Service]
Type=forking
ExecStart={{EXEC_PATH}} --start
ExecStop={{EXEC_PATH}} --stop
ExecReload={{EXEC_PATH}} --restart
PIDFile=/run/pankha-agent/pankha-agent.pid
Restart=on-failure
RestartSec=10
User=root
WorkingDirectory={{WORK_DIR}}
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
"#;
