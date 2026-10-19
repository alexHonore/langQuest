/**
 * Stored manifests (ADR-004, migration 100): the API writes `course_manifests` / `audio_collection_manifests` on
 * publish / unpublish / structural change (service role) and serves the stored, published copy to learners
 * (RLS: published versions only), falling back to a live build when none is stored yet. A new version is stored
 * only when the content checksum changed; the edge cache is purged through `manifest.invalidated` separately.
 */
import { getCourseTrack, isSourceLanguageCode, type CourseTrackId, type SourceLanguageCode } from '@langquest/contracts';
import type { DbClient } from '@langquest/db/client';
import type { Row } from '@langquest/db/types';
import { nextManifestVersion } from '@langquest/media/manifests';
import { buildAudioManifest } from './audio-manifest';
import type { RequestServices } from '../services/context';

export interface StoredManifestOutcome {
  version: number;
  checksum: string;
  changed: boolean;
}

/** Build the course manifest for (track, source) from published rows and store it when its checksum changed. */
export async function storeCourseManifest(s: RequestServices, courseTrackId: CourseTrackId, sourceLanguageCode: SourceLanguageCode): Promise<StoredManifestOutcome> {
  const built = await s.repos.curriculum.buildManifest(courseTrackId, sourceLanguageCode, getCourseTrack(courseTrackId).targetVarietyId);
  const previous = await s.repos.manifests.getLatestCourseManifest(courseTrackId, sourceLanguageCode, { includeUnpublished: true });
  const changed = !previous || previous.checksum !== built.checksum;
  if (!changed) return { version: previous.version, checksum: previous.checksum, changed: false };
  const version = nextManifestVersion(previous?.version ?? null);
  const manifest = { ...built, version };
  await s.repos.manifests.putManifest({ kind: 'course', courseTrackId, sourceLanguageCode }, { version, checksum: built.checksum, manifest: manifest as unknown as Record<string, unknown>, publishedAt: new Date().toISOString() });
  return { version, checksum: built.checksum, changed: true };
}

/**
 * Source languages worth storing for a track: every source that already has a stored manifest plus every source
 * whose coverage row says the pair is being localized (`partial` / `complete`). Planned pairs are built live on demand.
 */
export async function courseManifestSources(s: RequestServices, courseTrackId: CourseTrackId, explicit: SourceLanguageCode | null): Promise<SourceLanguageCode[]> {
  if (explicit) return [explicit];
  const [stored, coverage] = await Promise.all([
    s.service.from('course_manifests').select('source_language_code').eq('course_track_id', courseTrackId),
    s.service.from('course_source_localizations').select('source_language_code, status').eq('course_track_id', courseTrackId).in('status', ['partial', 'complete']),
  ]);
  const out = new Set<SourceLanguageCode>();
  for (const r of [...(stored.data ?? []), ...(coverage.data ?? [])]) if (isSourceLanguageCode(r.source_language_code)) out.add(r.source_language_code);
  return [...out];
}

/** Store (when changed) the course manifests of a track for the relevant sources; never throws into the request path. */
export async function refreshCourseManifests(s: RequestServices, courseTrackId: CourseTrackId, sourceLanguageCode: SourceLanguageCode | null): Promise<void> {
  try {
    for (const source of await courseManifestSources(s, courseTrackId, sourceLanguageCode)) {
      const outcome = await storeCourseManifest(s, courseTrackId, source);
      s.log.info('manifest.stored', { kind: 'course', courseTrackId, sourceLanguageCode: source, ...outcome });
    }
  } catch (error) {
    s.log.error('manifest.store_failed', { kind: 'course', courseTrackId, error });
  }
}

/** Build the audio collection manifest from the service client and store it when its checksum changed. */
export async function storeAudioCollectionManifest(s: RequestServices, collection: Row<'audio_course_collections'>, db: DbClient = s.service): Promise<StoredManifestOutcome> {
  const built = await buildAudioManifest(s, db, collection);
  const lang = collection.instruction_language_code;
  const previous = await s.repos.manifests.getLatestAudioCollectionManifest(collection.id, lang, { includeUnpublished: true });
  const changed = !previous || previous.checksum !== built.checksum;
  if (!changed) return { version: previous.version, checksum: previous.checksum, changed: false };
  const version = nextManifestVersion(previous?.version ?? null);
  const manifest = { ...built, version };
  await s.repos.manifests.putManifest({ kind: 'audio_collection', collectionId: collection.id, instructionLanguageCode: lang }, { version, checksum: built.checksum, manifest: manifest as unknown as Record<string, unknown>, publishedAt: collection.state === 'published' ? new Date().toISOString() : null });
  return { version, checksum: built.checksum, changed: true };
}

export async function refreshAudioCollectionManifest(s: RequestServices, collectionId: string): Promise<void> {
  try {
    const collection = await s.repos.audioLibrary.getCollection(collectionId);
    if (!collection) return;
    const outcome = await storeAudioCollectionManifest(s, collection);
    s.log.info('manifest.stored', { kind: 'audio_collection', collectionId, ...outcome });
  } catch (error) {
    s.log.error('manifest.store_failed', { kind: 'audio_collection', collectionId, error });
  }
}
