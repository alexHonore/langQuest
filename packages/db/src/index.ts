/**
 * @langquest/db — typed Supabase access for LangQuest (ADR-003).
 *
 * - Client factories: `createServiceClient`, `createUserClient` (JWT forwarded → RLS), `createAnonClient`.
 * - Generated `Database` types (`src/database.types.ts`, `pnpm --filter @langquest/db gen-types`).
 * - Repositories per domain (`createRepositories(db)`).
 * - Local stack helpers for tests (`src/local-stack.ts`).
 */
export * from './client';
export * from './env';
export * from './errors';
export * from './types';
export * from './character-uuid';
export * from './repositories';
export * from './local-stack';
export type { Database, Json } from './database.types';
