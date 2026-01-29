# Server Configuration

The backend server is configured via environment variables, typically set in your `.env` file or Docker Compose.

## Environment Variables

| Variable       | Description                      | Default                               |
| -------------- | -------------------------------- | ------------------------------------- |
| `PANKHA_PORT`  | HTTP/WebSocket Port              | `3143`                                |
| `DATABASE_URL` | Connection string for PostgreSQL | `postgresql://user:pass@host:5432/db` |
| `NODE_ENV`     | Environment mode                 | `production`                          |
| `LOG_LEVEL`    | Server logging verbosity         | `info`                                |

---

## Custom Port

If port 3000 is already in use, change it in your `.env` file:

```bash
PANKHA_PORT=7000
```

Then restart:

```bash
docker compose down
docker compose up -d
```

> **Note**: Update all agent `config.json` files to use the new port in their `server_url`.

---

## Stopping the Server

To stop all services:

```bash
docker compose down
```

To remove all data (including database):

```bash
docker compose down -v
```

> ⚠️ **Warning**: The `-v` flag deletes all stored data permanently.

---

## Data & Storage Layout

Before deleting volumes, understand where your data lives:

```mermaid
---
title: Docker Storage & Networking Map
---
graph TD
    Host[Host Machine]
    
    subgraph "Docker Environment"
        App[Pankha Server]
        DB[Postgres Database]
    end
    
    subgraph "Persistent Storage"
        VolDB[(pankha-db-data)]
    end
    
    Host -->|Port: 3143| App
    App <-->|Internal Net| DB
    DB <-->|Persists To| VolDB
    
    style VolDB fill:#ddd,stroke:#333,stroke-width:2px,shape:cylinder,color:#000
    style App fill:#ccffcc,stroke:#333,color:#000
    style DB fill:#ccffcc,stroke:#333,color:#000
```


---

```

### File System Layout

```text
/deployment-folder/
├── compose.yml          # Container orchestration
├── .env                 # Environment variables (Port, DB, etc.)
└── volumes/             # Persistent data storage
    └── pankha-db-data/  # Database files (Persisted from Postgres)
```

## Next Steps

See [Agents-Advanced-Settings](Agents-Advanced-Settings) for agent-specific configuration options like hysteresis, fan step %, and emergency temperature.
