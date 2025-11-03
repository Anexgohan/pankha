# Backend Troubleshooting

Common issues with the Pankha backend server and how to resolve them.

## Cannot Connect to Database

If the backend fails to start with database connection errors:

**Check PostgreSQL is running**:

```bash
docker compose ps
```

You should see both `pankha-app` and `pankha-postgres` running.

**View PostgreSQL logs**:

```bash
docker compose logs postgres
```

Look for error messages about initialization or configuration problems.

**Verify DATABASE_URL**:

```bash
cat .env | grep DATABASE_URL
```

Make sure the connection string matches your PostgreSQL configuration.

**Reset the database**:

If the database is corrupted, you can reset it (this will delete all data):

```bash
docker compose down -v
docker compose up -d
```

## Port Already in Use

Error: "Port 3000 is already allocated"

**Solution**: Change the port in your `.env` file:

```bash
PANKHA_PORT=7000
```

Then restart:

```bash
docker compose down
docker compose up -d
```

Don't forget to update agent configurations to use the new port.

## Backend Not Accessible

If you can't reach the dashboard from another computer:

**Check firewall rules**:

Make sure port 3000 (or your custom port) is open:

```bash
sudo ufw allow 3000
```

**Check Docker is binding to all interfaces**:

In `compose.yml`, ensure ports are configured correctly:

```yaml
ports:
  - "3000:3000"  # Correct
  # NOT "127.0.0.1:3000:3000" which only binds to localhost
```

**Verify the backend is listening**:

```bash
curl http://localhost:3000/health
```

Should return a JSON response with status information.

## WebSocket Connection Fails

If agents can't connect via WebSocket:

**Check WebSocket URL format**:

Must be `ws://` (not `http://`):

```
ws://192.168.1.100:3000/websocket
```

**Test WebSocket connectivity**:

From the agent machine:

```bash
curl http://backend-ip:3000/health
```

If HTTP works but WebSocket doesn't, check for proxy or firewall issues.

## High Memory Usage

PostgreSQL and the backend may use significant memory over time.

**Monitor memory usage**:

```bash
docker stats
```

**Restart services to free memory**:

```bash
docker compose restart
```

**Limit container memory** (optional):

Add to `compose.yml`:

```yaml
services:
  pankha-app:
    mem_limit: 512m
  postgres:
    mem_limit: 256m
```

## Database Performance Issues

If the dashboard is slow or unresponsive:

**Check database size**:

```bash
docker compose exec postgres psql -U pankha_user -d db_pankha -c "SELECT pg_size_pretty(pg_database_size('db_pankha'));"
```

**Vacuum the database**:

```bash
docker compose exec postgres psql -U pankha_user -d db_pankha -c "VACUUM ANALYZE;"
```

**Archive old data**:

Consider implementing data retention policies if you're storing months of sensor data.

## Container Won't Start

If Docker containers fail to start:

**View detailed logs**:

```bash
docker compose logs pankha-app
```

**Check for syntax errors in compose.yml**:

```bash
docker compose config
```

This validates your compose file syntax.

**Rebuild containers**:

```bash
docker compose down
docker compose up -d --build
```

## Frontend Not Loading

If you see a blank page or errors in the browser:

**Check browser console**:

Open Developer Tools (F12) and look for JavaScript errors or failed API requests.

**Verify frontend build**:

```bash
docker compose exec pankha-app ls -la /app/frontend/assets/
```

Should show compiled JavaScript files.

**Hard refresh the browser**:

Press Ctrl+Shift+R (or Cmd+Shift+R on Mac) to bypass cache.

## Logs and Debugging

**View all logs**:

```bash
docker compose logs -f
```

**View specific service logs**:

```bash
docker compose logs -f pankha-app
docker compose logs -f postgres
```

**Enter container for debugging**:

```bash
docker compose exec pankha-app /bin/sh
```

This gives you a shell inside the container to inspect files and run commands.

## Getting Help

If you're still stuck:

1. Check the [GitHub Issues](https://github.com/Anexgohan/pankha/issues) for similar problems
2. Gather relevant information:
   - Docker version: `docker --version`
   - Compose version: `docker compose version`
   - Container logs: `docker compose logs`
   - System info: `uname -a`
3. Open a new issue with detailed information about your problem
