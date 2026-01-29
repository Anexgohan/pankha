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

## Next Steps

See [Agents-Advanced-Settings](Agents-Advanced-Settings) for agent-specific configuration options like hysteresis, fan step %, and emergency temperature.
