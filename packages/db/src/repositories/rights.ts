/**
 * Content rights (§7.6, §9.9) and media assets. Only editors may write; learners never read rights rows.
 *
 * `media_assets` exposes `owner_id`, `legacy_filename` and `legacy_path` to staff only (070_rls.sql §8,
 * column-level grants). Learner/anon/editor JWTs therefore read the table by named columns
 * (`MEDIA_ASSET_COLUMNS`); full rows come from the `media_assets_staff` view, which serves staff JWTs
 * and the service role and is empty for everyone else.
 */
import type { DbClient } from '../client';
import { unwrap, unwrapMaybe } from '../errors';
import { clampLimit, type FnReturns, type Insert, type PageQuery, type PageResult, type Row, type Update } from '../types';

/** Columns of `media_assets` granted to `anon`/`authenticated` (every column except the staff-only three). */
export const MEDIA_ASSET_COLUMNS =
  'id, storage_key, bucket, kind, checksum_sha256, mime_type, byte_length, duration_ms, channels, sample_rate_hz, bitrate_kbps, source_asset_id, derivation, visibility, content_rights_id, disposition, state, etag, created_at, updated_at' as const;
/** A media asset as learners and editors see it through the table (no owner / import-path columns). */
export type MediaAssetRow = Omit<
  Row<'media_assets'>,
  'owner_id' | 'legacy_filename' | 'legacy_path'
>;

export interface RightsListFilter extends PageQuery {
  /** Case-insensitive substring of `license_id`, `permission_grant`, `attribution_text` or `origin_url`. */
  q?: string;
  verified?: boolean;
  /** `true` = only revoked rows, `false` = only active rows. */
  revoked?: boolean;
  /** ISO timestamp: rows whose `expires_at` is before it (and set). */
  expiringBefore?: string;
  licenseId?: string;
}

/** Tables that reference a `content_rights` row (`content_rights_id`, or `license_id` for visual assets). */
export const RIGHTS_DEPENDENT_TABLES = ['audio_lessons', 'audio_course_collections', 'media_assets', 'expressions', 'lesson_courses', 'speakers', 'visual_assets'] as const;
export type RightsDependentTable = (typeof RIGHTS_DEPENDENT_TABLES)[number];
export interface RightsUsage {
  entityTable: RightsDependentTable;
  entityId: string;
  /** Publication state (`content_state`), or `review_status` for visual assets / `consent_state` for speakers. */
  state: string;
}
export type RevokeRightsResult = FnReturns<'revoke_content_rights'>[number];

export interface RightsRepository {
  getById(id: string): Promise<Row<'content_rights'> | null>;
  getByIds(ids: string[]): Promise<Row<'content_rights'>[]>;
  /** Paged admin listing (`adminContentRightsList`). */
  list(filter?: RightsListFilter): Promise<PageResult<Row<'content_rights'>>>;
  /** Every entity pointing at the grant, with its current state — the `usedBy` of the admin DTO. */
  listUsages(rightsId: string): Promise<RightsUsage[]>;
  /**
   * `revoke_content_rights` RPC (migration 120): stamps `revoked_at`, unpublishes dependents, revokes offline
   * packs — one transaction. Editor JWTs act as themselves; the service role must pass `actorId`.
   */
  revoke(rightsId: string, opts: { reason: 'rights_revoked' | 'takedown' | 'expired' | 'other'; note?: string | null; actorId?: string | null }): Promise<RevokeRightsResult[]>;
  create(row: Insert<'content_rights'>): Promise<Row<'content_rights'>>;
  update(id: string, patch: Update<'content_rights'>): Promise<Row<'content_rights'>>;
  /** True only when verified, not revoked, not expired and redistribution is permitted. */
  isPublishable(id: string, now?: Date): Promise<boolean>;
  listAttributions(): Promise<Row<'content_rights'>[]>;
  getAsset(id: string): Promise<MediaAssetRow | null>;
  findAssetByChecksum(checksum: string): Promise<MediaAssetRow | null>;
  /** Editors (JWT) or the service role. The returned row omits the staff-only columns even when they were written. */
  insertAsset(row: Insert<'media_assets'>): Promise<MediaAssetRow>;
  updateAsset(id: string, patch: Update<'media_assets'>): Promise<MediaAssetRow>;
  listAssets(filter?: {
    state?: Row<'media_assets'>['state'];
    kind?: Row<'media_assets'>['kind'];
    limit?: number;
  }): Promise<MediaAssetRow[]>;
  /** Full row (incl. `owner_id`, `legacy_*`) via `media_assets_staff`: staff JWTs and the service role only, else null. */
  getAssetStaff(id: string): Promise<Row<'media_assets'> | null>;
  /** Full rows via `media_assets_staff` (staff JWTs and the service role; empty for everyone else). */
  listAssetsStaff(filter?: {
    state?: Row<'media_assets'>['state'];
    kind?: Row<'media_assets'>['kind'];
    ownerId?: string;
    limit?: number;
  }): Promise<Row<'media_assets'>[]>;
  // --- staff/service lookups added for the jobs runner and admin (migration 100, cross-package gaps) ---
  /**
   * Every LOGICAL asset that points at one physical blob (`storage_key` is no longer unique, §7.2):
   * oldest first. Full rows via `media_assets_staff`; empty for non-staff JWTs.
   */
  listAssetsStaffByStorageKey(storageKey: string): Promise<Row<'media_assets'>[]>;
  /** Oldest logical asset for a blob, or null. */
  findAssetStaffByStorageKey(storageKey: string): Promise<Row<'media_assets'> | null>;
  findAssetStaffByLegacyPath(legacyPath: string): Promise<Row<'media_assets'> | null>;
  /** All assets sharing a content hash (dedupe candidates), oldest first. */
  listAssetsStaffByChecksum(checksum: string): Promise<Row<'media_assets'>[]>;
  /** Assets whose `legacy_path` or `storage_key` starts with `prefix` (explicit columns only). */
  listAssetsStaffByPrefix(prefix: string, limit?: number): Promise<Pick<Row<'media_assets'>, 'id' | 'legacy_path' | 'storage_key' | 'checksum_sha256' | 'disposition'>[]>;
  /** Derivatives of a master (`source_asset_id = id`), active only unless `includeInactive`. */
  listDerivedAssetsStaff(sourceAssetId: string, opts?: { includeInactive?: boolean }): Promise<Row<'media_assets'>[]>;
}

/** Escapes `%` and `_` for a PostgREST `like` prefix match. */
export const escapeLikePrefix = (prefix: string): string => prefix.replace(/[\\%_]/g, (m) => `\\${m}`);

/** Pure publishability rule shared with tests and the API publish checklist. */
export function rightsAllowPublishing(
  r: Pick<
    Row<'content_rights'>,
    'verified' | 'revoked_at' | 'expires_at' | 'commercial_redistribution'
  >,
  now = new Date(),
): boolean {
  if (!r.verified) return false;
  if (r.revoked_at) return false;
  if (r.expires_at && new Date(r.expires_at).getTime() <= now.getTime()) return false;
  return r.commercial_redistribution;
}

const escapeLike = (s: string): string => s.replace(/[\\%_,()]/g, (m) => `\\${m}`);

export function rightsRepository(db: DbClient): RightsRepository {
  return {
    async getById(id) {
      return unwrapMaybe(
        await db.from('content_rights').select('*').eq('id', id).single(),
        'rights.getById',
      );
    },
    async getByIds(ids) {
      return ids.length ? unwrap(await db.from('content_rights').select('*').in('id', ids), 'rights.getByIds') : [];
    },
    async list(filter) {
      const limit = clampLimit(filter?.limit);
      let q = db.from('content_rights').select('*').order('created_at').order('id').limit(limit + 1);
      if (filter?.verified !== undefined) q = q.eq('verified', filter.verified);
      if (filter?.revoked === true) q = q.not('revoked_at', 'is', null);
      if (filter?.revoked === false) q = q.is('revoked_at', null);
      if (filter?.expiringBefore) q = q.lt('expires_at', filter.expiringBefore);
      if (filter?.licenseId) q = q.eq('license_id', filter.licenseId);
      if (filter?.q) {
        const term = `%${escapeLike(filter.q)}%`;
        q = q.or(`license_id.ilike.${term},permission_grant.ilike.${term},attribution_text.ilike.${term},origin_url.ilike.${term}`);
      }
      if (filter?.cursor) q = q.gt('created_at', filter.cursor);
      const rows = unwrap(await q, 'rights.list');
      const items = rows.slice(0, limit);
      return { items, nextCursor: rows.length > limit ? (items[items.length - 1]?.created_at ?? null) : null };
    },
    async listUsages(rightsId) {
      const [lessons, collections, media, expressions, courses, speakers, visuals] = await Promise.all([
        db.from('audio_lessons').select('id, state').eq('content_rights_id', rightsId),
        db.from('audio_course_collections').select('id, state').eq('content_rights_id', rightsId),
        db.from('media_assets').select('id, state').eq('content_rights_id', rightsId),
        db.from('expressions').select('id, state').eq('content_rights_id', rightsId),
        db.from('lesson_courses').select('id, state').eq('content_rights_id', rightsId),
        db.from('speakers').select('id, consent_state').eq('content_rights_id', rightsId),
        db.from('visual_assets').select('id, review_status').eq('license_id', rightsId),
      ]);
      const usages: RightsUsage[] = [];
      for (const r of unwrap(lessons, 'rights.listUsages.audio_lessons')) usages.push({ entityTable: 'audio_lessons', entityId: r.id, state: r.state });
      for (const r of unwrap(collections, 'rights.listUsages.audio_course_collections')) usages.push({ entityTable: 'audio_course_collections', entityId: r.id, state: r.state });
      for (const r of unwrap(media, 'rights.listUsages.media_assets')) usages.push({ entityTable: 'media_assets', entityId: r.id, state: r.state });
      for (const r of unwrap(expressions, 'rights.listUsages.expressions')) usages.push({ entityTable: 'expressions', entityId: r.id, state: r.state });
      for (const r of unwrap(courses, 'rights.listUsages.lesson_courses')) usages.push({ entityTable: 'lesson_courses', entityId: r.id, state: r.state });
      for (const r of unwrap(speakers, 'rights.listUsages.speakers')) usages.push({ entityTable: 'speakers', entityId: r.id, state: r.consent_state });
      for (const r of unwrap(visuals, 'rights.listUsages.visual_assets')) usages.push({ entityTable: 'visual_assets', entityId: r.id, state: r.review_status });
      return usages;
    },
    async revoke(rightsId, opts) {
      const args: { p_rights_id: string; p_reason: string; p_note?: string; p_actor_id?: string } = { p_rights_id: rightsId, p_reason: opts.reason };
      if (opts.note) args.p_note = opts.note;
      if (opts.actorId) args.p_actor_id = opts.actorId;
      return unwrap(await db.rpc('revoke_content_rights', args), 'rights.revoke');
    },
    async create(row) {
      return unwrap(
        await db.from('content_rights').insert(row).select('*').single(),
        'rights.create',
      );
    },
    async update(id, patch) {
      return unwrap(
        await db.from('content_rights').update(patch).eq('id', id).select('*').single(),
        'rights.update',
      );
    },
    async isPublishable(id, now) {
      const r = unwrapMaybe(
        await db
          .from('content_rights')
          .select('verified, revoked_at, expires_at, commercial_redistribution')
          .eq('id', id)
          .single(),
        'rights.isPublishable',
      );
      return r ? rightsAllowPublishing(r, now) : false;
    },
    async listAttributions() {
      return unwrap(
        await db
          .from('content_rights')
          .select('*')
          .eq('attribution_required', true)
          .eq('verified', true)
          .is('revoked_at', null),
        'rights.listAttributions',
      );
    },
    async getAsset(id) {
      return unwrapMaybe(
        await db.from('media_assets').select(MEDIA_ASSET_COLUMNS).eq('id', id).single(),
        'rights.getAsset',
      );
    },
    async findAssetByChecksum(checksum) {
      return unwrapMaybe(
        await db
          .from('media_assets')
          .select(MEDIA_ASSET_COLUMNS)
          .eq('checksum_sha256', checksum)
          .limit(1)
          .maybeSingle(),
        'rights.findAssetByChecksum',
      );
    },
    async insertAsset(row) {
      return unwrap(
        await db.from('media_assets').insert(row).select(MEDIA_ASSET_COLUMNS).single(),
        'rights.insertAsset',
      );
    },
    async updateAsset(id, patch) {
      return unwrap(
        await db
          .from('media_assets')
          .update(patch)
          .eq('id', id)
          .select(MEDIA_ASSET_COLUMNS)
          .single(),
        'rights.updateAsset',
      );
    },
    async listAssets(filter) {
      let q = db
        .from('media_assets')
        .select(MEDIA_ASSET_COLUMNS)
        .order('created_at', { ascending: false })
        .limit(filter?.limit ?? 100);
      if (filter?.state) q = q.eq('state', filter.state);
      if (filter?.kind) q = q.eq('kind', filter.kind);
      return unwrap(await q, 'rights.listAssets');
    },
    async getAssetStaff(id) {
      // The view is `select *` over the table; generated view types lose NOT NULL, hence the casts.
      return unwrapMaybe(
        await db.from('media_assets_staff').select('*').eq('id', id).maybeSingle(),
        'rights.getAssetStaff',
      ) as Row<'media_assets'> | null;
    },
    async listAssetsStaff(filter) {
      let q = db
        .from('media_assets_staff')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(filter?.limit ?? 100);
      if (filter?.state) q = q.eq('state', filter.state);
      if (filter?.kind) q = q.eq('kind', filter.kind);
      if (filter?.ownerId) q = q.eq('owner_id', filter.ownerId);
      return unwrap(await q, 'rights.listAssetsStaff') as Row<'media_assets'>[];
    },
    async listAssetsStaffByStorageKey(storageKey) {
      return unwrap(
        await db.from('media_assets_staff').select('*').eq('storage_key', storageKey).order('created_at'),
        'rights.listAssetsStaffByStorageKey',
      ) as Row<'media_assets'>[];
    },
    async findAssetStaffByStorageKey(storageKey) {
      const rows = unwrap(
        await db.from('media_assets_staff').select('*').eq('storage_key', storageKey).order('created_at').limit(1),
        'rights.findAssetStaffByStorageKey',
      ) as Row<'media_assets'>[];
      return rows[0] ?? null;
    },
    async findAssetStaffByLegacyPath(legacyPath) {
      const rows = unwrap(
        await db.from('media_assets_staff').select('*').eq('legacy_path', legacyPath).order('created_at').limit(1),
        'rights.findAssetStaffByLegacyPath',
      ) as Row<'media_assets'>[];
      return rows[0] ?? null;
    },
    async listAssetsStaffByChecksum(checksum) {
      return unwrap(
        await db.from('media_assets_staff').select('*').eq('checksum_sha256', checksum).order('created_at'),
        'rights.listAssetsStaffByChecksum',
      ) as Row<'media_assets'>[];
    },
    async listAssetsStaffByPrefix(prefix, limit = 50_000) {
      const escaped = escapeLikePrefix(prefix);
      const columns = 'id, legacy_path, storage_key, checksum_sha256, disposition';
      type Picked = Pick<Row<'media_assets'>, 'id' | 'legacy_path' | 'storage_key' | 'checksum_sha256' | 'disposition'>;
      const [byPath, byKey] = await Promise.all([
        db.from('media_assets_staff').select(columns).like('legacy_path', `${escaped}%`).limit(limit),
        db.from('media_assets_staff').select(columns).like('storage_key', `${escaped}%`).limit(limit),
      ]);
      const seen = new Map<string, Picked>();
      for (const r of [...(unwrap(byPath, 'rights.listAssetsStaffByPrefix.path') as Picked[]), ...(unwrap(byKey, 'rights.listAssetsStaffByPrefix.key') as Picked[])]) seen.set(r.id, r);
      return [...seen.values()];
    },
    async listDerivedAssetsStaff(sourceAssetId, opts) {
      let q = db.from('media_assets_staff').select('*').eq('source_asset_id', sourceAssetId).order('created_at');
      if (!opts?.includeInactive) q = q.eq('disposition', 'active');
      return unwrap(await q, 'rights.listDerivedAssetsStaff') as Row<'media_assets'>[];
    },
  };
}
