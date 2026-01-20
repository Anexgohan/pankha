import { Router } from 'express';
import { log } from '../utils/logger';
import Database from '../database/database';
import crypto from 'crypto';
import fs from 'fs';
import UpdateDownloadService from '../services/UpdateDownloadService';

const router = Router();
const db = Database.getInstance();

/**
 * POST /api/deploy/templates
 * Generates a short deployment token and saves config
 */
router.post('/templates', async (req, res) => {
  try {
    const { config } = req.body;

    if (!config) {
      return res.status(400).json({ error: 'Config is required' });
    }

    // Generate 6-char lowercase alphanumeric token
    const token = crypto.randomBytes(3).toString('hex');

    // Set expiration to 24 hours from now
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24);

    await db.run(
      'INSERT INTO deployment_templates (token, config, expires_at) VALUES ($1, $2, $3)',
      [token, config, expiresAt]
    );

    log.info(`Generated deployment token: ${token}`, 'deploy');
    res.json({ token, expires_at: expiresAt });
  } catch (error) {
    log.error('Failed to create deployment template:', 'deploy', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/deploy/linux
 * Returns dynamic install.sh script
 */
router.get('/linux', async (req, res) => {
  try {
    const { token } = req.query;

    if (!token) {
      return res.status(400).send('Error: Token is required');
    }

    const result = await db.all(
      'SELECT config FROM deployment_templates WHERE token = $1 AND expires_at > NOW()',
      [token]
    );

    if (result.length === 0) {
      return res.status(404).send('Error: Invalid or expired token');
    }

    const config = result[0].config;
    await db.run('UPDATE deployment_templates SET used_count = used_count + 1 WHERE token = $1', [token]);

// Extract host and determine backend URL
    const host = req.headers.host || 'localhost:3000';
    const protocol = req.headers['x-forwarded-proto'] || 'http';
    const hostOnly = host.split(':')[0];
    const port = host.split(':')[1] || '3000';

    const backendUrl = `${protocol}://${host}`;
    const wsUrl = `ws://${hostOnly}:${port}/websocket`;

    // Local binary distribution URL (hub-and-spoke model)
    const localBinaryBase = `${backendUrl}/api/deploy/binaries`;

    // Generate install script
    const script = generateInstallScript(config, backendUrl, wsUrl, localBinaryBase);

    res.setHeader('Content-Type', 'text/x-shellscript');
    res.send(script);
  } catch (error) {
    log.error('Failed to serve install script:', 'deploy', error);
    res.status(500).send('Error: Internal server error');
  }
});

/**
 * GET /api/deploy/hub/status
 * Returns current status of locally cached binaries
 */
router.get('/hub/status', (req, res) => {
  const updateService = UpdateDownloadService.getInstance();
  res.json(updateService.getLocalStatus());
});

/**
 * POST /api/deploy/hub/stage
 * Triggers manual download of a specific version to the local server
 */
router.post('/hub/stage', async (req, res) => {
  try {
    const { version } = req.body;
    if (!version) {
      return res.status(400).json({ error: 'Version is required' });
    }

    const updateService = UpdateDownloadService.getInstance();
    const success = await updateService.downloadVersion(version);

    if (success) {
      res.json({ message: 'Download to server complete', version });
    } else {
      res.status(500).json({ error: 'Failed to download to server' });
    }
  } catch (error) {
    log.error('Failed to stage update:', 'deploy', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/deploy/binaries/:arch
 * Serves the locally cached agent binary
 */
router.get('/binaries/:arch', (req, res) => {
  const { arch } = req.params;
  const updateService = UpdateDownloadService.getInstance();
  const filePath = updateService.getBinaryPath(arch);

  if (!filePath || !fs.existsSync(filePath)) {
    return res.status(404).send('Binary not found on server');
  }

  res.download(filePath, `pankha-agent-linux_${arch}`);
});

function generateInstallScript(config: any, backendUrl: string, wsUrl: string, localBinaryBase: string): string {
  const {
    path_mode,
    log_level,
    failsafe_speed,
    emergency_temp,
    update_interval,
    fan_step,
    hysteresis
  } = config;

  const isPortable = path_mode === 'portable';
  const installDirValue = isPortable ? '$(pwd)' : '/opt/pankha-agent';
  const logFileValue = isPortable ? '$(pwd)/agent.log' : '/var/log/pankha-agent/agent.log';

  return `#!/bin/bash
# Pankha Agent Automated Installer
# Generated dynamically by Pankha Backend

set -e

echo "==============================================="
echo "  Pankha Agent Installer"
echo "==============================================="
echo ""

INSTALL_DIR="${installDirValue}"
LOG_LEVEL="${log_level || 'INFO'}"
FAILSAFE_SPEED="${failsafe_speed || 70}"
EMERGENCY_TEMP="${emergency_temp || 80}"
UPDATE_INTERVAL="${update_interval || 3.0}"
FAN_STEP="${fan_step || 5}"
HYSTERESIS="${hysteresis || 3.0}"
WS_URL="${wsUrl}"
LOG_FILE="${logFileValue}"

# Helper for conditional sudo
run_as_root() {
    if [ "$(id -u)" -eq 0 ]; then
        "$@"
    elif command -v sudo >/dev/null 2>&1; then
        sudo "$@"
    else
        echo "Warning: 'sudo' not found and not root. Attempting command anyway..."
        "$@"
    fi
}

echo "[1/5] Install directory: $INSTALL_DIR"
echo "      WebSocket URL: $WS_URL"
echo ""

# Create directories if not portable
if [ "$INSTALL_DIR" != "$(pwd)" ]; then
    echo "[2/5] Creating directories..."
    run_as_root mkdir -p "$INSTALL_DIR"
    run_as_root mkdir -p /var/log/pankha-agent
    run_as_root mkdir -p /run/pankha-agent
    run_as_root chown -R "$(whoami)" /var/log/pankha-agent 2>/dev/null || true
else
    echo "[2/5] Portable mode - using current directory"
fi

# Detect architecture
ARCH=$(uname -m)
BINARY_URL=""

echo "[3/5] Detecting architecture: $ARCH"

if [ "$ARCH" = "x86_64" ]; then
    BINARY_URL="${localBinaryBase}/x86_64"
elif [ "$ARCH" = "aarch64" ]; then
    BINARY_URL="${localBinaryBase}/aarch64"
else
    echo "ERROR: Unsupported architecture: $ARCH"
    echo "Supported: x86_64, aarch64"
    exit 1
fi

echo "      Downloading from local server: $BINARY_URL"
echo ""

# Download binary
if [ "$INSTALL_DIR" = "$(pwd)" ]; then
    curl -fSL "$BINARY_URL" -o "$INSTALL_DIR/pankha-agent"
    chmod +x "$INSTALL_DIR/pankha-agent"
else
    run_as_root curl -fSL "$BINARY_URL" -o "$INSTALL_DIR/pankha-agent"
    run_as_root chmod +x "$INSTALL_DIR/pankha-agent"
fi

echo "[4/5] Generating configuration..."

# Generate unique agent ID
AGENT_ID="linux-$(hostname)-$(head /dev/urandom | tr -dc a-z0-9 | head -c 8)"

# Write config.json
CONFIG_CONTENT='{
  "agent": {
    "name": "'$(hostname)'",
    "id": "'$AGENT_ID'",
    "update_interval": '$UPDATE_INTERVAL',
    "log_level": "'$LOG_LEVEL'"
  },
  "backend": {
    "server_url": "'$WS_URL'",
    "reconnect_interval": 5.0,
    "max_reconnect_attempts": -1,
    "connection_timeout": 10.0
  },
  "hardware": {
    "enable_fan_control": true,
    "enable_sensor_monitoring": true,
    "fan_step_percent": '$FAN_STEP',
    "hysteresis_temp": '$HYSTERESIS',
    "emergency_temp": '$EMERGENCY_TEMP',
    "failsafe_speed": '$FAILSAFE_SPEED'
  },
  "logging": {
    "enable_file_logging": true,
    "log_file": "'$LOG_FILE'",
    "max_log_size_mb": 10,
    "log_retention_days": 7
  }
}'

if [ "$INSTALL_DIR" = "$(pwd)" ]; then
    echo "$CONFIG_CONTENT" > "$INSTALL_DIR/config.json"
else
    echo "$CONFIG_CONTENT" | run_as_root tee "$INSTALL_DIR/config.json" > /dev/null
fi

echo "      Agent ID: $AGENT_ID"
echo ""

# Setup systemd service
echo "[5/5] Setting up systemd service..."
if command -v systemctl >/dev/null 2>&1; then
    run_as_root "$INSTALL_DIR/pankha-agent" --install-service
    run_as_root systemctl daemon-reload
    run_as_root systemctl enable pankha-agent
    run_as_root systemctl restart pankha-agent

    echo ""
    echo "==============================================="
    echo "  Installation Complete!"
    echo "==============================================="
    echo ""
    echo "  Install path:  $INSTALL_DIR"
    echo "  Agent ID:      $AGENT_ID"
    echo "  Backend:       $WS_URL"
    echo ""
    echo "  Commands:"
    echo "    Status:   systemctl status pankha-agent"
    echo "    Logs:     journalctl -u pankha-agent -f"
    echo "    Stop:     systemctl stop pankha-agent"
    echo "    Restart:  systemctl restart pankha-agent"
    echo ""
else
    echo ""
    echo "==============================================="
    echo "  Installation Complete (No systemd)"
    echo "==============================================="
    echo ""
    echo "  Systemd not found. Start agent manually:"
    echo "    $INSTALL_DIR/pankha-agent --start"
    echo ""
fi
`;
}

export default router;
