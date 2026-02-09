# Pankha Mock Agents - Swarm Mode

Lightweight mock agent system that runs multiple simulated Pankha agents in a **single process** for scaled testing.

## Quick Start

```bash
# Check dependencies
./mock-agents --check-deps

# Configure and start agents
./mock-agents --build

# Check status
./mock-agents --status

# Stop all agents
./mock-agents --stop
```

## Features

- **Single process**: Run 100+ agents in one Python process (~150MB RAM)
- **Protocol parity**: Identical to real Pankha agents
- **All commands**: Supports all 11 command types from frontend
- **Realistic data**: Temperature sine waves, RPM variations
- **Staggered startup**: 100ms between connections to avoid thundering herd

## Commands

| Command        | Description                            |
| -------------- | -------------------------------------- |
| `--build`      | Interactive wizard to configure agents |
| `--start`      | Start swarm as background daemon       |
| `--stop`       | Stop running swarm                     |
| `--status`     | Show swarm status                      |
| `--restart`    | Restart swarm                          |
| `--check-deps` | Verify dependencies                    |
| `--help`       | Show help                              |

## Directory Structure

```
pankha-mock-agents-swarm/
├── mock-agents          # CLI entry point
├── src/
│   ├── cli.py           # Command handlers
│   ├── swarm.py         # SwarmManager
│   ├── agent.py         # MockAgent
│   ├── hardware.py      # Sensor/fan simulation
│   └── logger.py        # Shared logging
├── data/
│   ├── agents.json      # Agent configurations
│   └── status.json      # Runtime status
├── logs/
│   └── swarm.log        # Rotating log (5MB)
├── runtime/
│   └── swarm.pid        # Process ID
└── requirements.txt
```

## Scaling

| Agents | RAM Usage | Startup Time |
| ------ | --------- | ------------ |
| 25     | ~60MB     | ~3s          |
| 100    | ~120MB    | ~10s         |
| 500    | ~400MB    | ~50s         |
