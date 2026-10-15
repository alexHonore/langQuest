/**
 * Helpers to declare DB tables as Zod Row/Insert/Update schemas with snake_case columns,
 * uuid primary keys and timestamptz audit columns (CONVENTIONS §4).
 */
import { z } from 'zod';
import { TimestamptzSchema, UuidSchema } from '../primitives';

export const ID_COLUMN = { id: UuidSchema } as const;
export const CREATED_COLUMN = { created_at: TimestamptzSchema } as const;
export const UPDATED_COLUMN = { updated_at: TimestamptzSchema } as const;

/** Standard entity: `id uuid PK`, `created_at`, `updated_at`. */
export function defineTable<const Name extends string, Shape extends z.ZodRawShape>(name: Name, shape: Shape) {
  const row = z.object({ ...ID_COLUMN, ...CREATED_COLUMN, ...UPDATED_COLUMN, ...shape });
  const insert = row.partial({ id: true, created_at: true, updated_at: true });
  const update = row.omit({ id: true, created_at: true }).partial();
  return { name, row, insert, update, kind: 'entity' } as const;
}

/** Append-only ledger: `id uuid PK`, `created_at` only. No updates. */
export function defineLedgerTable<const Name extends string, Shape extends z.ZodRawShape>(name: Name, shape: Shape) {
  const row = z.object({ ...ID_COLUMN, ...CREATED_COLUMN, ...shape });
  const insert = row.partial({ id: true, created_at: true });
  return { name, row, insert, kind: 'ledger' } as const;
}

/** Table whose primary key is supplied by the caller (e.g. `profiles.user_id`, catalog slugs). */
export function defineKeyedTable<const Name extends string, Shape extends z.ZodRawShape>(name: Name, shape: Shape) {
  const row = z.object({ ...CREATED_COLUMN, ...UPDATED_COLUMN, ...shape });
  const insert = row.partial({ created_at: true, updated_at: true });
  const update = row.omit({ created_at: true }).partial();
  return { name, row, insert, update, kind: 'keyed' } as const;
}

export type AnyTable = { name: string; row: z.ZodObject; insert: z.ZodObject; kind: 'entity' | 'ledger' | 'keyed' };
export type RowOf<T extends { row: z.ZodType }> = z.infer<T['row']>;
export type InsertOf<T extends { insert: z.ZodType }> = z.infer<T['insert']>;
export type UpdateOf<T extends { update: z.ZodType }> = z.infer<T['update']>;
