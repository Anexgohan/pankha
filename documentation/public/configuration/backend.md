# Backend Configuration

The backend server is configured through environment variables in the `.env` file.

## Environment Variables

### Database Configuration

These settings control the PostgreSQL database connection:

```bash
POSTGRES_DB=db_pankha
POSTGRES_USER=pankha_user
POSTGRES_PASSWORD=your_secure_password
DATABASE_URL=postgresql://pankha_user:your_secure_password@pankha-postgres:5432/db_pankha
```

**Important**: Change `your_secure_password` to a strong password before deploying to production.

If you're using an external PostgreSQL server (not the included container), update the `DATABASE_URL` to point to your database.

### Server Configuration

```bash
PANKHA_PORT=3000
NODE_ENV=production
```

- **PANKHA_PORT**: The port the web server listens on (default: 3000)
- **NODE_ENV**: Set to `production` for production deployments, `development` for local development

## Using an External Database

If you already have a PostgreSQL server, you can use it instead of the included container:

1. Create a database named `db_pankha` on your PostgreSQL server

2. Update the `.env` file with your database connection details:

```bash
DATABASE_URL=postgresql://myuser:mypassword@my-db-server.com:5432/db_pankha
```

3. Comment out or remove the PostgreSQL service from `compose.yml`:

```yaml
# Remove or comment this section if using external database
# services:
#   postgres:
#     ...
```

4. Start the backend:

```bash
docker compose up -d
```

The database schema will be automatically created on first startup.

## Changing the Port

If port 3000 conflicts with another service, change it in `.env`:

```bash
PANKHA_PORT=7000
```

Remember to update agent configurations to connect to the new port.

## Data Storage

All data is stored in PostgreSQL volumes managed by Docker. The database includes:

- Agent registration and metadata
- Temperature sensor readings (time-series data)
- Fan speed data and control history
- Fan profiles and configurations

To back up your data, use Docker volume backups or PostgreSQL dump tools.

## Performance Tuning

For systems monitoring many agents or with high data volumes, you may want to increase PostgreSQL memory settings. Add to `compose.yml`:

```yaml
services:
  postgres:
    environment:
      - POSTGRES_SHARED_BUFFERS=256MB
      - POSTGRES_EFFECTIVE_CACHE_SIZE=1GB
```

Restart after making changes:

```bash
docker compose down
docker compose up -d
```

## Logs

View backend logs:

```bash
docker compose logs -f pankha-app
```

View database logs:

```bash
docker compose logs -f pankha-postgres
```
