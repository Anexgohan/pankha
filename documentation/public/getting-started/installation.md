# Installation Guide

This guide walks you through setting up Pankha's backend server and deploying agents to your systems.

## Server Installation

The Pankha backend runs in Docker and handles all data storage, agent communication, and serves the web dashboard.

### Requirements

- Docker and Docker Compose installed
- At least 256MB RAM available
- 1GB disk space for database storage

### Quick Start

1. Download the deployment files from the latest release:

```bash
wget https://github.com/Anexgohan/pankha/releases/latest/download/compose.yml
wget https://github.com/Anexgohan/pankha/releases/latest/download/.env
```

2. Start the server:

```bash
docker compose up -d
```

That's it. The dashboard is now available at http://localhost:3000

### Using Git Clone

If you prefer to clone the repository:

```bash
git clone https://github.com/Anexgohan/pankha.git
cd pankha
docker compose up -d
```

### Verification

Check that services are running:

```bash
docker compose ps
curl http://localhost:3000/health
```

You should see a healthy response from the backend.

### Stopping the Server

To stop all services:

```bash
docker compose down
```

To remove all data (including database):

```bash
docker compose down -v
```

## Next Steps

Once your server is running, you'll want to install agents on the systems you want to monitor. See the [Agent Setup Guide](agent-setup.md) for instructions.

## Custom Port

If port 3000 is already in use, edit the `.env` file:

```bash
PANKHA_PORT=7000
```

Then restart:

```bash
docker compose down
docker compose up -d
```

## Building from Source

Advanced users can build the Docker image themselves:

```bash
git clone https://github.com/Anexgohan/pankha.git
cd pankha
docker compose build --no-cache
docker compose up -d
```

This is useful if you want to modify the code or contribute to development.
