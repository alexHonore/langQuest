/**
 * @langquest/contracts — single source of truth for shared types.
 *
 * Flat re-exports for the common modules; `db`, `api` and `ai` are also available as
 * namespaces to avoid collisions (e.g. `db.VisualAssetsTable` vs `VisualAssetSchema`).
 */
export * from './primitives';
export * from './enums';
export * from './catalog';
export * from './language-context';
export * from './srs';
export * from './manifest';
export * from './visual';
export * from './events';
export * from './telemetry';
export * from './ai';
export * from './api';
export * from './db';

export * as db from './db';
export * as api from './api';
export * as ai from './ai';
