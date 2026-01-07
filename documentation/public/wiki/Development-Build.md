# Building from Source

For developers who want to modify the code or contribute to development.

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

For active development with hot-reload:

### Backend
```bash
cd backend
npm install
npm run dev
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

---

## Build Agents

### Linux Agent (Rust)
```bash
cd agents/clients/linux/rust
cargo build --release
# Binary: target/release/pankha-agent
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
