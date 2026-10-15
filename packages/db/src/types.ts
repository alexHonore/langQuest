/** Convenience aliases over the generated `Database` type. */
import type { Database } from './database.types';

export type PublicSchema = Database['public'];
export type TableName = keyof PublicSchema['Tables'] & string;
export type FunctionName = keyof PublicSchema['Functions'] & string;

export type Row<N extends TableName> = PublicSchema['Tables'][N]['Row'];
export type Insert<N extends TableName> = PublicSchema['Tables'][N]['Insert'];
export type Update<N extends TableName> = PublicSchema['Tables'][N]['Update'];
export type FnArgs<N extends FunctionName> = PublicSchema['Functions'][N]['Args'];
export type FnReturns<N extends FunctionName> = PublicSchema['Functions'][N]['Returns'];

/** Cursor pagination input used by list repositories. */
export interface PageQuery {
  /** Opaque cursor = `created_at` ISO of the last item seen. */
  cursor?: string | null;
  limit?: number;
}
export interface PageResult<T> {
  items: T[];
  nextCursor: string | null;
}

export const DEFAULT_PAGE_LIMIT = 50;
export const MAX_PAGE_LIMIT = 200;
export const clampLimit = (limit?: number): number => Math.max(1, Math.min(limit ?? DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT));
