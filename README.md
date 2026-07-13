# Pankha Fan Control <img src="documentation/public/images/animation/pankha_fan_256x256_5-fins.webp" width="32" style="vertical-align: sub;"> (पंखा)

<p align="center">
  <a href="https://demo.pankha.app/"><img src="https://img.shields.io/badge/Click_Here-Live_Demo-0db7ed?style=plastic&labelColor=555555" alt="Click Here - Live Demo" width="280"></a>
  <br>
  <sub>No install required</sub>
</p>
<br>
<p align="center">
  <a href="https://pankha.app/"><img src="https://img.shields.io/badge/Official_website-pankha.app-2563eb?style=flat&labelColor=555555" alt="Official website - pankha.app"></a>
</p>

**Pankha Fan Control** is an open-source fan and temperature management system for any PC - single desktop, server, or homelab fleet. Build smarter fan curves, lower noise, drop temperatures, and manage every machine from one web dashboard. Works on Windows, Linux, and IPMI/BMC-controlled servers. Free, self-hosted, no telemetry.

![Docker Pulls](https://img.shields.io/docker/pulls/anexgohan/pankha) ![GitHub Discussions](https://img.shields.io/github/discussions/Anexgohan/pankha) ![GitHub Repo Size](https://img.shields.io/github/repo-size/Anexgohan/pankha) ![GitHub Commit Activity](https://img.shields.io/github/commit-activity/m/Anexgohan/pankha) ![License](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)
![GitHub Latest Downloads](https://img.shields.io/github/downloads/Anexgohan/pankha/latest/total?label=Latest%20Downloads) ![GitHub Total Downloads](https://img.shields.io/github/downloads/Anexgohan/pankha/total?label=Total%20Downloads) ![GitHub Last Commit](https://img.shields.io/github/last-commit/Anexgohan/pankha) ![GitHub Release](https://img.shields.io/github/v/release/Anexgohan/pankha)

![GitHub Stars](https://img.shields.io/github/stars/Anexgohan/pankha?style=social) ![GitHub Forks](https://img.shields.io/github/forks/Anexgohan/pankha?style=social) ![GitHub Watchers](https://img.shields.io/github/watchers/Anexgohan/pankha?style=social) ![GitHub Sponsors](https://img.shields.io/github/sponsors/Anexgohan?style=social) ![GitHub Issues](https://img.shields.io/github/issues/Anexgohan/pankha) ![GitHub Pull Requests](https://img.shields.io/github/issues-pr/Anexgohan/pankha)
![Reddit Subscribers](https://img.shields.io/reddit/subreddit-subscribers/selfhosted?style=social) ![Discord](https://img.shields.io/badge/Discord-Coming%20Soon-5865F2?logo=discord&logoColor=white&style=flat-square)

![Centralized Dashboard](documentation/public/images/pankha_title-bar_01.png)

---
## What is Pankha Fan Control?

**Pankha Fan Control** - is open-source software that gives you complete control over your system's cooling. 
Build custom fan curves, monitor temperatures in real time, and tune RPM and noise to your exact preference - on a single desktop, a homelab, or a fleet of servers.

It runs the same way whether you're managing one machine or one hundred. The web dashboard works in any browser, on any device. Agents are lightweight, the backend is self-hosted, and nothing about your hardware ever leaves your network.
It's built to handle any scale - a single Windows or Linux PC, or fleets of servers, VMs, and NAS boxes.

---
## Features

- **Quieter PCs, cooler temps :**  smart fan curves with hysteresis and stepping eliminate the full-throttle noise and thermal spikes left behind by stock BIOS fan profiles
- **Everything in one dashboard :**  one web UI for one system or a hundred - Windows, Linux, and IPMI/BMC-controlled servers, bare metal or VMs with passed-through hardware (GPU, HBA, PCIe), x64 or ARM - every fan and temperature managed from a single place
- **Knows your fans personally :**  every fan's real usable range - where it starts, where it stalls, its true ceiling - is [measured automatically](https://github.com/Anexgohan/pankha/wiki/Fan-Calibration), and a fan that starts dying gets flagged before you can hear it
- **Sensors you compose :**  combine any sensors into a [virtual sensor](https://github.com/Anexgohan/pankha/wiki/Dashboard) - let "the hottest of my NVMe drives" drive the drive-bay fan
- **Visual profile editor :**  drag-and-drop curve editor with import / export so you can build, share, and reuse [fan profiles](https://github.com/Anexgohan/pankha/wiki/Fan-Profiles) across machines
- **Real hardware control :**  direct PWM control with live RPM feedback, per-fan policies, and an always-on emergency-temperature override
- **Real-time monitoring :**  temperature, RPM, and historical data for CPU, GPU, NVMe, motherboard, and chipset, streamed live over WebSocket
- **Safe by design :**  if the backend is unreachable, agents fall back to a configurable safe fan speed with a local emergency-temperature override - and [agents never connect to anything but your server](https://github.com/Anexgohan/pankha/wiki/Agent-Philosophy)
- **Light and fast :**  the Linux agent is a single Rust binary using under 15MB RAM and under 1% CPU. The Windows agent runs as a .NET 8 service using under 25MB RAM and under 1% CPU with full LibreHardwareMonitor access. IPMI/BMC Agents use even less resources.
- **Open source, self-hosted :**  AGPL-3.0, no cloud, no telemetry. PostgreSQL backend, single-container Docker deployment

---
## Supported Systems & Architecture

Pankha is designed to manage cooling profiles across all your hardware from a single interface. Whether you are adjusting a gaming desktop, a personal Linux machine, or multiple computers at once, Pankha keeps your system footprint light and your control absolute.


| Feature / System | 🪟 Windows Desktop | 🐧 Linux System | 💻 Central Dashboard |
| :--- | :--- | :--- | :--- |
| **Ideal For** | Gaming Rigs, Workstations, virtual or remote desktops | Daily Drivers, Servers, Hosts/Nodes, Virtual device passed through | Any modern web browser (Mobile/PC) |
| **Tech Stack** | C# / .NET (Native Client) | Rust (Lightweight Binary) | React + TypeScript UI, Node.js + PostgreSQL backend |
| **Deployment** | Quick-install `.msi` package | Pre-configured standalone binary | 1-Click Docker Compose setup |
| **Resource Usage** | Near-zero background RAM & CPU usage | Near-zero background RAM & CPU usage | Low-overhead WebSocket hub |
| **Hardware Link** | via LibreHardwareMonitor | Direct kernel-level device mappings | Real-time aggregated data stream |
| **Installation** | Fully automated/guided | Instant pre-configured binary | Self-hosted or local execution |

---
## Who is Pankha Fan Control for?

**Anyone who wants more control over their cooling than stock tools allow.** From a single quiet desktop to a fleet of servers - same dashboard, same workflow.

- **PC builders and gamers :**  replace stock BIOS fan curves with smart custom ones; quieten your desktop without sacrificing thermals
- **Windows users :**  a no-cloud, no-account fan utility that doesn't require per-machine setup
- **Linux desktop and server users :**  PWM fan control on headless boxes (Debian, Ubuntu, RHEL, Proxmox, TrueNAS) without a GUI
- **Homelabbers and self-hosters :**  manage Proxmox hosts, NAS boxes, and virtualisation hosts from one place
- **Server admins :**  readable fan curves and a web UI for Dell PowerEdge, HP ProLiant, and Supermicro hardware controlled through IPMI / BMC - the cure for fans that scream even at idle.
- **Anyone managing more than one machine :**  configure one or multiple profiles and apply to as many machines as you like.

---
## Screenshots

<table>
  <tr>
    <td align="center"><img src="documentation/public/images/pankha_system-cards_02.png" alt="Agent widget"><br><sub>Agent widget</sub></td>
    <td align="center"><img src="documentation/public/images/pankha_sensor-cards_02.png" alt="Temperature sensors"><br><sub>Temperature sensors</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="documentation/public/images/pankha_fan-cards_02.png" alt="Fan control with RPM feedback"><br><sub>Fan control with RPM feedback</sub></td>
    <td align="center"><img src="documentation/public/images/pankha_fan-profiles_01.png" alt="Fan profiles"><br><sub>Fan profiles</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="documentation/public/images/pankha_fan-profile_editor_01.png" alt="Customisable profile editor"><br><sub>Customisable profile editor</sub></td>
    <td align="center"><img src="documentation/public/images/pankha_fan-profile_import-export_01.png" alt="Profile import / export"><br><sub>Profile import / export</sub></td>
  </tr>
</table>

---
## Quick Start
### Overview :
1. Deploy the backend server (Docker)
2. Install appropriate agent on each machine you want to control (Linux, Windows, IPMI/BMC)
3. Open the dashboard and start tuning your fan curves!

### ![Server](https://img.shields.io/badge/-Server-0db7ed?logo=docker&logoColor=white&style=flat-square) Server (Docker)

```bash
wget -O compose.yml https://github.com/Anexgohan/pankha/releases/latest/download/compose.yml
wget -O .env https://github.com/Anexgohan/pankha/releases/latest/download/example.env
# edit .env first: set PANKHA_HUB_IP (this server's LAN IP) and your database credentials
docker compose pull && docker compose up -d
```

Open the dashboard at `http://localhost:3143` (or your configured `PANKHA_PORT`).

[![Wiki Server Setup](https://img.shields.io/badge/Wiki-Server_Setup-0db7ed?style=flat-square&logo=readthedocs&logoColor=white&labelColor=555555)](https://github.com/Anexgohan/pankha/wiki/Server-Installation)

---
### ![Linux](https://img.shields.io/badge/-Linux-FCC624?logo=linux&logoColor=black&style=flat-square) Linux Agent (Rust)

**A. Recommended - one-line install via Deployment AIO**

In the dashboard, open the **Deployment** tab, work through the numbered steps, and copy the generated command. It will look like:

```bash
# This is an example
wget -qO- "http://<pankha-ip>:<port>/api/deploy/linux?token=<token>" | bash
# or
curl -sSL "http://<pankha-ip>:<port>/api/deploy/linux?token=<token>" | bash
```

The script auto-detects your CPU architecture, downloads the matching binary, applies the config you set in the GUI, and installs the systemd service.

**B. Manual install**

<details>
<summary>Show x64 / ARM64 manual install (wget or curl)</summary>

##### ![Intel x64](https://img.shields.io/badge/CPU-x64-0071C5?logo=intel&logoColor=white&style=flat-square&labelColor=333&logoSize=auto) ![AMD x64](https://img.shields.io/badge/CPU-x64-ED1C24?logo=amd&logoColor=white&style=flat-square&labelColor=333&logoSize=auto) Intel / AMD x64 :

with wget:
```bash
wget -O pankha-agent https://github.com/Anexgohan/pankha/releases/latest/download/pankha-agent-linux_x64
chmod +x pankha-agent
```
or with curl:
```bash
curl -fsSLo pankha-agent https://github.com/Anexgohan/pankha/releases/latest/download/pankha-agent-linux_x64
chmod +x pankha-agent
```

##### ![ARM64](https://img.shields.io/badge/-ARM64-0091BD?logo=arm&logoColor=white&style=flat-square) ARM64 (Raspberry Pi 5, etc.) :


with wget:
```bash
wget -O pankha-agent https://github.com/Anexgohan/pankha/releases/latest/download/pankha-agent-linux_arm64
chmod +x pankha-agent
```
or with curl:
```bash
curl -fsSLo pankha-agent https://github.com/Anexgohan/pankha/releases/latest/download/pankha-agent-linux_arm64
chmod +x pankha-agent
```

Then configure (works for both):

```bash
sudo ./pankha-agent --setup
```

List all commands: `./pankha-agent --help`

</details>

###
[![Wiki Linux Agent](https://img.shields.io/badge/Wiki-Linux_Agent-0db7ed?style=flat-square&logo=readthedocs&logoColor=white&labelColor=555555)](https://github.com/Anexgohan/pankha/wiki/Agents-Linux)

---
### ![Windows](https://img.shields.io/badge/-Windows-0078D4?logo=windows&logoColor=white&style=flat-square) Windows Agent (.NET 8) :

Download **[pankha-agent-windows_x64.msi](https://github.com/Anexgohan/pankha/releases/latest/download/pankha-agent-windows_x64.msi)** from the latest release. The installer sets up the background service and the tray app. Right-click the tray icon &rarr; **Configure...** &rarr; set the backend URL. Done.
Control your fans and monitor your temperatures from the dashboard!

[![Wiki Windows Agent](https://img.shields.io/badge/Wiki-Windows_Agent-0db7ed?style=flat-square&logo=readthedocs&logoColor=white&labelColor=555555)](https://github.com/Anexgohan/pankha/wiki/Agents-Windows)

---
### ![IPMI](https://img.shields.io/badge/-IPMI%20%2F%20BMC-6C3483?logo=serverfault&logoColor=white&style=flat-square) IPMI Agent (enterprise servers) :

For rack servers whose fans are owned by the BMC (Dell iDRAC, Supermicro, and more). In the dashboard's **Deployment** tab, pick the **IPMI** platform and your server's BMC profile, then run the generated command on the server - vendor commands come from swappable profiles, and unsupported hardware can be profiled with the built-in Profile Builder.

[![Wiki IPMI Agent](https://img.shields.io/badge/Wiki-IPMI_Agent-0db7ed?style=flat-square&logo=readthedocs&logoColor=white&labelColor=555555)](https://github.com/Anexgohan/pankha/wiki/Agents-IPMI)

---
## ![Architecture](https://img.shields.io/badge/-Architecture-333?logo=microsoftvisio&logoColor=white&style=flat-square) How Pankha Fan Control works

![Node.js](https://img.shields.io/badge/-Node.js-339933?logo=nodedotjs&logoColor=white&style=flat-square) ![React](https://img.shields.io/badge/-React-61DAFB?logo=react&logoColor=black&style=flat-square) ![PostgreSQL](https://img.shields.io/badge/-PostgreSQL-336791?logo=postgresql&logoColor=white&style=flat-square) ![Rust](https://img.shields.io/badge/-Rust-CE422B?logo=rust&logoColor=white&style=flat-square) ![.NET](https://img.shields.io/badge/-.NET%208-512BD4?logo=dotnet&logoColor=white&style=flat-square) ![TypeScript](https://img.shields.io/badge/-TypeScript-3178C6?logo=typescript&logoColor=white&style=flat-square)

A central **backend** (Docker container with Node.js, PostgreSQL, and a WebSocket hub) coordinates lightweight **agents** running on each machine you want to control.

**Components**

- **Backend** - Node.js + Express + WebSocket + PostgreSQL, deployed as a single Docker container
- **Frontend** - React + TypeScript + Vite, served directly as a Web GUI Dashboard on `http://<IP>:<PORT>`
- **Linux agent** - single Rust binary using <15MB RAM and <1% CPU, `sysfs` hardware access, zero runtime dependencies
- **Windows agent** - self installing .NET 8 service using <25MB RAM and <1% CPU, capable of full LibreHardwareMonitor access to all sensors and fans on any Windows machine
- **IPMI agent** - Rust binary for BMC-controlled servers (Dell iDRAC, Supermicro, and more); drives fan zones through `ipmitool` using swappable vendor profiles

**How it works**

- Agents push sensor and fan readings to the backend over WebSocket at a configurable interval (default 3 seconds); the backend computes deltas and broadcasts changes only when needed to minimise bandwidth.
- The backend evaluates your fan curves and sends control commands back to agents in real time
- Frontend connects to the backend to display real-time sensor readings and fan speeds, and to send profile updates and config and user changes back to the backend
- If the backend is unreachable, agents enter **failsafe mode** - a configurable safe fan speed with a local emergency-temperature override

```mermaid
graph LR
    Browser["Your browser<br/>(dashboard - desktop or phone)"]

    subgraph SRV["Pankha Fan Control server - one per network (Docker)"]
        direction TB
        Logic["Control logic<br/>fan curves, calibration, safety"]
        DB[("PostgreSQL<br/>history")]
        Logic <--> DB
    end

    subgraph FLEET["Your machines - one lightweight agent each"]
        direction TB
        Win["Windows agent<br/>gaming PC, workstation"]
        Lin["Linux agent<br/>NAS, homelab node, Raspberry Pi"]
        Ipmi["IPMI agent<br/>rack server (BMC)"]
    end

    Browser <-->|live updates| Logic
    Logic <-->|"sensor data up,<br/>fan commands down"| Win
    Logic <--> Lin
    Logic <--> Ipmi
    Win --> HW1(["fans + sensors"])
    Lin --> HW2(["fans + sensors"])
    Ipmi --> HW3(["fans + sensors"])

    style Logic fill:#1565c0,stroke:#333,color:#fff
```

[![Wiki Architecture](https://img.shields.io/badge/Wiki-How_the_Server_Works-0db7ed?style=flat-square&logo=readthedocs&logoColor=white&labelColor=555555)](https://github.com/Anexgohan/pankha/wiki/Server-Architecture)


## ![Docs](https://img.shields.io/badge/-Documentation-8CA1AF?logo=readthedocs&logoColor=white&style=flat-square) Documentation

[![Wiki](https://img.shields.io/badge/Full_Documentation-GitHub_Wiki-0db7ed?style=for-the-badge&logo=github)](https://github.com/Anexgohan/pankha/wiki)

<table>
<tr>
<td align="center" valign="top">

![Server](https://img.shields.io/badge/-Server-0db7ed?logo=docker&logoColor=white&style=flat-square)

<div align="left">

- [Quick Start](https://github.com/Anexgohan/pankha/wiki/Quick-Start)
- [Installation](https://github.com/Anexgohan/pankha/wiki/Server-Installation)
- [Configuration](https://github.com/Anexgohan/pankha/wiki/Server-Configuration)

</div>
</td>
<td align="center" valign="top">

![Agents](https://img.shields.io/badge/-Agents-CE422B?logo=rust&logoColor=white&style=flat-square)

<div align="left">

- [Linux](https://github.com/Anexgohan/pankha/wiki/Agents-Linux)
- [Windows](https://github.com/Anexgohan/pankha/wiki/Agents-Windows)
- [IPMI](https://github.com/Anexgohan/pankha/wiki/Agents-IPMI)
- [Settings](https://github.com/Anexgohan/pankha/wiki/Agents-Advanced-Settings)

</div>
</td>
<td align="center" valign="top">

![Reference](https://img.shields.io/badge/-Reference-339933?logo=swagger&logoColor=white&style=flat-square)

<div align="left">

- [API Reference](https://github.com/Anexgohan/pankha/wiki/API-Reference)
- [Fan Profiles](https://github.com/Anexgohan/pankha/wiki/Fan-Profiles)

</div>
</td>
<td align="center" valign="top">

![Help](https://img.shields.io/badge/-Help-F7DF1E?logo=stackoverflow&logoColor=black&style=flat-square)

<div align="left">

- [Troubleshooting](https://github.com/Anexgohan/pankha/wiki/Troubleshooting)
- [Build from Source](https://github.com/Anexgohan/pankha/wiki/Development-Build)

</div>
</td>
</tr>
</table>

## ![Contributing](https://img.shields.io/badge/-Contributing-28A745?logo=github&logoColor=white&style=flat-square) Contributing & Community

- **Discussions** - [GitHub Discussions](https://github.com/Anexgohan/pankha/discussions) for questions, ideas, and hardware reports
- **Issues** - [GitHub Issues](https://github.com/Anexgohan/pankha/issues) for bugs and feature requests
- **Discord** - coming soon
- **Pull Requests welcome** - fork the repo, branch as `feature/<name>`, open a PR. CI runs typecheck (frontend + backend), `cargo check` on the Rust agents, and a Docker build before review.

## License

Pankha Fan Control is licensed under [AGPL-3.0](LICENSE) ![License](https://img.shields.io/badge/license-AGPL--3.0-blue.svg). Commercial licensing is also available - see [LICENSE-COMMERCIAL.md](LICENSE-COMMERCIAL.md).
