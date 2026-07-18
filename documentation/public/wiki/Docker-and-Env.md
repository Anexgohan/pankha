# Docker and Env

How to deploy Pankha Fan Control with Docker, and every environment variable the stack actually reads. Essentials first; advanced setups below.

---

## Quick Start

```bash
# 1. Get the two files
curl -LO https://raw.githubusercontent.com/Anexgohan/pankha/main/compose.yml
curl -L -o .env https://raw.githubusercontent.com/Anexgohan/pankha/main/.env

# 2. Edit .env - at minimum set POSTGRES_USER, POSTGRES_PASSWORD, PANKHA_HUB_IP

# 3. Start
docker compose up -d
```

Open `http://<server-ip>:3143` - the dashboard walks you through creating the first admin account.

---

## Environment Variables

Set these in the `.env` file next to `compose.yml` (or as `-e` flags with `docker run`).

### Required

| Variable            | Accepted values        | Default            | Description                                                                                            |
| ------------------- | ---------------------- | ------------------ | ------------------------------------------------------------------------------------------------------ |
| `POSTGRES_USER`     | any string             | set your own       | Database username.                                                                                     |
| `POSTGRES_PASSWORD` | any string             | set your own       | Database password. Never keep a published example value.                                               |
| `POSTGRES_DB`       | database name          | `db_pankha`        | Database name.                                                                                         |
| `PANKHA_HUB_IP`     | LAN IP or hostname     | unset              | The address agents connect to. Baked into the install scripts the Deployment page generates, so it must be reachable from every agent machine (e.g. `192.168.1.100`). |

### Optional

| Variable                    | Accepted values                                              | Default                    | Description                                                                                                                                                              |
| --------------------------- | ------------------------------------------------------------ | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PANKHA_PORT`               | port number                                                  | `3143`                     | Host port for the dashboard, API, and WebSocket.                                                                                                                          |
| `TIMEZONE`                  | [tz database name](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones) | `UTC`  | Timezone for dashboard times and logs.                                                                                                                                    |
| `LOG_LEVEL`                 | `error`, `warn`, `info`, `debug`, `trace`                    | `info`                     | Backend log verbosity.                                                                                                                                                    |
| `PANKHA_STAGING_DIR`        | absolute path                                                | `/app/backend/data/staging`| Where downloaded agent binaries, checksums, and reports are stored (mounted to `./docker-data/staging` in compose).                                                       |
| `PANKHA_SESSION_DURATION`   | `<n> <unit>` - minute/hour/day/week/month/year, singular or plural | `7 days`             | How long a browser login stays valid (sliding - activity renews it), e.g. `12 hours`, `2 weeks`. Unrecognized values fall back to 7 days.                                 |
| `PANKHA_MAX_PENDING_AGENTS` | positive integer                                             | `20`                       | Max agents awaiting approval at once; raise it for a large first-time enrollment so the whole fleet pends in one screen instead of refilling in waves.                      |
| `PANKHA_TRUST_PROXY`        | comma-separated IPs/CIDRs                                    | unset (no proxy trusted)   | Addresses of your reverse proxies, e.g. `192.168.1.5` or `10.0.0.0/8, 172.16.0.1`. Forwarded-for headers are only believed when they arrive from these addresses, so the login rate limiter identifies the real client instead of the shared proxy IP. Leave unset for direct connections. Invalid values are ignored with a warning. See the reverse-proxy note below. |
| `PANKHA_AUTH_RESET`         | `true` / `false`                                             | unset (off)                | Account recovery: when set to `true`, all user accounts are reset on startup and the dashboard returns to first-run setup. Remove the variable and restart once you are back in. Any value other than `true`, `false`, or unset refuses to start. |
| `POSTGRES_HOST`             | hostname                                                     | `pankha-postgres`          | Database host. The compose service name by default; change only for an external database (see below).                                                                     |
| `POSTGRES_PORT`             | port number                                                  | `5432`                     | Database port.                                                                                                                                                            |

### PostgreSQL tuning (leave as-is unless you know why)

| Variable                      | Accepted values | Default | Description                                       |
| ----------------------------- | --------------- | ------- | ------------------------------------------------- |
| `POSTGRES_MAX_WAL_SIZE`       | size            | `256MB` | Cap on transaction log size before checkpoint.    |
| `POSTGRES_MIN_WAL_SIZE`       | size            | `80MB`  | Minimum WAL kept; old files recycle down to this. |
| `POSTGRES_CHECKPOINT_TIMEOUT` | duration        | `5min`  | Time between checkpoints.                         |
| `POSTGRES_WAL_KEEP_SIZE`      | size            | `64MB`  | WAL retained for recovery purposes.               |

---

## Docker Compose

The shipped [`compose.yml`](https://github.com/Anexgohan/pankha/blob/main/compose.yml) runs two containers - the app and PostgreSQL:

```yaml
services:
  pankha-app:
    container_name: pankha_app
    image: anexgohan/pankha:latest # :latest=(stable) | :beta=(absolute latest) | :testing=(pre-release)
    ports:
      - "${PANKHA_PORT:-3143}:3143"
    environment:
      - TZ=${TIMEZONE:-UTC}
      - PORT=3143 # Internal port, do not change
    env_file:
      - .env
    depends_on:
      pankha-postgres:
        condition: service_healthy
    volumes:
      - ./docker-data/staging:${PANKHA_STAGING_DIR}
    restart: unless-stopped

  pankha-postgres:
    container_name: pankha_postgres
    image: postgres:18-alpine
    environment:
      - POSTGRES_DB=${POSTGRES_DB}
      - POSTGRES_USER=${POSTGRES_USER}
      - POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
    env_file:
      - .env
    volumes:
      - ./docker-data/backend/database/postgres_data:/var/lib/postgresql
    restart: unless-stopped
```

The database port is intentionally not published to the host; the app reaches it over the internal Docker network. Uncomment the `ports:` block in the shipped file only if external database access is needed.

---

## Docker Run (without Compose)

The same stack as plain `docker run` commands:

```bash
docker network create pankha-net

docker run -d --name pankha_postgres \
  --network pankha-net \
  -e POSTGRES_DB=db_pankha \
  -e POSTGRES_USER=<your-user> \
  -e POSTGRES_PASSWORD=<your-password> \
  -v "$(pwd)/docker-data/backend/database/postgres_data:/var/lib/postgresql" \
  --restart unless-stopped \
  postgres:18-alpine

docker run -d --name pankha_app \
  --network pankha-net \
  -p 3143:3143 \
  -e PORT=3143 \
  -e TZ=UTC \
  -e POSTGRES_HOST=pankha_postgres \
  -e POSTGRES_PORT=5432 \
  -e POSTGRES_DB=db_pankha \
  -e POSTGRES_USER=<your-user> \
  -e POSTGRES_PASSWORD=<your-password> \
  -e PANKHA_HUB_IP=<your-lan-ip> \
  -e PANKHA_STAGING_DIR=/app/backend/data/staging \
  -v "$(pwd)/docker-data/staging:/app/backend/data/staging" \
  --restart unless-stopped \
  anexgohan/pankha:latest
```

---

## Troubleshooting

**Dashboard unreachable / port already in use** - another service owns the port. Change `PANKHA_PORT` in `.env` and re-run `docker compose up -d`:

```text
$ docker compose up -d
Error response from daemon: failed to bind host port 0.0.0.0:3143: address already in use
```

**App container restarts, database connection refused** - `POSTGRES_HOST` must match the database container's name on the shared network (`pankha-postgres` in compose, `pankha_postgres` with plain docker run):

```text
$ docker logs pankha_app
Error: Database connection requires either POSTGRES_USER/POSTGRES_PASSWORD/POSTGRES_DB or DATABASE_URL
```

**Agents cannot connect after install** - `PANKHA_HUB_IP` was unset or not reachable from the agent's network when the install script was generated. Set it to the server's LAN IP and generate a fresh install script from the Deployment page.

**Locked out of the dashboard** - set `PANKHA_AUTH_RESET=true` in `.env`, restart the app container, complete first-run setup again, then remove the variable and restart once more.

**Times are wrong in the dashboard or logs** - set `TIMEZONE` in `.env` to your tz database name (e.g. `Asia/Kolkata`) and restart.

---

## Advanced

### External PostgreSQL

To use an existing PostgreSQL server instead of the bundled container: remove (or don't start) the `pankha-postgres` service, and point the app at your server in `.env`:

```bash
POSTGRES_HOST="db.example.lan"
POSTGRES_PORT="5432"
POSTGRES_DB="db_pankha"
POSTGRES_USER="<your-user>"
POSTGRES_PASSWORD="<your-password>"
```

The backend builds its connection string from these variables with proper URL-encoding, so special characters in passwords are safe. (A raw `DATABASE_URL` is accepted as a fallback only when the individual variables are absent, and you must pre-encode special characters yourself - prefer the variables above.) The schema is created automatically on first start.

### Upgrading and rolling back

```bash
# Upgrade to the newest image on your chosen tag
docker compose down && docker compose pull && docker compose up -d
```

Image tags: `latest` (stable), `beta` (absolute latest), `testing` (pre-releases). To pin or roll back, set an explicit version in `compose.yml` and recreate:

```yaml
image: anexgohan/pankha:v0.6.2
```

```bash
docker compose up -d
```

Your data lives in `./docker-data/` on the host, outside the containers, so recreating containers does not touch it.

### Running behind a reverse proxy

Pankha serves HTTP and WebSocket on the same port. If you front it with nginx, Caddy, or Traefik, the proxy must forward WebSocket upgrade headers or the dashboard's live updates and agent connections will fail. For nginx:

```nginx
location / {
    proxy_pass http://127.0.0.1:3143;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

Also set `PANKHA_TRUST_PROXY` to your proxy's address (see the variable table) so login rate limiting sees real client addresses instead of the proxy's.
