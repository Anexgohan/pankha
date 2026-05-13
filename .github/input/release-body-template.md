## Pankha Fan Control (पंखा) - {{RELEASE_TYPE}} {{VERSION}}

### Instructions:
  1. Deploy the Pankha Server Docker Container
  2. Deploy the Pankha Agents to your client devices
  3. Access the Pankha Web Interface at `http://<server-ip>:<port>`

## ![Docker](https://img.shields.io/badge/-Docker-0db7ed?logo=docker&logoColor=white&style=flat-square) Quick Start (Pankha Server)
**Docker Compose Method (Recommended):**
```bash
# Download Docker Compose files from release
wget -O compose.yml https://github.com/Anexgohan/pankha/releases/download/{{VERSION}}/compose.yml
wget -O .env https://github.com/Anexgohan/pankha/releases/download/{{VERSION}}/example.env

# Edit .env with your settings, then start
docker compose up -d
```

**Docker Run Method:**
```bash
# Specific version (recommended for production)
docker run -d --name pankha anexgohan/pankha:{{VERSION}}

# Latest version
docker run -d --name pankha anexgohan/pankha:latest
```

## Quick Start (Pankha Agents)

### ![Linux](https://img.shields.io/badge/-Linux-FCC624?logo=linux&logoColor=black&style=flat-square) Linux Agents
#### ![Intel x64](https://img.shields.io/badge/CPU-x64-0071C5?logo=intel&logoColor=white&style=flat-square&labelColor=333&logoSize=auto) ![AMD x64](https://img.shields.io/badge/CPU-x64-ED1C24?logo=amd&logoColor=white&style=flat-square&labelColor=333&logoSize=auto) For x64 systems:
```bash
wget -O pankha-agent https://github.com/Anexgohan/pankha/releases/download/{{VERSION}}/pankha-agent-linux_x64
chmod +x pankha-agent
./pankha-agent --setup
./pankha-agent --start
```

#### ![ARM64](https://img.shields.io/badge/CPU-ARM64-0091BD?logo=arm&logoColor=white&style=flat-square&labelColor=333&logoSize=auto) For ARM64 systems (Raspberry Pi 5):
```bash
wget -O pankha-agent https://github.com/Anexgohan/pankha/releases/download/{{VERSION}}/pankha-agent-linux_arm64
chmod +x pankha-agent
./pankha-agent --setup
./pankha-agent --start
```

### [![Windows](https://img.shields.io/badge/-Windows-0078D4?logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI4OCIgaGVpZ2h0PSI4OCI+PHBhdGggZmlsbD0iI2ZmZmZmZiIgZD0ibTAgMTIuNDAyIDM1LjY4Ny00Ljg2LjAxNiAzNC40MjMtMzUuNjcuMjAzem0zNS42NyAzMy41MjkuMDI4IDM0LjQ1M0wuMDI4IDc1LjQ4LjAyNiA0NS43em00LjMyNi0zOS4wMjVMODcuMzE0IDB2NDEuNTI3bC00Ny4zMTguMzc2em00Ny4zMjkgMzkuMzQ5LS4wMTEgNDEuMzQtNDcuMzE4LTYuNjc4LS4wNjYtMzQuNzM5eiIvPjwvc3ZnPg==&style=flat-square)](https://github.com/Anexgohan/pankha/releases/download/{{VERSION}}/pankha-agent-windows_x64.msi) Windows Agent
#### ![Intel 64](https://img.shields.io/badge/CPU-x64-0071C5?logo=intel&logoColor=white&style=flat-square&labelColor=333&logoSize=auto) ![AMD 64](https://img.shields.io/badge/CPU-x64-ED1C24?logo=amd&logoColor=white&style=flat-square&labelColor=333&logoSize=auto) For x64 systems:
```bash
# Download MSI form release assets below, then run it
wget -O pankha-agent-windows_x64.msi https://github.com/Anexgohan/pankha/releases/download/{{VERSION}}/pankha-agent-windows_x64.msi
```

### ![Linux](https://img.shields.io/badge/-Linux-FCC624?logo=linux&logoColor=black&style=flat-square) IPMI Host Agent (Enterprise Servers)
#### ![Intel x64](https://img.shields.io/badge/CPU-x64-0071C5?logo=intel&logoColor=white&style=flat-square&labelColor=333&logoSize=auto) ![AMD x64](https://img.shields.io/badge/CPU-x64-ED1C24?logo=amd&logoColor=white&style=flat-square&labelColor=333&logoSize=auto) For servers with /dev/ipmi0 (Dell, Supermicro, ASRock, Tyan, Lenovo):
```bash
wget -O pankha-agent https://github.com/Anexgohan/pankha/releases/download/{{VERSION}}/pankha-agent-ipmi-linux_x64
chmod +x pankha-agent
./pankha-agent --setup
./pankha-agent --start
```

### ![SHA256](https://img.shields.io/badge/-SHA256-28A745?logo=gnuprivacyguard&logoColor=white&style=flat-square) Verify Download Integrity
```bash
wget -O checksums.txt https://github.com/Anexgohan/pankha/releases/download/{{VERSION}}/checksums.txt
sha256sum -c checksums.txt
```

## ![Docs](https://img.shields.io/badge/-Documentation-8CA1AF?logo=readthedocs&logoColor=white&style=flat-square)

- [Installation Guide](https://github.com/Anexgohan/pankha/wiki/Installation)
- [Agent Setup Guide](https://github.com/Anexgohan/pankha/wiki/Agent-Setup)
- [Configuration](https://github.com/Anexgohan/pankha/wiki/Configuration)
- [API Documentation](https://github.com/Anexgohan/pankha/wiki/API-Reference)
- [Troubleshooting](https://github.com/Anexgohan/pankha/wiki/Troubleshooting)
