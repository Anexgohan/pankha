import { Router, Request, Response } from 'express';
import { PoolClient } from 'pg';
import { Database } from '../database/database';
import { FanProfileController } from '../services/FanProfileController';
import { log } from '../utils/logger';
import { reorderRows } from '../utils/reorder';

const router = Router();
const db = Database.getInstance();

const VALID_OPERATIONS = ['max', 'avg', 'median'] as const;
const identifierFor = (id: number): string => `__virtual__${id}`;

/**
 * Normalize a sensor_ids payload into a unique list of numeric DB ids.
 */
function normalizeSensorIds(sensor_ids: unknown): number[] {
  if (!Array.isArray(sensor_ids)) return [];
  return [...new Set(sensor_ids.map(Number).filter((n) => Number.isInteger(n)))];
}

/**
 * Confirm every sensor id belongs to the given system.
 */
async function membersBelongToSystem(systemId: number, memberIds: number[]): Promise<boolean> {
  const row = await db.get(
    `SELECT COUNT(*)::int AS c FROM sensors WHERE id = ANY($1) AND system_id = $2`,
    [memberIds, systemId]
  );
  return !!row && row.c === memberIds.length;
}

/**
 * Look up the fans whose Control Sensor is this virtual sensor (via either
 * fan_configurations or fan_profile_assignments). Returns enough to clear the
 * control-loop state and to report usage to the UI.
 */
async function fansUsing(identifier: string): Promise<any[]> {
  return db.all(
    `SELECT f.fan_name,
            f.zone_id,
            COALESCE(f.fan_label, f.fan_name) AS fan_display,
            s.agent_id,
            s.name AS system_name
       FROM fans f
       JOIN systems s ON f.system_id = s.id
      WHERE f.id IN (
        SELECT fan_id FROM fan_configurations      WHERE sensor_identifier = $1
        UNION
        SELECT fan_id FROM fan_profile_assignments WHERE sensor_identifier = $1
      )`,
    [identifier]
  );
}

/**
 * Clear cached hysteresis/stepping state so a changed definition takes effect
 * on the next control tick. For zone-based (IPMI) fans the loop keys on zone_id.
 */
function clearFanStates(fans: any[]): void {
  if (fans.length === 0) return;
  const controller = FanProfileController.getInstance();
  for (const f of fans) {
    controller.clearFanState(f.agent_id, f.zone_id || f.fan_name);
  }
}

/**
 * GET /api/virtual-sensors/:systemId
 * List a system's virtual sensors with their member sensor ids/names.
 */
router.get('/:systemId', async (req: Request, res: Response) => {
  try {
    const systemId = parseInt(req.params.systemId);
    if (isNaN(systemId)) return res.status(400).json({ success: false, error: 'Invalid system ID' });
    const sensors = await db.all(
      `SELECT id, system_id, name, operation, sort_order
         FROM virtual_sensors
        WHERE system_id = $1
        ORDER BY COALESCE(sort_order, 2147483647), id`,
      [systemId]
    );

    if (sensors.length > 0) {
      const ids = sensors.map((s) => s.id);
      const members = await db.all(
        `SELECT vm.virtual_sensor_id, vm.sensor_id, s.sensor_name
           FROM virtual_sensor_members vm
           JOIN sensors s ON vm.sensor_id = s.id
          WHERE vm.virtual_sensor_id = ANY($1)`,
        [ids]
      );
      const byVs = new Map<number, { sensor_id: number; sensor_name: string }[]>();
      for (const m of members) {
        const arr = byVs.get(m.virtual_sensor_id) || [];
        arr.push({ sensor_id: m.sensor_id, sensor_name: m.sensor_name });
        byVs.set(m.virtual_sensor_id, arr);
      }
      for (const s of sensors) s.members = byVs.get(s.id) || [];
    }

    res.json({ success: true, data: sensors, count: sensors.length });
  } catch (error) {
    log.error('Error fetching virtual sensors', 'virtualSensors', error);
    res.status(500).json({ success: false, error: 'Failed to fetch virtual sensors' });
  }
});

/**
 * GET /api/virtual-sensors/:id/usage
 * Fans currently controlled by this virtual sensor (for the delete confirmation).
 */
router.get('/:id/usage', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid id' });
    const fans = await fansUsing(identifierFor(id));
    res.json({
      success: true,
      data: fans.map((f) => ({ fan: f.fan_display, system: f.system_name })),
    });
  } catch (error) {
    log.error('Error fetching virtual sensor usage', 'virtualSensors', error);
    res.status(500).json({ success: false, error: 'Failed to fetch usage' });
  }
});

/**
 * POST /api/virtual-sensors
 * Body: { system_id, name, operation: 'max'|'avg', sensor_ids: number[] }
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const { system_id, name, operation = 'max', sensor_ids } = req.body;
    const trimmedName = typeof name === 'string' ? name.trim() : '';

    if (!system_id) return res.status(400).json({ success: false, error: 'Missing system_id' });
    if (!trimmedName) return res.status(400).json({ success: false, error: 'Name is required' });
    if (!VALID_OPERATIONS.includes(operation)) {
      return res.status(400).json({ success: false, error: 'Invalid operation (expected max|avg)' });
    }
    const memberIds = normalizeSensorIds(sensor_ids);
    if (memberIds.length < 2) {
      return res.status(400).json({ success: false, error: 'Select at least 2 sensors' });
    }
    if (!(await membersBelongToSystem(system_id, memberIds))) {
      return res.status(400).json({ success: false, error: 'One or more sensors do not belong to this system' });
    }

    const newId = await db.transaction(async (client: PoolClient) => {
      const vs = await client.query(
        `INSERT INTO virtual_sensors (system_id, name, operation) VALUES ($1, $2, $3) RETURNING id`,
        [system_id, trimmedName, operation]
      );
      const vsId = vs.rows[0].id;
      for (const sid of memberIds) {
        await client.query(
          `INSERT INTO virtual_sensor_members (virtual_sensor_id, sensor_id) VALUES ($1, $2)`,
          [vsId, sid]
        );
      }
      return vsId;
    });

    log.info(`Virtual sensor created: "${trimmedName}" (${operation}) system ${system_id}, ${memberIds.length} members`, 'virtualSensors');
    res.json({ success: true, data: { id: newId, system_id, name: trimmedName, operation, members: memberIds } });
  } catch (error: any) {
    if (error?.code === '23505') {
      return res.status(409).json({ success: false, error: 'A virtual sensor with that name already exists on this system' });
    }
    log.error('Error creating virtual sensor', 'virtualSensors', error);
    res.status(500).json({ success: false, error: 'Failed to create virtual sensor' });
  }
});

/**
 * PUT /api/virtual-sensors/order
 * Body: { systemId, orderedIds: number[] } - virtual-sensor ids in their new order.
 * Registered before PUT /:id so the literal '/order' wins under Express 5.
 */
router.put('/order', async (req: Request, res: Response) => {
  try {
    const systemId = parseInt(req.body?.systemId);
    if (isNaN(systemId)) return res.status(400).json({ success: false, error: 'Invalid systemId' });
    const orderedIds = normalizeSensorIds(req.body?.orderedIds);
    await db.transaction(async (client: PoolClient) => {
      await reorderRows(client, 'virtual_sensors', systemId, orderedIds);
    });
    res.json({ success: true, data: { count: orderedIds.length } });
  } catch (error) {
    log.error('Error updating virtual sensor order', 'virtualSensors', error);
    res.status(500).json({ success: false, error: 'Failed to update virtual sensor order' });
  }
});

/**
 * PUT /api/virtual-sensors/:id
 * Body: { name?, operation?, sensor_ids? } - any subset.
 */
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid id' });
    const existing = await db.get(`SELECT id, system_id FROM virtual_sensors WHERE id = $1`, [id]);
    if (!existing) return res.status(404).json({ success: false, error: 'Virtual sensor not found' });

    const { name, operation, sensor_ids } = req.body;
    const sets: string[] = [];
    const vals: any[] = [];
    let p = 1;

    if (typeof name === 'string') {
      const t = name.trim();
      if (!t) return res.status(400).json({ success: false, error: 'Name cannot be empty' });
      sets.push(`name = $${p++}`);
      vals.push(t);
    }
    if (operation !== undefined) {
      if (!VALID_OPERATIONS.includes(operation)) {
        return res.status(400).json({ success: false, error: 'Invalid operation (expected max|avg)' });
      }
      sets.push(`operation = $${p++}`);
      vals.push(operation);
    }

    let memberIds: number[] | null = null;
    if (sensor_ids !== undefined) {
      memberIds = normalizeSensorIds(sensor_ids);
      if (memberIds.length < 2) {
        return res.status(400).json({ success: false, error: 'Select at least 2 sensors' });
      }
      if (!(await membersBelongToSystem(existing.system_id, memberIds))) {
        return res.status(400).json({ success: false, error: 'One or more sensors do not belong to this system' });
      }
    }

    if (sets.length === 0 && memberIds === null) {
      return res.status(400).json({ success: false, error: 'Nothing to update' });
    }

    await db.transaction(async (client: PoolClient) => {
      if (sets.length > 0) {
        vals.push(id);
        await client.query(
          `UPDATE virtual_sensors SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${p}`,
          vals
        );
      }
      if (memberIds) {
        await client.query(`DELETE FROM virtual_sensor_members WHERE virtual_sensor_id = $1`, [id]);
        for (const sid of memberIds) {
          await client.query(
            `INSERT INTO virtual_sensor_members (virtual_sensor_id, sensor_id) VALUES ($1, $2)`,
            [id, sid]
          );
        }
      }
    });

    clearFanStates(await fansUsing(identifierFor(id)));
    log.info(`Virtual sensor ${id} updated`, 'virtualSensors');
    res.json({ success: true, data: { id } });
  } catch (error: any) {
    if (error?.code === '23505') {
      return res.status(409).json({ success: false, error: 'A virtual sensor with that name already exists on this system' });
    }
    log.error('Error updating virtual sensor', 'virtualSensors', error);
    res.status(500).json({ success: false, error: 'Failed to update virtual sensor' });
  }
});

/**
 * DELETE /api/virtual-sensors/:id
 * Unassigns any fans using it (the string identifier has no FK), then deletes
 * (members cascade). Returns the list of unassigned fans.
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid id' });
    const existing = await db.get(`SELECT id, name FROM virtual_sensors WHERE id = $1`, [id]);
    if (!existing) return res.status(404).json({ success: false, error: 'Virtual sensor not found' });

    const identifier = identifierFor(id);
    const affected = await fansUsing(identifier); // capture before we null the references

    await db.transaction(async (client: PoolClient) => {
      await client.query(
        `UPDATE fan_configurations SET sensor_identifier = NULL, updated_at = CURRENT_TIMESTAMP WHERE sensor_identifier = $1`,
        [identifier]
      );
      await client.query(
        `UPDATE fan_profile_assignments SET sensor_identifier = NULL WHERE sensor_identifier = $1`,
        [identifier]
      );
      await client.query(`DELETE FROM virtual_sensors WHERE id = $1`, [id]); // members cascade
    });

    clearFanStates(affected);
    log.info(`Virtual sensor ${id} ("${existing.name}") deleted; unassigned ${affected.length} fan(s)`, 'virtualSensors');
    res.json({
      success: true,
      data: { id, unassigned_fans: affected.map((f) => ({ fan: f.fan_display, system: f.system_name })) },
    });
  } catch (error) {
    log.error('Error deleting virtual sensor', 'virtualSensors', error);
    res.status(500).json({ success: false, error: 'Failed to delete virtual sensor' });
  }
});

export default router;
