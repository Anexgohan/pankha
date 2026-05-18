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

**Pankha Fan Control** is an open-source fan and temperature management system for any PC - single desktop, server, or homelab fleet. Build smarter fan curves, lower noise, drop temperatures, and manage every machine from one web dashboard. Works on Windows and Linux. Free, self-hosted, no telemetry.

![Docker Pulls](https://img.shields.io/docker/pulls/anexgohan/pankha) ![GitHub Discussions](https://img.shields.io/github/discussions/Anexgohan/pankha) ![GitHub Repo Size](https://img.shields.io/github/repo-size/Anexgohan/pankha) ![GitHub Commit Activity](https://img.shields.io/github/commit-activity/m/Anexgohan/pankha) ![License](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)
![GitHub Latest Downloads](https://img.shields.io/github/downloads/Anexgohan/pankha/latest/total?label=Latest%20Downloads) ![GitHub Total Downloads](https://img.shields.io/github/downloads/Anexgohan/pankha/total?label=Total%20Downloads) ![GitHub Last Commit](https://img.shields.io/github/last-commit/Anexgohan/pankha) ![GitHub Release](https://img.shields.io/github/v/release/Anexgohan/pankha)

![GitHub Stars](https://img.shields.io/github/stars/Anexgohan/pankha?style=social) ![GitHub Forks](https://img.shields.io/github/forks/Anexgohan/pankha?style=social) ![GitHub Watchers](https://img.shields.io/github/watchers/Anexgohan/pankha?style=social) ![GitHub Sponsors](https://img.shields.io/github/sponsors/Anexgohan?style=social) ![GitHub Issues](https://img.shields.io/github/issues/Anexgohan/pankha) ![GitHub Pull Requests](https://img.shields.io/github/issues-pr/Anexgohan/pankha)
![Reddit Subscribers](https://img.shields.io/reddit/subreddit-subscribers/selfhosted?style=social) ![Discord](https://img.shields.io/badge/Discord-Coming%20Soon-5865F2?logo=discord&logoColor=white&style=flat-square)

![Centralized Dashboard](documentation/public/images/pankha_title-bar_01.png)

---

## What is Pankha Fan Control?

**Pankha Fan Control** - is open-source software that gives you complete control over your systems cooling. 
Build custom fan curves, monitor temperatures in real time, and tune RPM and noise to your exact preference - on a single desktop, a homelab, or a fleet of servers.

It runs the same way whether you're managing one machine or one hundred. The web dashboard works in any browser, on any device. Agents are lightweight, the backend is self-hosted, and nothing about your hardware ever leaves your network.
Its built to support single Windows or Linux PC or multiple Servers, VM's, NAS boxes, PC's - it can handle any scale.

---
## Features

- **Quieter PCs, cooler temps** - smart fan curves with hysteresis and stepping eliminate the always full throttlenoise and thermal spikes left behind by stock BIOS fan profiles
- **Unify Everything into 'One dashboard'** - unified web UI for one system or 100, on Windows, Linux, or IPMI / BMC-controlled servers, manage fans and temperatures across all your machines, on Windows, Linux, Virtual Machines with passed through devices like GPU, PCIe card, HBA, etc and x64 or ARM from one dashboard
- **Visual profile editor** - drag-and-drop curve editor with import / export so you can build, share, and reuse fan profiles across machines
- **Real hardware control** - direct PWM control with live RPM feedback, per-fan policies, and an always-on emergency-temperature override
- **Real-time monitoring** - temperature, RPM, and historical data for CPU, GPU, NVMe, motherboard, and chipset, streamed live over WebSocket
- **Safe by design** - if the backend is unreachable, agents fall back to a configurable safe fan speed with a local emergency-temperature override
- **Light and fast** - the Linux agent is a single Rust binary using under 15MB RAM and under 1% CPU. The Windows agent runs as a .NET 8 service using under 25MB RAM and under 1% CPU with full LibreHardwareMonitor access. IPMI/BMC Agents use even less resources.
- **Open source, self-hosted** - AGPL-3.0, no cloud, no telemetry. PostgreSQL backend, single-container Docker deployment

---
## Who is Pankha Fan Control for?

**Anyone who wants more control over their cooling than stock tools allow.** From a single quiet desktop to a fleet of servers - same dashboard, same workflow.

- **PC builders and gamers** - replace stock BIOS fan curves with smart custom ones; quieten your desktop without sacrificing thermals
- **Windows users** - a no-cloud, no-account fan utility that doesn't require per-machine setup
- **Linux desktop and server users** - PWM fan control on headless boxes (Debian, Ubuntu, RHEL, Proxmox, TrueNAS) without a GUI
- **Homelabbers and self-hosters** - manage Proxmox hosts, NAS boxes, and virtualisation hosts from one place
- **Server admins** - readable fan curves and a web UI for Dell PowerEdge, HP ProLiant, and Supermicro hardware controlled through IPMI / BMC, cure for always screaming fans even when idle.
- **Anyone managing more than one machine** - configure one or multiple profiles and apply to as many machines as you like.

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

### ![Server](https://img.shields.io/badge/-Server-0db7ed?logo=docker&logoColor=white&style=flat-square) Server (Docker)

```bash
wget -O compose.yml https://github.com/Anexgohan/pankha/releases/latest/download/compose.yml
wget -O .env https://github.com/Anexgohan/pankha/releases/latest/download/example.env
docker compose pull && docker compose up -d
```

Open the dashboard at `http://localhost:3000` (or your configured `PANKHA_PORT`).

[![Wiki Server Setup](https://img.shields.io/badge/Wiki-Server_Setup-0db7ed?style=flat-square&logo=readthedocs&logoColor=white&labelColor=555555)](https://github.com/Anexgohan/pankha/wiki/Server-Installation)

---
### ![Linux](https://img.shields.io/badge/-Linux-FCC624?logo=linux&logoColor=black&style=flat-square) Linux Agent (Rust)

**A. Recommended - one-line install via Deployment AIO**

In the dashboard, open **Deployment &rarr; Deployment AIO**, configure your options, and copy the generated command. It will look like:

```bash
wget -qO- "http://<your-backend>:<port>/api/deploy/linux?token=<token>" | bash
# or
curl -sSL "http://<your-backend>:<port>/api/deploy/linux?token=<token>" | bash
```

The script auto-detects your CPU architecture, downloads the matching binary, applies the config you set in the GUI, and installs the systemd service.

**B. Manual install**

<details>
<summary>Show x64 / ARM64 manual install (wget or curl)</summary>

##### ![Intel x64](https://img.shields.io/badge/CPU-x64-0071C5?logo=intel&logoColor=white&style=flat-square&labelColor=333&logoSize=auto) ![AMD x64](https://img.shields.io/badge/CPU-x64-ED1C24?logo=amd&logoColor=white&style=flat-square&labelColor=333&logoSize=auto) Intel / AMD x64

```bash
# wget
wget -O pankha-agent https://github.com/Anexgohan/pankha/releases/latest/download/pankha-agent-linux_x64
# or curl
curl -fsSLo pankha-agent https://github.com/Anexgohan/pankha/releases/latest/download/pankha-agent-linux_x64
chmod +x pankha-agent
```

##### ![ARM64](https://img.shields.io/badge/-ARM64-0091BD?logo=arm&logoColor=white&style=flat-square) ARM64 (Raspberry Pi 5, etc.)

```bash
# wget
wget -O pankha-agent https://github.com/Anexgohan/pankha/releases/latest/download/pankha-agent-linux_arm64
# or curl
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
### ![Windows](https://img.shields.io/badge/-Windows-0078D4?logo=windows&logoColor=white&style=flat-square) Windows Agent (.NET 8)

Download **[pankha-agent-windows_x64.msi](https://github.com/Anexgohan/pankha/releases/latest/download/pankha-agent-windows_x64.msi)** from the latest release. The installer sets up the background service and the tray app. Right-click the tray icon &rarr; **Settings** &rarr; set the backend URL.

[![Wiki Windows Agent](https://img.shields.io/badge/Wiki-Windows_Agent-0db7ed?style=flat-square&logo=readthedocs&logoColor=white&labelColor=555555)](https://github.com/Anexgohan/pankha/wiki/Agents-Windows)

---
## ![Architecture](https://img.shields.io/badge/-Architecture-333?logo=microsoftvisio&logoColor=white&style=flat-square) How Pankha Fan Control works

![Node.js](https://img.shields.io/badge/-Node.js-339933?logo=nodedotjs&logoColor=white&style=flat-square) ![React](https://img.shields.io/badge/-React-61DAFB?logo=react&logoColor=black&style=flat-square) ![PostgreSQL](https://img.shields.io/badge/-PostgreSQL-336791?logo=postgresql&logoColor=white&style=flat-square) ![Rust](https://img.shields.io/badge/-Rust-CE422B?logo=rust&logoColor=white&style=flat-square) ![.NET](https://img.shields.io/badge/-.NET%208-512BD4?logo=dotnet&logoColor=white&style=flat-square) ![TypeScript](https://img.shields.io/badge/-TypeScript-3178C6?logo=typescript&logoColor=white&style=flat-square)

A central **backend** (Docker container with Node.js, PostgreSQL, and a WebSocket hub) coordinates lightweight **agents** running on each machine you want to control.

**Components**

- **Backend** - Node.js + Express + WebSocket + PostgreSQL, deployed as a single Docker container
- **Frontend** - React + TypeScript + Vite, served by nginx
- **Linux agent** - single Rust binary using <15MB RAM and <1% CPU, `sysfs` hardware access, zero runtime dependencies
- **Windows agent** - self installing .NET 8 service using <25MB RAM and <1% CPU, capable of full LibreHardwareMonitor access to all sensors and fans on any Windows machine

**How it works**

- Agents push sensor and fan readings to the backend over WebSocket every few configurable seconds; the backend computes deltas and broadcasts changes only when needed to minimise bandwidth.
- The backend evaluates your fan curves and sends control commands back to agents in real time
- If the backend is unreachable, agents enter **failsafe mode** - a configurable safe fan speed with a local emergency-temperature override

```
Browser <-HTTP/WebSocket-> Backend (Docker) <-WebSocket-> Agents <-Direct-> Hardware
```

[![Wiki Architecture](https://img.shields.io/badge/Wiki-Architecture-0db7ed?style=flat-square&logo=readthedocs&logoColor=white&labelColor=555555)](https://github.com/Anexgohan/pankha/wiki/Architecture)

## ![Docs](https://img.shields.io/badge/-Documentation-8CA1AF?logo=readthedocs&logoColor=white&style=flat-square) Documentation

[![Wiki](https://img.shields.io/badge/Full_Documentation-GitHub_Wiki-0db7ed?style=for-the-badge&logo=github)](https://github.com/Anexgohan/pankha/wiki)

<table>
<tr>
<td align="center" valign="top">

![Server](https://img.shields.io/badge/-Server-0db7ed?logo=docker&logoColor=white&style=flat-square)

<div align="left">

- [Installation](https://github.com/Anexgohan/pankha/wiki/Server-Installation)
- [Configuration](https://github.com/Anexgohan/pankha/wiki/Server-Configuration)

</div>
</td>
<td align="center" valign="top">

![Agents](https://img.shields.io/badge/-Agents-CE422B?logo=rust&logoColor=white&style=flat-square)

<div align="left">

- [Linux](https://github.com/Anexgohan/pankha/wiki/Agents-Linux)
- [Windows](https://github.com/Anexgohan/pankha/wiki/Agents-Windows)
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
