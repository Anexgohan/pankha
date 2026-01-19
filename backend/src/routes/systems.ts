import { Router, Request, Response } from "express";
import Database from "../database/database";
import { AgentManager } from "../services/AgentManager";
import { CommandDispatcher } from "../services/CommandDispatcher";
import { DataAggregator } from "../services/DataAggregator";
import { FanProfileController } from "../services/FanProfileController";
import { WebSocketHub } from "../services/WebSocketHub";
import { licenseManager } from "../license/LicenseManager";
import { log } from "../utils/logger";
import {
  validFanSteps,
  validHysteresis,
  validLogLevels,
  validEmergencyTemps,
  validUpdateIntervals,
} from "../config/uiOptions";

const router = Router();
const db = Database.getInstance();
const agentManager = AgentManager.getInstance();
const commandDispatcher = CommandDispatcher.getInstance();
const dataAggregator = DataAggregator.getInstance();
const fanProfileController = FanProfileController.getInstance();
const webSocketHub = WebSocketHub.getInstance();

/**
 * Check if a system can be controlled based on license tier agent limit.
 * Returns true if system is within limit, false if over_limit (view-only).
 * Uses AgentManager.isAgentReadOnly() for consistent ordering by created_at.
 */
async function canControlSystem(agentId: string): Promise<boolean> {
  const isReadOnly = await agentManager.isAgentReadOnly(agentId);
  return !isReadOnly;
}

// GET /api/systems - List all managed systems
router.get("/", async (req: Request, res: Response) => {
  try {
    const systems = await db.all(`
      SELECT 
        s.*,
        COUNT(DISTINCT sen.id) as sensor_count,
        COUNT(DISTINCT f.id) as fan_count
      FROM systems s
      LEFT JOIN sensors sen ON s.id = sen.system_id
      LEFT JOIN fans f ON s.id = f.system_id
      GROUP BY s.id
      ORDER BY s.name
    `);

    // Get license tier agent limit
    const tier = await licenseManager.getCurrentTier();
    const agentLimit =
      tier.agentLimit === Infinity ? systems.length : tier.agentLimit;

    // Get read-only status for all agents in a single call (optimized)
    const readOnlyStatus = await agentManager.getAgentsReadOnlyStatus();

    // Add real-time status from AgentManager
    const enhancedSystems = systems.map((system) => {
      const agentStatus = agentManager.getAgentStatus(system.agent_id);
      const systemData = dataAggregator.getSystemData(system.agent_id);

      // Check if this agent is read-only (over limit)
      const isReadOnly = readOnlyStatus.get(system.agent_id) ?? false;
      const accessStatus = isReadOnly ? "over_limit" : "active";

      return {
        ...system,
        capabilities: system.capabilities || null,
        config_data: system.config_data || null,
        access_status: accessStatus,
        read_only: isReadOnly,
        real_time_status: agentStatus?.status || "unknown",
        last_data_received: agentStatus?.lastDataReceived || null,
        current_temperatures: systemData?.sensors || [],
        current_fan_speeds: systemData?.fans || [],
        current_update_interval: agentManager.getAgentUpdateInterval(
          system.agent_id
        ),
        // filter_duplicate_sensors removed (deprecated)
        // duplicate_sensor_tolerance removed (deprecated)
        fan_step_percent: agentManager.getAgentFanStep(system.agent_id),
        hysteresis_temp: agentManager.getAgentHysteresis(system.agent_id),
        emergency_temp: agentManager.getAgentEmergencyTemp(system.agent_id),
        log_level: agentManager.getAgentLogLevel(system.agent_id),
      };
    });

    res.json(enhancedSystems);
  } catch (error) {
    log.error("Error fetching systems:", "systems", error);
    res.status(500).json({ error: "Failed to fetch systems" });
  }
});

// POST /api/systems - Add new system
router.post("/", async (req: Request, res: Response) => {
  try {
    const {
      name,
      agent_id,
      ip_address,
      api_endpoint,
      websocket_endpoint,
      auth_token,
      agent_version,
      capabilities,
    } = req.body;

    // Validate required fields
    if (!name || !agent_id || !api_endpoint || !websocket_endpoint) {
      return res.status(400).json({
        error:
          "Missing required fields: name, agent_id, api_endpoint, websocket_endpoint",
      });
    }

    // Check if agent_id already exists
    const existing = await db.get(
      "SELECT id FROM systems WHERE agent_id = $1",
      [agent_id]
    );
    if (existing) {
      return res
        .status(409)
        .json({ error: "System with this agent_id already exists" });
    }

    const result = await db.run(
      `
      INSERT INTO systems (
        name, agent_id, ip_address, api_endpoint, websocket_endpoint,
        auth_token, agent_version, capabilities, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'offline')
    `,
      [
        name,
        agent_id,
        ip_address,
        api_endpoint,
        websocket_endpoint,
        auth_token,
        agent_version || "1.0.0",
        capabilities ? JSON.stringify(capabilities) : null,
      ]
    );

    // Also register with AgentManager to add to in-memory status tracking
    try {
      const agentConfig = {
        name,
        agentId: agent_id,
        apiEndpoint: api_endpoint,
        websocketEndpoint: websocket_endpoint,
        authToken:
          auth_token || `mock_token_${Math.floor(Math.random() * 1000000)}`,
        version: agent_version || "1.0.0",
        updateInterval: 3000, // Default 3 seconds for real-time updates
        capabilities: capabilities || {},
      };

      await agentManager.registerAgent(agentConfig);
      log.info(
        ` Agent ${agent_id} registered in both database and memory`,
        "systems"
      );
    } catch (managerError) {
      log.warn(
        `Agent ${agent_id} registered in database but not in memory`,
        "systems",
        managerError
      );
    }

    const newSystem = await db.get(
      "SELECT * FROM systems WHERE agent_id = $1",
      [agent_id]
    );

    if (!newSystem) {
      throw new Error("Failed to retrieve newly created system");
    }

    res.status(201).json({
      ...newSystem,
      capabilities: newSystem.capabilities || null,
    });
  } catch (error) {
    log.error("Error creating system:", "systems", error);
    res.status(500).json({ error: "Failed to create system" });
  }
});

// GET /api/systems/limit - Get agent limit info for UI display
router.get("/limit", async (_req: Request, res: Response) => {
  try {
    const limitInfo = await agentManager.getAgentLimitInfo();
    const tier = await licenseManager.getCurrentTier();

    res.json({
      current_agents: limitInfo.current,
      agent_limit: limitInfo.limit === -1 ? "unlimited" : limitInfo.limit,
      over_limit: limitInfo.overLimit,
      tier_name: tier.name,
      upgrade_url: "https://pankha.dev/pricing",
    });
  } catch (error) {
    log.error("Error fetching agent limit info:", "systems", error);
    res.status(500).json({ error: "Failed to fetch agent limit info" });
  }
});

// GET /api/systems/controller/status - Get FanProfileController status
router.get("/controller/status", async (_req: Request, res: Response) => {
  try {
    const status = fanProfileController.getStatus();
    res.json(status);
  } catch (error) {
    log.error("Error fetching controller status:", "systems", error);
    res.status(500).json({ error: "Failed to fetch controller status" });
  }
});

// PUT /api/systems/controller/interval - Set FanProfileController update interval
router.put("/controller/interval", async (req: Request, res: Response) => {
  try {
    const { interval } = req.body;

    if (typeof interval !== "number" || interval < 500 || interval > 60000) {
      return res.status(400).json({
        error: "interval must be a number between 500 and 60000 milliseconds",
      });
    }

    await fanProfileController.setUpdateInterval(interval);

    res.json({
      message: "Controller update interval changed and saved to database",
      interval,
      status: fanProfileController.getStatus(),
    });
  } catch (error) {
    log.error("Error setting controller interval:", "systems", error);
    res.status(500).json({
      error:
        error instanceof Error
          ? error.message
          : "Failed to set controller interval",
    });
  }
});

// GET /api/systems/:id - Get system details
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const systemId = parseInt(req.params.id);

    const system = await db.get("SELECT * FROM systems WHERE id = $1", [
      systemId,
    ]);
    if (!system) {
      return res.status(404).json({ error: "System not found" });
    }

    // Get sensors and fans
    const sensors = await db.all(
      "SELECT * FROM sensors WHERE system_id = $1 ORDER BY sensor_type, sensor_name",
      [systemId]
    );
    const fans = await db.all(
      "SELECT * FROM fans WHERE system_id = $1 ORDER BY fan_name",
      [systemId]
    );
    const profiles = await db.all(
      "SELECT * FROM fan_profiles WHERE system_id = $1 ORDER BY profile_name",
      [systemId]
    );

    // Get real-time data
    const agentStatus = agentManager.getAgentStatus(system.agent_id);
    const systemData = dataAggregator.getSystemData(system.agent_id);

    res.json({
      ...system,
      capabilities: system.capabilities || null,
      config_data: system.config_data || null,
      sensors,
      fans,
      profiles: profiles.map((p) => ({
        ...p,
        profile_data: p.profile_data || null,
      })),
      real_time_status: agentStatus?.status || "unknown",
      real_time_data: systemData || null,
      current_update_interval: agentManager.getAgentUpdateInterval(
        system.agent_id
      ),
      // filter_duplicate_sensors removed (deprecated)
      // duplicate_sensor_tolerance removed (deprecated)
      fan_step_percent: agentManager.getAgentFanStep(system.agent_id),
      hysteresis_temp: agentManager.getAgentHysteresis(system.agent_id),
      emergency_temp: agentManager.getAgentEmergencyTemp(system.agent_id),
      log_level: agentManager.getAgentLogLevel(system.agent_id),
    });
  } catch (error) {
    log.error("Error fetching system details:", "systems", error);
    res.status(500).json({ error: "Failed to fetch system details" });
  }
});

// PUT /api/systems/:id - Update system configuration
router.put("/:id", async (req: Request, res: Response) => {
  try {
    const systemId = parseInt(req.params.id);
    const {
      name,
      ip_address,
      api_endpoint,
      websocket_endpoint,
      auth_token,
      agent_version,
      capabilities,
      config_data,
    } = req.body;

    const system = await db.get("SELECT * FROM systems WHERE id = $1", [
      systemId,
    ]);
    if (!system) {
      return res.status(404).json({ error: "System not found" });
    }

    await db.run(
      `
      UPDATE systems SET
        name = COALESCE($1, name),
        ip_address = COALESCE($2, ip_address),
        api_endpoint = COALESCE($3, api_endpoint),
        websocket_endpoint = COALESCE($4, websocket_endpoint),
        auth_token = COALESCE($5, auth_token),
        agent_version = COALESCE($6, agent_version),
        capabilities = COALESCE($7, capabilities),
        config_data = COALESCE($8, config_data)
      WHERE id = $9
    `,
      [
        name,
        ip_address,
        api_endpoint,
        websocket_endpoint,
        auth_token,
        agent_version,
        capabilities ? JSON.stringify(capabilities) : null,
        config_data ? JSON.stringify(config_data) : null,
        systemId,
      ]
    );

    const updatedSystem = await db.get("SELECT * FROM systems WHERE id = $1", [
      systemId,
    ]);

    res.json({
      ...updatedSystem,
      capabilities: updatedSystem.capabilities || null,
      config_data: updatedSystem.config_data || null,
    });
  } catch (error) {
    log.error("Error updating system:", "systems", error);
    res.status(500).json({ error: "Failed to update system" });
  }
});

// DELETE /api/systems/:id - Remove system
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const systemId = parseInt(req.params.id);

    const system = await db.get("SELECT * FROM systems WHERE id = $1", [
      systemId,
    ]);
    if (!system) {
      return res.status(404).json({ error: "System not found" });
    }

    // Clean up agent connections if active
    try {
      await agentManager.unregisterAgent(system.agent_id);
    } catch (error) {
      log.warn("Error unregistering agent during deletion:", "systems", error);
    }

    // Remove from data aggregator cache
    dataAggregator.removeSystemData(system.agent_id);

    await db.run("DELETE FROM systems WHERE id = $1", [systemId]);

    res.json({ message: "System deleted successfully" });
  } catch (error) {
    log.error("Error deleting system:", "systems", error);
    res.status(500).json({ error: "Failed to delete system" });
  }
});

// GET /api/systems/:id/status - Current system status
router.get("/:id/status", async (req: Request, res: Response) => {
  try {
    const systemId = parseInt(req.params.id);

    const system = await db.get("SELECT agent_id FROM systems WHERE id = $1", [
      systemId,
    ]);
    if (!system) {
      return res.status(404).json({ error: "System not found" });
    }

    const agentStatus = agentManager.getAgentStatus(system.agent_id);
    const systemData = dataAggregator.getSystemData(system.agent_id);

    res.json({
      agent_id: system.agent_id,
      status: agentStatus?.status || "unknown",
      last_seen: agentStatus?.lastSeen || null,
      last_data_received: agentStatus?.lastDataReceived || null,
      connection_info: agentStatus?.connectionInfo || null,
      real_time_data: systemData || null,
    });
  } catch (error) {
    log.error("Error fetching system status:", "systems", error);
    res.status(500).json({ error: "Failed to fetch system status" });
  }
});

// GET /api/systems/:id/sensors - Current temperature readings
router.get("/:id/sensors", async (req: Request, res: Response) => {
  try {
    const systemId = parseInt(req.params.id);

    const system = await db.get("SELECT agent_id FROM systems WHERE id = $1", [
      systemId,
    ]);
    if (!system) {
      return res.status(404).json({ error: "System not found" });
    }

    const sensors = await db.all(
      `
      SELECT 
        s.*,
        CASE 
          WHEN s.current_temp > s.temp_crit THEN 'critical'
          WHEN s.current_temp > s.temp_max * 0.9 THEN 'warning'
          ELSE 'ok'
        END as status
      FROM sensors s
      WHERE s.system_id = $1
      ORDER BY s.sensor_type, s.sensor_name
    `,
      [systemId]
    );

    res.json(sensors);
  } catch (error) {
    log.error("Error fetching sensors:", "systems", error);
    res.status(500).json({ error: "Failed to fetch sensors" });
  }
});

// GET /api/systems/:id/fans - Current fan speeds and status
router.get("/:id/fans", async (req: Request, res: Response) => {
  try {
    const systemId = parseInt(req.params.id);

    const system = await db.get("SELECT agent_id FROM systems WHERE id = $1", [
      systemId,
    ]);
    if (!system) {
      return res.status(404).json({ error: "System not found" });
    }

    const fans = await db.all(
      `
      SELECT 
        f.*,
        s1.sensor_label as primary_sensor_label,
        s1.current_temp as primary_sensor_temp,
        s2.sensor_label as secondary_sensor_label,
        s2.current_temp as secondary_sensor_temp
      FROM fans f
      LEFT JOIN sensors s1 ON f.primary_sensor_id = s1.id
      LEFT JOIN sensors s2 ON f.secondary_sensor_id = s2.id
      WHERE f.system_id = $1
      ORDER BY f.fan_name
    `,
      [systemId]
    );

    res.json(fans);
  } catch (error) {
    log.error("Error fetching fans:", "systems", error);
    res.status(500).json({ error: "Failed to fetch fans" });
  }
});

// PUT /api/systems/:id/fans/:fanId - Set individual fan speed
router.put("/:id/fans/:fanId", async (req: Request, res: Response) => {
  try {
    const systemId = parseInt(req.params.id);
    const fanId = req.params.fanId;
    const { speed, priority = "normal" } = req.body;

    if (typeof speed !== "number" || speed < 0 || speed > 100) {
      return res
        .status(400)
        .json({ error: "Speed must be a number between 0 and 100" });
    }

    const system = await db.get("SELECT agent_id FROM systems WHERE id = $1", [
      systemId,
    ]);
    if (!system) {
      return res.status(404).json({ error: "System not found" });
    }

    // Check license limit
    if (!(await canControlSystem(system.agent_id))) {
      return res.status(403).json({
        error:
          "System exceeds agent limit. Upgrade your plan to control this system.",
        upgrade_required: true,
      });
    }

    const result = await commandDispatcher.setFanSpeed(
      system.agent_id,
      fanId,
      speed,
      priority
    );

    res.json({
      message: "Fan speed command sent",
      agent_id: system.agent_id,
      fan_id: fanId,
      requested_speed: speed,
      priority,
      result,
    });
  } catch (error) {
    log.error("Error setting fan speed:", "systems", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to set fan speed",
    });
  }
});

// PUT /api/systems/:id/update-interval - Set agent update interval
router.put("/:id/update-interval", async (req: Request, res: Response) => {
  try {
    const systemId = parseInt(req.params.id);
    const { interval, priority = "normal" } = req.body;

    if (!validUpdateIntervals.includes(interval)) {
      return res.status(400).json({
        error: `Interval must be one of: ${validUpdateIntervals.join(", ")} seconds`,
      });
    }

    const system = await db.get("SELECT agent_id FROM systems WHERE id = $1", [
      systemId,
    ]);
    if (!system) {
      return res.status(404).json({ error: "System not found" });
    }

    // Check license limit
    if (!(await canControlSystem(system.agent_id))) {
      return res.status(403).json({
        error:
          "System exceeds agent limit. Upgrade your plan to control this system.",
        upgrade_required: true,
      });
    }

    const result = await commandDispatcher.setUpdateInterval(
      system.agent_id,
      interval,
      priority
    );

    res.json({
      message: "Update interval command sent",
      agent_id: system.agent_id,
      requested_interval: interval,
      priority,
      result,
    });
  } catch (error) {
    log.error("Error setting update interval:", "systems", error);
    res.status(500).json({
      error:
        error instanceof Error
          ? error.message
          : "Failed to set update interval",
    });
  }
});

// PUT /api/systems/:id/profile - Apply fan profile
router.put("/:id/profile", async (req: Request, res: Response) => {
  try {
    const systemId = parseInt(req.params.id);
    const { profile_name } = req.body;

    if (!profile_name) {
      return res.status(400).json({ error: "profile_name is required" });
    }

    const system = await db.get("SELECT agent_id FROM systems WHERE id = $1", [
      systemId,
    ]);
    if (!system) {
      return res.status(404).json({ error: "System not found" });
    }

    // Check license limit
    if (!(await canControlSystem(system.agent_id))) {
      return res.status(403).json({
        error:
          "System exceeds agent limit. Upgrade your plan to control this system.",
        upgrade_required: true,
      });
    }

    const result = await commandDispatcher.applyFanProfile(
      system.agent_id,
      profile_name
    );

    res.json({
      message: "Fan profile applied",
      agent_id: system.agent_id,
      profile_name,
      result,
    });
  } catch (error) {
    log.error("Error applying fan profile:", "systems", error);
    res.status(500).json({
      error:
        error instanceof Error ? error.message : "Failed to apply fan profile",
    });
  }
});

// POST /api/systems/:id/profiles - Save new fan profile
router.post("/:id/profiles", async (req: Request, res: Response) => {
  try {
    const systemId = parseInt(req.params.id);
    const { profile_name, description, profile_data } = req.body;

    if (!profile_name || !profile_data) {
      return res
        .status(400)
        .json({ error: "profile_name and profile_data are required" });
    }

    const system = await db.get("SELECT id FROM systems WHERE id = $1", [
      systemId,
    ]);
    if (!system) {
      return res.status(404).json({ error: "System not found" });
    }

    // Check if profile name already exists
    const existing = await db.get(
      "SELECT id FROM fan_profiles WHERE system_id = $1 AND profile_name = $2",
      [systemId, profile_name]
    );

    if (existing) {
      return res
        .status(409)
        .json({ error: "Profile with this name already exists" });
    }

    const result = await db.run(
      `
      INSERT INTO fan_profiles (system_id, profile_name, description, profile_data)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `,
      [systemId, profile_name, description, JSON.stringify(profile_data)]
    );

    const newProfile = result.rows[0];

    res.status(201).json({
      ...newProfile,
      profile_data: newProfile.profile_data,
    });
  } catch (error) {
    log.error("Error saving fan profile:", "systems", error);
    res.status(500).json({ error: "Failed to save fan profile" });
  }
});

// GET /api/systems/:id/history - Get historical monitoring data
router.get("/:id/history", async (req: Request, res: Response) => {
  try {
    const systemId = parseInt(req.params.id);
    const {
      start_time,
      end_time,
      sensor_ids,
      fan_ids,
      limit = 1000,
    } = req.query;

    const system = await db.get(`
      SELECT 
        id, 
        (SELECT COUNT(*) FROM sensors WHERE system_id = $1) as sensor_count,
        (SELECT COUNT(*) FROM fans WHERE system_id = $1) as fan_count
      FROM systems 
      WHERE id = $1
    `, [systemId]);

    if (!system) {
      return res.status(404).json({ error: "System not found" });
    }

    // Get tier retention limit
    const tier = await licenseManager.getCurrentTier();
    const retentionCutoff = new Date(
      Date.now() - tier.retentionDays * 24 * 60 * 60 * 1000
    );

    let startTime = start_time
      ? new Date(start_time as string)
      : new Date(Date.now() - 24 * 60 * 60 * 1000);
    const endTime = end_time ? new Date(end_time as string) : new Date();

    // Clamp start_time to the tier's retention limit (don't show data older than allowed)
    if (startTime < retentionCutoff) {
      startTime = retentionCutoff;
    }

    const sensorIdArray = sensor_ids
      ? (sensor_ids as string).split(",").map((id) => parseInt(id))
      : undefined;
    const fanIdArray = fan_ids
      ? (fan_ids as string).split(",").map((id) => parseInt(id))
      : undefined;

    // Calculate dynamic limit based on counts and requested time window
    // Formula: (sensors + fans) * (hours * 1-min-resolution) * safety-factor
    const hours = (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60);
    const sensorCount = parseInt(system.sensor_count || "0");
    const fanCount = parseInt(system.fan_count || "0");
    const totalEntities = Math.max(1, sensorCount + fanCount);
    
    // Dynamic limit: (entities) * (points per hour) * safety multiplier
    // For 24h, 22 entities: 22 * 60 * 24 * 1.5 = 47,520
    const calculatedLimit = Math.min(50000, Math.max(limit ? parseInt(limit as string) : 1000, 
      Math.ceil(totalEntities * (hours * 60) * 1.5)
    ));

    const historyData = await dataAggregator.getHistoricalData(
      systemId,
      startTime,
      endTime,
      sensorIdArray,
      fanIdArray,
      calculatedLimit,
      "DESC" // Fetch latest first
    );

    // Reverse results to preserve chronological order [oldest -> newest] for the frontend
    historyData.reverse();

    res.json({
      system_id: systemId,
      start_time: startTime.toISOString(),
      end_time: endTime.toISOString(),
      data_points: historyData.length,
      limit_applied: calculatedLimit,
      total_available: historyData.length >= calculatedLimit ? "unknown (limited)" : historyData.length,
      data: historyData,
    });
  } catch (error) {
    log.error("Error fetching historical data:", "systems", error);
    res.status(500).json({ error: "Failed to fetch historical data" });
  }
});

// GET /api/systems/:id/charts - Get chart data for dashboard
router.get("/:id/charts", async (req: Request, res: Response) => {
  try {
    const systemId = parseInt(req.params.id);
    let { hours = 24 } = req.query;

    const system = await db.get("SELECT id FROM systems WHERE id = $1", [
      systemId,
    ]);
    if (!system) {
      return res.status(404).json({ error: "System not found" });
    }

    // Clamp hours to tier retention limit
    const tier = await licenseManager.getCurrentTier();
    const maxHours = tier.retentionDays * 24;
    let requestedHours = parseInt(hours as string);
    if (requestedHours > maxHours) {
      requestedHours = maxHours;
    }

    const stats = await dataAggregator.getSystemStatistics(
      systemId,
      requestedHours
    );

    res.json({
      system_id: systemId,
      time_range_hours: requestedHours,
      max_hours_allowed: maxHours,
      statistics: stats,
    });
  } catch (error) {
    log.error("Error fetching chart data:", "systems", error);
    res.status(500).json({ error: "Failed to fetch chart data" });
  }
});

// PUT /api/systems/:id/fan-step - Set fan step percentage
router.put("/:id/fan-step", async (req: Request, res: Response) => {
  try {
    const systemId = parseInt(req.params.id);
    const { step, priority = "normal" } = req.body;

    if (!validFanSteps.includes(step)) {
      return res.status(400).json({
        error: `Step must be one of: ${validFanSteps.join(", ")}`,
      });
    }

    const system = await db.get("SELECT agent_id FROM systems WHERE id = $1", [
      systemId,
    ]);
    if (!system) {
      return res.status(404).json({ error: "System not found" });
    }

    // Optimistic Update: Update memory and database immediately
    await agentManager.setAgentFanStep(system.agent_id, step, true);

    const result = await commandDispatcher.setFanStep(
      system.agent_id,
      step,
      priority
    );

    res.json({
      message: "Fan step command sent",
      agent_id: system.agent_id,
      requested_step: step,
      priority,
      result,
    });
  } catch (error) {
    log.error("Error setting fan step:", "systems", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to set fan step",
    });
  }
});

// PUT /api/systems/:id/hysteresis - Set hysteresis temperature
router.put("/:id/hysteresis", async (req: Request, res: Response) => {
  try {
    const systemId = parseInt(req.params.id);
    const { hysteresis, priority = "normal" } = req.body;

    if (!validHysteresis.includes(hysteresis)) {
      return res.status(400).json({
        error: `Hysteresis must be one of: ${validHysteresis.join(", ")}`,
      });
    }

    const system = await db.get("SELECT agent_id FROM systems WHERE id = $1", [
      systemId,
    ]);
    if (!system) {
      return res.status(404).json({ error: "System not found" });
    }

    // Optimistic Update: Update memory and database immediately
    await agentManager.setAgentHysteresis(system.agent_id, hysteresis, true);

    const result = await commandDispatcher.setHysteresis(
      system.agent_id,
      hysteresis,
      priority
    );

    res.json({
      message: "Hysteresis command sent",
      agent_id: system.agent_id,
      requested_hysteresis: hysteresis,
      priority,
      result,
    });
  } catch (error) {
    log.error("Error setting hysteresis:", "systems", error);
    res.status(500).json({
      error:
        error instanceof Error ? error.message : "Failed to set hysteresis",
    });
  }
});

// PUT /api/systems/:id/emergency-temp - Set emergency temperature
router.put("/:id/emergency-temp", async (req: Request, res: Response) => {
  try {
    const systemId = parseInt(req.params.id);
    const { temp, priority = "normal" } = req.body;

    if (!validEmergencyTemps.includes(temp)) {
      return res
        .status(400)
        .json({ error: `Emergency temp must be one of: ${validEmergencyTemps.join(", ")}°C` });
    }

    const system = await db.get("SELECT agent_id FROM systems WHERE id = $1", [
      systemId,
    ]);
    if (!system) {
      return res.status(404).json({ error: "System not found" });
    }

    // Optimistic Update: Update memory and database immediately
    await agentManager.setAgentEmergencyTemp(system.agent_id, temp, true);

    const result = await commandDispatcher.setEmergencyTemp(
      system.agent_id,
      temp,
      priority
    );

    res.json({
      message: "Emergency temperature command sent",
      agent_id: system.agent_id,
      requested_temp: temp,
      priority,
      result,
    });
  } catch (error) {
    log.error("Error setting emergency temp:", "systems", error);
    res.status(500).json({
      error:
        error instanceof Error ? error.message : "Failed to set emergency temp",
    });
  }
});

// PUT /api/systems/:id/log-level - Set agent log level
router.put("/:id/log-level", async (req: Request, res: Response) => {
  try {
    const systemId = parseInt(req.params.id);
    const { level, priority = "normal" } = req.body;

    if (!validLogLevels.map(l => l.toUpperCase()).includes(level.toUpperCase())) {
      return res.status(400).json({
        error: `Log level must be one of: ${validLogLevels.join(", ")}`,
      });
    }

    const system = await db.get("SELECT agent_id FROM systems WHERE id = $1", [
      systemId,
    ]);
    if (!system) {
      return res.status(404).json({ error: "System not found" });
    }

    // Optimistic Update: Update memory and database immediately
    await agentManager.setAgentLogLevel(system.agent_id, level.toUpperCase(), true);

    const result = await commandDispatcher.setLogLevel(
      system.agent_id,
      level.toUpperCase(),
      priority
    );

    res.json({
      message: "Log level command sent",
      agent_id: system.agent_id,
      requested_level: level.toUpperCase(),
      priority,
      result,
    });
  } catch (error) {
    log.error("Error setting log level:", "systems", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to set log level",
    });
  }
});

// PUT /api/systems/:id/failsafe-speed - Set agent failsafe speed
router.put("/:id/failsafe-speed", async (req: Request, res: Response) => {
  try {
    const systemId = parseInt(req.params.id);
    const { speed, priority = "normal" } = req.body;

    if (typeof speed !== "number" || speed < 0 || speed > 100) {
      return res
        .status(400)
        .json({ error: "Failsafe speed must be between 0 and 100%" });
    }

    const system = await db.get("SELECT agent_id FROM systems WHERE id = $1", [
      systemId,
    ]);
    if (!system) {
      return res.status(404).json({ error: "System not found" });
    }

    // Optimistic Update: Update memory and database immediately
    await agentManager.setAgentFailsafeSpeed(system.agent_id, speed, true);

    const result = await commandDispatcher.setFailsafeSpeed(
      system.agent_id,
      speed,
      priority
    );

    res.json({
      message: "Failsafe speed command sent",
      agent_id: system.agent_id,
      requested_speed: speed,
      priority,
      result,
    });
  } catch (error) {
    log.error("Error setting failsafe speed:", "systems", error);
    res.status(500).json({
      error:
        error instanceof Error ? error.message : "Failed to set failsafe speed",
    });
  }
});

// PUT /api/systems/:id/enable-fan-control - Set enable fan control
router.put("/:id/enable-fan-control", async (req: Request, res: Response) => {
  try {
    const systemId = parseInt(req.params.id);
    const { enabled, priority = "normal" } = req.body;

    if (typeof enabled !== "boolean") {
      return res.status(400).json({ error: "enabled must be a boolean" });
    }

    const system = await db.get("SELECT agent_id FROM systems WHERE id = $1", [
      systemId,
    ]);
    if (!system) {
      return res.status(404).json({ error: "System not found" });
    }

    // Optimistic Update: Update memory and database immediately
    await agentManager.setAgentEnableFanControl(system.agent_id, enabled, true);

    const result = await commandDispatcher.setEnableFanControl(
      system.agent_id,
      enabled,
      priority
    );

    res.json({
      message: "Enable fan control command sent",
      agent_id: system.agent_id,
      requested_enabled: enabled,
      priority,
      result,
    });
  } catch (error) {
    log.error("Error setting enable fan control:", "systems", error);
    res.status(500).json({
      error:
        error instanceof Error
          ? error.message
          : "Failed to set enable fan control",
    });
  }
});

// POST /api/systems/:id/update - Trigger remote self-update
router.post("/:id/update", async (req: Request, res: Response) => {
  try {
    const systemId = parseInt(req.params.id);

    const system = await db.get("SELECT agent_id, name FROM systems WHERE id = $1", [
      systemId,
    ]);
    if (!system) {
      return res.status(404).json({ error: "System not found" });
    }

    // Check if agent is online
    const agentStatus = agentManager.getAgentStatus(system.agent_id);
    if (!agentStatus || agentStatus.status !== 'online') {
      return res.status(400).json({
        error: "Agent is not online",
        agent_status: agentStatus?.status || 'unknown'
      });
    }

    // Send selfUpdate command to agent via WebSocket
    const result = await commandDispatcher.sendCommand(
      system.agent_id,
      "selfUpdate",
      {},
      "normal"
    );

    log.info(`Remote update command sent to agent ${system.agent_id} (${system.name})`, "systems");

    res.json({
      message: "Update command sent to agent",
      agent_id: system.agent_id,
      system_name: system.name,
      result,
    });
  } catch (error) {
    log.error("Error triggering remote update:", "systems", error);
    res.status(500).json({
      error:
        error instanceof Error ? error.message : "Failed to trigger remote update",
    });
  }
});

// PUT /api/systems/:id/sensors/:sensorId/label - Update sensor label
router.put(
  "/:id/sensors/:sensorId/label",
  async (req: Request, res: Response) => {
    try {
      const systemId = parseInt(req.params.id);
      const sensorId = parseInt(req.params.sensorId);
      const { label } = req.body;

      // Validation
      if (!label || typeof label !== "string") {
        return res
          .status(400)
          .json({ error: "Label is required and must be a string" });
      }

      if (label.length > 255) {
        return res
          .status(400)
          .json({ error: "Label must be 255 characters or less" });
      }

      // Verify system exists
      const system = await db.get("SELECT id FROM systems WHERE id = $1", [
        systemId,
      ]);
      if (!system) {
        return res.status(404).json({ error: "System not found" });
      }

      // Verify sensor exists
      const sensor = await db.get(
        "SELECT id, sensor_name FROM sensors WHERE id = $1 AND system_id = $2",
        [sensorId, systemId]
      );
      if (!sensor) {
        return res.status(404).json({ error: "Sensor not found" });
      }

      // Update label
      await db.run(
        `UPDATE sensors SET sensor_label = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
        [label, sensorId]
      );

      const updatedSensor = await db.get(
        "SELECT * FROM sensors WHERE id = $1",
        [sensorId]
      );

      log.info(
        `Sensor label updated: ${sensor.sensor_name} -> "${label}"`,
        "systems"
      );

      res.json({
        message: "Sensor label updated successfully",
        sensor: updatedSensor,
      });
    } catch (error) {
      log.error("Error updating sensor label:", "systems", error);
      res.status(500).json({ error: "Failed to update sensor label" });
    }
  }
);

// PUT /api/systems/:id/fans/:fanId/label - Update fan label
router.put("/:id/fans/:fanId/label", async (req: Request, res: Response) => {
  try {
    const systemId = parseInt(req.params.id);
    const fanId = parseInt(req.params.fanId);
    const { label } = req.body;

    // Validation
    if (!label || typeof label !== "string") {
      return res
        .status(400)
        .json({ error: "Label is required and must be a string" });
    }

    if (label.length > 255) {
      return res
        .status(400)
        .json({ error: "Label must be 255 characters or less" });
    }

    // Verify system exists
    const system = await db.get("SELECT id FROM systems WHERE id = $1", [
      systemId,
    ]);
    if (!system) {
      return res.status(404).json({ error: "System not found" });
    }

    // Verify fan exists
    const fan = await db.get(
      "SELECT id, fan_name FROM fans WHERE id = $1 AND system_id = $2",
      [fanId, systemId]
    );
    if (!fan) {
      return res.status(404).json({ error: "Fan not found" });
    }

    // Update label
    await db.run(
      `UPDATE fans SET fan_label = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
      [label, fanId]
    );

    const updatedFan = await db.get("SELECT * FROM fans WHERE id = $1", [
      fanId,
    ]);

    log.info(`Fan label updated: ${fan.fan_name} -> "${label}"`, "systems");

    res.json({
      message: "Fan label updated successfully",
      fan: updatedFan,
    });
  } catch (error) {
    log.error("Error updating fan label:", "systems", error);
    res.status(500).json({ error: "Failed to update fan label" });
  }
});

// PUT /api/systems/:id/name - Update agent name (display name)
router.put("/:id/name", async (req: Request, res: Response) => {
  try {
    const systemId = parseInt(req.params.id);
    const { name } = req.body;

    // Validation
    if (!name || typeof name !== "string") {
      return res
        .status(400)
        .json({ error: "Name is required and must be a string" });
    }

    const trimmedName = name.trim();
    if (trimmedName.length === 0) {
      return res.status(400).json({ error: "Name cannot be empty" });
    }

    if (trimmedName.length > 255) {
      return res
        .status(400)
        .json({ error: "Name must be 255 characters or less" });
    }

    // Verify system exists and get old name + agent_id
    const system = await db.get("SELECT id, name, agent_id FROM systems WHERE id = $1", [
      systemId,
    ]);
    if (!system) {
      return res.status(404).json({ error: "System not found" });
    }

    // Update name in database
    await db.run(
      `UPDATE systems SET name = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
      [trimmedName, systemId]
    );

    // Optimistic Update: Set name in memory
    await agentManager.setAgentName(system.agent_id, trimmedName, false); // DB update already happened above at line 1215

    // Dispatch command to sync name to agent config
    try {
      await commandDispatcher.setAgentName(system.agent_id, trimmedName);
    } catch (cmdError) {
      // Log but don't fail - agent may be offline
      log.warn(
        `Failed to sync name to agent ${system.agent_id}: ${cmdError}`,
        "systems"
      );
    }

    // Broadcast name change to all subscribed frontend clients for instant update
    webSocketHub.broadcastNameChange(system.agent_id, trimmedName);

    log.info(
      `Agent name updated: "${system.name}" -> "${trimmedName}"`,
      "systems"
    );

    res.json({
      message: "Agent name updated successfully",
      name: trimmedName,
    });
  } catch (error) {
    log.error("Error updating agent name:", "systems", error);
    res.status(500).json({ error: "Failed to update agent name" });
  }
});

// PUT /api/systems/:id/sensors/:sensorId/visibility - Toggle individual sensor visibility
router.put(
  "/:id/sensors/:sensorId/visibility",
  async (req: Request, res: Response) => {
    try {
      const systemId = parseInt(req.params.id);
      const sensorId = parseInt(req.params.sensorId);
      const { is_hidden } = req.body;

      if (typeof is_hidden !== "boolean") {
        return res.status(400).json({ error: "is_hidden must be a boolean" });
      }

      // Verify system exists
      const system = await db.get("SELECT id FROM systems WHERE id = $1", [
        systemId,
      ]);
      if (!system) {
        return res.status(404).json({ error: "System not found" });
      }

      // Update sensor visibility
      await db.run(
        "UPDATE sensors SET is_hidden = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND system_id = $3",
        [is_hidden, sensorId, systemId]
      );

      log.info(
        `Sensor ${sensorId} visibility updated: is_hidden=${is_hidden}`,
        "systems"
      );

      res.json({
        message: "Sensor visibility updated successfully",
        sensor_id: sensorId,
        is_hidden,
      });
    } catch (error) {
      log.error("Error updating sensor visibility:", "systems", error);
      res.status(500).json({ error: "Failed to update sensor visibility" });
    }
  }
);

// PUT /api/systems/:id/sensor-groups/:groupName/visibility - Toggle sensor group visibility
router.put(
  "/:id/sensor-groups/:groupName/visibility",
  async (req: Request, res: Response) => {
    try {
      const systemId = parseInt(req.params.id);
      const groupName = req.params.groupName;
      const { is_hidden } = req.body;

      if (typeof is_hidden !== "boolean") {
        return res.status(400).json({ error: "is_hidden must be a boolean" });
      }

      // Verify system exists
      const system = await db.get("SELECT id FROM systems WHERE id = $1", [
        systemId,
      ]);
      if (!system) {
        return res.status(404).json({ error: "System not found" });
      }

      // Upsert group visibility
      await db.run(
        `INSERT INTO sensor_group_visibility (system_id, group_name, is_hidden, updated_at)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
       ON CONFLICT (system_id, group_name)
       DO UPDATE SET is_hidden = $3, updated_at = CURRENT_TIMESTAMP`,
        [systemId, groupName, is_hidden]
      );

      log.info(
        `Sensor group ${groupName} visibility updated: is_hidden=${is_hidden}`,
        "systems"
      );

      res.json({
        message: "Sensor group visibility updated successfully",
        group_name: groupName,
        is_hidden,
      });
    } catch (error) {
      log.error("Error updating sensor group visibility:", "systems", error);
      res
        .status(500)
        .json({ error: "Failed to update sensor group visibility" });
    }
  }
);

// GET /api/systems/:id/sensor-visibility - Get sensor and group visibility preferences
router.get("/:id/sensor-visibility", async (req: Request, res: Response) => {
  try {
    const systemId = parseInt(req.params.id);

    // Verify system exists
    const system = await db.get("SELECT id FROM systems WHERE id = $1", [
      systemId,
    ]);
    if (!system) {
      return res.status(404).json({ error: "System not found" });
    }

    // Get hidden sensors
    const hiddenSensors = await db.all(
      "SELECT id, sensor_name FROM sensors WHERE system_id = $1 AND is_hidden = true",
      [systemId]
    );

    // Get hidden groups
    const hiddenGroups = await db.all(
      "SELECT group_name FROM sensor_group_visibility WHERE system_id = $1 AND is_hidden = true",
      [systemId]
    );

    res.json({
      hidden_sensors: hiddenSensors.map((s) => s.sensor_name),
      hidden_sensor_ids: hiddenSensors.map((s) => s.id),
      hidden_groups: hiddenGroups.map((g) => g.group_name),
    });
  } catch (error) {
    log.error("Error fetching sensor visibility:", "systems", error);
    res.status(500).json({ error: "Failed to fetch sensor visibility" });
  }
});

// Allowed backend settings keys (whitelist for security)
const ALLOWED_SETTINGS = [
  'controller_update_interval',
  'graph_history_hours',
  'data_retention_days',
  'accent_color',
  'hover_tint_color',
] as const;

type AllowedSettingKey = typeof ALLOWED_SETTINGS[number];

function isAllowedSetting(key: string): key is AllowedSettingKey {
  return ALLOWED_SETTINGS.includes(key as AllowedSettingKey);
}

// GET /api/settings - Get all backend settings
router.get("/settings", async (req: Request, res: Response) => {
  try {
    const settings = await db.all("SELECT setting_key, setting_value, description FROM backend_settings");
    res.json(settings);
  } catch (error) {
    log.error("Error fetching backend settings:", "systems", error);
    res.status(500).json({ error: "Failed to fetch backend settings" });
  }
});

// GET /api/settings/:key - Get a specific setting
router.get("/settings/:key", async (req: Request, res: Response) => {
  try {
    const { key } = req.params;

    if (!isAllowedSetting(key)) {
      return res.status(400).json({
        error: `Unknown setting key. Allowed: ${ALLOWED_SETTINGS.join(', ')}`
      });
    }

    const setting = await db.get("SELECT setting_value FROM backend_settings WHERE setting_key = $1", [key]);
    if (!setting) {
      return res.status(404).json({ error: "Setting not found" });
    }
    res.json(setting);
  } catch (error) {
    log.error(`Error fetching setting ${req.params.key}:`, "systems", error);
    res.status(500).json({ error: "Failed to fetch setting" });
  }
});

// PUT /api/settings/:key - Update a specific setting
router.put("/settings/:key", async (req: Request, res: Response) => {
  try {
    const { key } = req.params;
    const { value } = req.body;

    if (!isAllowedSetting(key)) {
      return res.status(400).json({
        error: `Unknown setting key. Allowed: ${ALLOWED_SETTINGS.join(', ')}`
      });
    }

    if (value === undefined) {
      return res.status(400).json({ error: "Value is required" });
    }

    await db.run(
      `INSERT INTO backend_settings (setting_key, setting_value, updated_at)
       VALUES ($1, $2, CURRENT_TIMESTAMP)
       ON CONFLICT (setting_key)
       DO UPDATE SET setting_value = $2, updated_at = CURRENT_TIMESTAMP`,
      [key, value.toString()]
    );

    log.info(`Backend setting updated: ${key}=${value}`, "systems");
    res.json({ success: true, key, value });
  } catch (error) {
    log.error(`Error updating setting ${req.params.key}:`, "systems", error);
    res.status(500).json({ error: "Failed to update setting" });
  }
});

export default router;
