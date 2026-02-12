# Welcome to Pankha (पंखा)

Pankha is an open-source, distributed fan control system designed for self-hosters and hardware enthusiasts. It allows you to monitor and control hardware cooling across multiple physical machines from a single, centralized dashboard.

![Centralized Dashboard](https://raw.githubusercontent.com/Anexgohan/pankha/main/documentation/public/images/pankha_title-bar_01.png)

## Key Features

*   **Centralized Control**: Manage fan curves and speeds for your NAS, gaming PC, and servers from one UI.
*   **Real-time Monitoring**: WebSocket-based architecture provides instant feedback (<100ms latency).
*   **Hardware Safety**:
    *   **Failsafe Mode**: Agents autonomously control fans when disconnected (configurable speed).
    *   **Emergency Stop**: Hard override to max fans if critical temps are reached.
    *   **Connectivity Watchdog**: Agents auto-reconnect; Backend alerts if an agent goes offline.
*   **Cross-Platform Agents**:
    *   **Linux**: Rust-based single binary (<10MB RAM).
    *   **Windows**: Native .NET 8 Service with System Tray control.
*   **Historical Data**: PostgreSQL storage for temperature and fan speed analysis.
*   **Hardware Agnostic**: Works with standard fans, custom loops, and professional telemetry.
*   **Privacy Centric**: Zero cloud dependency. You own your data.
*   **Self-Hostable**: Deploy the backend on your own server.

## Architecture

```
[ Browser / Dashboard ] <—— WebSocket ——> [ Backend Server ] <—— WebSocket ——> [ Agents ] <——> [ Hardware ]
      (React)                              (Node.js + PG)                    (Rust/C#)
```

## Getting Started

1.  **[Server Installation](Server-Installation)**: Deploy the server using Docker Compose.
2.  **[Linux Agent](Agents-Linux)**: Deploy agents to your Linux machines.
3.  **[Windows Agent](Agents-Windows)**: Deploy agents to your Windows machines.
4.  **[Server Configuration](Server-Configuration)**: Customize your setup.
