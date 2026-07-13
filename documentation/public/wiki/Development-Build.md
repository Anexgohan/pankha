# Building from Source

For developers who want to modify Pankha Fan Control or contribute to development.

---

## Prerequisites

*   Git
*   Docker and Docker Compose
*   Node.js 20+ (for local development)
*   Rust toolchain (for Linux agent)
*   .NET 8 SDK (for Windows agent)

---

## Clone Repository

```bash
git clone https://github.com/Anexgohan/pankha.git
cd pankha
```

---

## Build Docker Image

Build locally instead of pulling from Docker Hub:

```bash
docker compose build --no-cache
docker compose up -d
```

---

## Development Mode

The repository is an npm workspaces monorepo - install once at the root:

```bash
npm install
npm run dev              # both: frontend (5173, hot reload) + backend (3000)

# or individually:
npm run dev:frontend
npm run dev:backend

# checks
npm run typecheck
npm run lint
```

---

## Build Agents

### Linux Agent (Rust)
```bash
cd agents/clients/linux/rust
cargo build --release
# Binary: target/release/pankha-agent-linux
```

### IPMI Agent (Rust)
```bash
cd agents/clients/linux/virtual-agents/host-ipmi-rust
cargo build --release
# Binary: target/release/pankha-agent-ipmi-linux
```

### Windows Agent (.NET 8)
```powershell
cd agents/clients/windows/varient-c
.\build.ps1 -Menu              # Interactive menu
# OR
.\build.ps1 -Clean -Publish -BuildInstaller
# Output: publish/win-x64/installer/pankha-agent-windows_x64.msi
```

---

## Contributing

1.  Fork the repository
2.  Create a feature branch
3.  Make your changes
4.  Submit a pull request

See the main repository for contribution guidelines.
