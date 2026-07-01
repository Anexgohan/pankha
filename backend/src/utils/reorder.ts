import { PoolClient } from 'pg';

/**
 * Renumber `sort_order` for the given rows so they match the order of `orderedIds`
 * (0-based). Scoped by `system_id` so a stray id from another system can't be written.
 * One statement via unnest(); runs inside the caller's transaction. Shared by the
 * sensor and virtual-sensor reorder endpoints (both keyed by numeric id).
 */
export async function reorderRows(
  client: PoolClient,
  table: 'sensors' | 'virtual_sensors',
  systemId: number,
  orderedIds: number[],
): Promise<void> {
  if (orderedIds.length === 0) return;
  const positions = orderedIds.map((_, i) => i);
  await client.query(
    `UPDATE ${table} AS t
        SET sort_order = v.ord, updated_at = CURRENT_TIMESTAMP
       FROM unnest($1::int[], $2::int[]) AS v(id, ord)
      WHERE t.id = v.id AND t.system_id = $3`,
    [orderedIds, positions, systemId],
  );
}
