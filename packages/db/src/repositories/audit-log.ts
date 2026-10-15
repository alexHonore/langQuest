/** Append-only audit log (§5.5, §11). Written with the service client from server code paths. */
import type { DbClient } from '../client';
import { unwrap } from '../errors';
import type { Insert, Row } from '../types';

export interface AuditLogRepository {
  record(entry: Insert<'audit_logs'>): Promise<Row<'audit_logs'>>;
  listForEntity(entityTable: string, entityId: string, limit?: number): Promise<Row<'audit_logs'>[]>;
  listForActor(actorId: string, limit?: number): Promise<Row<'audit_logs'>[]>;
  listByAction(action: string, limit?: number): Promise<Row<'audit_logs'>[]>;
  /**
   * String values of `after -> field` for rows of `action` whose value starts with `prefix`
   * (e.g. object keys already processed by `import_r2_prefix.object`, field `key`).
   */
  listAfterValuesByPrefix(action: string, field: string, prefix: string, limit?: number): Promise<string[]>;
}

export function auditLogRepository(db: DbClient): AuditLogRepository {
  return {
    async record(entry) {
      return unwrap(await db.from('audit_logs').insert(entry).select('*').single(), 'audit.record');
    },
    async listForEntity(entityTable, entityId, limit = 100) {
      return unwrap(
        await db.from('audit_logs').select('*').eq('entity_table', entityTable).eq('entity_id', entityId).order('created_at', { ascending: false }).limit(limit),
        'audit.listForEntity',
      );
    },
    async listForActor(actorId, limit = 100) {
      return unwrap(await db.from('audit_logs').select('*').eq('actor_id', actorId).order('created_at', { ascending: false }).limit(limit), 'audit.listForActor');
    },
    async listByAction(action, limit = 100) {
      return unwrap(await db.from('audit_logs').select('*').eq('action', action).order('created_at', { ascending: false }).limit(limit), 'audit.listByAction');
    },
    async listAfterValuesByPrefix(action, field, prefix, limit = 100_000) {
      if (!/^[a-zA-Z0-9_]+$/.test(field)) throw new Error(`audit.listAfterValuesByPrefix: invalid field ${JSON.stringify(field)}`);
      const escaped = prefix.replace(/[\\%_]/g, (m) => `\\${m}`);
      const rows = unwrap(await db.from('audit_logs').select('after').eq('action', action).like(`after->>${field}`, `${escaped}%`).limit(limit), 'audit.listAfterValuesByPrefix');
      return rows.map((r) => (r.after as Record<string, unknown> | null)?.[field]).filter((v): v is string => typeof v === 'string');
    },
  };
}
