# Dashboard Not Loading - Troubleshooting Guide

**Issue**: Build succeeded but dashboard won't load
**Server**: 192.168.100.237:/root/anex/dev/pankha-dev/

---

## 🔍 Step 1: Check Browser Console (CRITICAL)

**Action**: Open browser console (F12 → Console tab)

**What to look for**:
```
❌ Failed to fetch
❌ WebSocket connection failed
❌ Cannot read property 'map' of undefined
❌ TypeError: ...
❌ Network error
```

**Common Errors**:

### Error 1: "Cannot read property 'map' of undefined"
**Cause**: `overview` state is null and trying to render
**Fix**: Check if OverviewStats handles null overview

### Error 2: "WebSocket connection failed to ws://192.168.100.237:3002"
**Cause**: WebSocket server not running or wrong port
**Fix**: Check if WebSocketHub is initialized in backend

### Error 3: "Failed to fetch http://192.168.100.237:3000/api/overview"
**Cause**: Backend not responding to HTTP
**Fix**: Check backend logs

---

## 🔍 Step 2: Check Backend Logs

**Command**:
```bash
ssh root@192.168.100.237
cd /root/anex/dev/pankha-dev
docker compose logs backend --tail 100 -f
```

**What to look for**:
```
✅ WebSocket server started on port 3002
✅ Connected to PostgreSQL database
❌ Error: ...
❌ TypeError: ...
❌ Cannot find module ...
```

**Common Issues**:

### Issue 1: Backend crashed on startup
**Look for**: Stack traces, module not found errors
**Fix**: Missing dependencies or import errors

### Issue 2: Database connection failed
**Look for**: "Error connecting to PostgreSQL"
**Fix**: Check DATABASE_URL in compose.yml

### Issue 3: WebSocketHub not initialized
**Look for**: No "WebSocket server started" message
**Fix**: Check if app.ts calls `webSocketHub.initialize()`

---

## 🔍 Step 3: Verify Services Are Running

**Command**:
```bash
ssh root@192.168.100.237
docker compose ps
```

**Expected Output**:
```
pankha-dev-app-1       running
pankha-dev-postgres-1  running
```

**If not running**:
```bash
docker compose logs app --tail 50
```

---

## 🔍 Step 4: Check Network Connectivity

**Test Backend HTTP**:
```bash
curl http://192.168.100.237:3000/health
```

**Expected**:
```json
{
  "status": "ok",
  "database": "connected",
  "websocket": "running"
}
```

**Test Frontend**:
```bash
curl -I http://192.168.100.237:3000/
```

**Expected**: `200 OK`

---

## 🐛 Most Likely Issues (After Pure WebSocket Change)

### Issue A: getOverview API Import Missing
**File**: `frontend/src/components/Dashboard.tsx`
**Check**: Line 2 should have `import { emergencyStop, getOverview } from '../services/api';`

### Issue B: WebSocketHub Not Initialized in Backend
**File**: `backend/src/app.ts` or `backend/src/server.ts`
**Check**: Should have:
```typescript
import { WebSocketHub } from './services/WebSocketHub';
const webSocketHub = WebSocketHub.getInstance();
webSocketHub.initialize(3002);
```

### Issue C: OverviewStats Receiving Null
**File**: `frontend/src/components/Dashboard.tsx`
**Issue**: `overview` state starts as null
**Fix**: OverviewStats component should handle null:
```tsx
{overview && <OverviewStats overview={overview} />}
```

### Issue D: DataAggregator Methods Missing
**File**: `backend/src/services/DataAggregator.ts`
**Check**: Should have:
```typescript
getAllSystemsData(): any[]
getSystemData(agentId: string): any
```

---

## 🔧 Quick Diagnostic Script

Run this on the server:

```bash
ssh root@192.168.100.237 << 'EOF'
cd /root/anex/dev/pankha-dev
echo "=== Docker Status ==="
docker compose ps

echo -e "\n=== Backend Logs (Last 20 lines) ==="
docker compose logs app --tail 20

echo -e "\n=== Health Check ==="
curl -s http://localhost:3000/health || echo "❌ Backend not responding"

echo -e "\n=== Frontend Check ==="
curl -I -s http://localhost:3000/ | head -1

echo -e "\n=== Port Check ==="
ss -tlnp | grep -E ':(3000|3002)'
EOF
```

---

## 🚨 Emergency Rollback (If Needed)

**Restore old useSystemData**:
```bash
ssh root@192.168.100.237
cd /root/anex/dev/pankha-dev/frontend/src/hooks
mv useSystemData.ts.OBSOLETE useSystemData.ts
mv useWebSocketData.ts useWebSocketData.ts.BACKUP

cd /root/anex/dev/pankha-dev/frontend/src/components
# Restore old Dashboard.tsx from git
git checkout HEAD -- Dashboard.tsx

docker compose down && docker compose build --no-cache && docker compose up -d
```

---

## 📋 Information Needed

Please provide:

1. **Browser Console Errors** (F12 → Console)
   ```
   Copy/paste any red errors here
   ```

2. **Backend Logs**
   ```bash
   docker compose logs app --tail 50
   ```

3. **Network Tab** (F12 → Network)
   - Does `/` load? (200 OK?)
   - Does `/api/overview` return data?
   - Does WebSocket connection attempt show up?

4. **What you see in browser**
   - Blank page?
   - Loading spinner stuck?
   - Error message?
   - Partial UI?

---

## 🎯 Next Steps

Based on what we find, I can:
1. Fix missing imports/functions
2. Add null checks for overview
3. Fix WebSocketHub initialization
4. Add error boundaries
5. Rollback if needed

**Please provide the browser console errors first - that's the fastest way to diagnose!**
