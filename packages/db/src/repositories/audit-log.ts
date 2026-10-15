/** Append-only audit log (§5.5, §11). Written with the service client from server code paths. */
import type { DbClient } from '../client';
import { unwrap } from '../errors';
import type { Insert, Row } from '../types';

export interface AuditLogRepository {
  record(entry: Insert<'audit_logs'>): Promise<Row<'audit_logs'>>;
  listForEntity(entityTable: string, entityId: string, limit?: number): Promise<Row<'audit_logs'>[]>;
  listForActor(actorId: string, limit?: number): Promise<Row<'audit_logs'>[]>;
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
  };
}
