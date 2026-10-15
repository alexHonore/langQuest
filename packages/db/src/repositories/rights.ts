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
import type { Insert, Row, Update } from '../types';

/** Columns of `media_assets` granted to `anon`/`authenticated` (every column except the staff-only three). */
export const MEDIA_ASSET_COLUMNS =
  'id, storage_key, bucket, kind, checksum_sha256, mime_type, byte_length, duration_ms, channels, sample_rate_hz, bitrate_kbps, source_asset_id, derivation, visibility, content_rights_id, disposition, state, etag, created_at, updated_at' as const;
/** A media asset as learners and editors see it through the table (no owner / import-path columns). */
export type MediaAssetRow = Omit<
  Row<'media_assets'>,
  'owner_id' | 'legacy_filename' | 'legacy_path'
>;

export interface RightsRepository {
  getById(id: string): Promise<Row<'content_rights'> | null>;
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
}

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

export function rightsRepository(db: DbClient): RightsRepository {
  return {
    async getById(id) {
      return unwrapMaybe(
        await db.from('content_rights').select('*').eq('id', id).single(),
        'rights.getById',
      );
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
  };
}
