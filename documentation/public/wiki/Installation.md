# Server Installation

Pankha is designed to be deployed using Docker Compose. This guides you through setting up the central server (Backend + Frontend + Database).

## Prerequisites

*   Docker Engine
*   Docker Compose

## 1. Quick Start (Recommended)

Run this one-liner to download the latest production configuration:

```bash
mkdir pankha && cd pankha
wget https://github.com/Anexgohan/pankha/releases/latest/download/compose.yml
wget https://github.com/Anexgohan/pankha/releases/latest/download/example.env -O .env

# Start the system
docker compose pull && docker compose up -d
```

The dashboard will be available at `http://localhost:3000`.

## 2. Docker Compose Configuration

If you prefer to configure it manually, here is the standard `compose.yml` structure:

```yaml
services:
  app:
    image: anexgohan/pankha:latest
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      - DATABASE_URL=postgresql://pankha:secure_password@postgres:5432/db_pankha
      - NODE_ENV=production
    depends_on:
      - postgres

  postgres:
    image: postgres:15-alpine
    restart: unless-stopped
    volumes:
      - pgdata:/var/lib/postgresql/data
    environment:
      - POSTGRES_USER=pankha
      - POSTGRES_PASSWORD=secure_password
      - POSTGRES_DB=db_pankha

volumes:
  pgdata:
```

### Environment Configuration (.env)

The `compose.yml` relies on an `.env` file for secrets. You can download the default one:

```bash
wget https://github.com/Anexgohan/pankha/releases/latest/download/example.env -O .env
```

Or create it manually:

```properties
PORT=3000
DATABASE_URL=postgresql://pankha:secure_password@postgres:5432/db_pankha
...
```

> **Note**: Change `secure_password` to a strong, unique password in both the `postgres` and `app` services.

## Verification

Check that your containers are running:
```bash
docker compose ps
```

You should see an `Up` status for both the app and postgres containers.
