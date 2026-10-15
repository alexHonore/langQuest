/**
 * Per-request wiring of `@langquest/ai` (§8.2): model profiles come from `ai_model_profiles` (admin-editable,
 * no mobile rebuild — A25), requests are logged to `ai_requests`, learner audio assets resolve through R2 with
 * an ownership check, and approved TTS output is cached by content hash in R2.
 */
import { createAiServices, type AiServices } from '@langquest/ai';
import type { ModelProfile, AudioEncoding, AudioOutput } from '@langquest/contracts';
import { ModelProfileSchema } from '@langquest/contracts';
import type { DbClient } from '@langquest/db/client';
import type { Row } from '@langquest/db/types';
import { pseudonymizeLearnerId } from '@langquest/telemetry/privacy';
import type { AudioAssetResolver } from '@langquest/ai/speech/audio-input';
import type { TtsCache } from '@langquest/ai/speech/tts';
import type { ApiEnv } from '../env';
import { problem } from '../http/envelope';
import type { Logger } from '../middleware/logging';
import type { MediaStore } from './r2';
import { createAiRequestSink, createIncidentSink } from './telemetry';

const PROFILE_CACHE_TTL_MS = 60_000;
let profileCache: { loadedAt: number; profiles: ModelProfile[]; ids: Set<string> } | null = null;

/** Map an `ai_model_profiles` row onto the contracts `ModelProfile`; invalid rows are skipped (logged). */
export function rowToModelProfile(row: Row<'ai_model_profiles'>): ModelProfile | null {
  const parsed = ModelProfileSchema.safeParse({
    id: row.id,
    task: row.task,
    targetVariety: row.target_variety_id,
    sourceLanguage: row.source_language_code,
    provider: row.provider,
    primaryModel: row.primary_model,
    fallbackModels: row.fallback_models,
    params: row.params ?? {},
    latencyClass: row.latency_class,
    enabled: row.enabled,
    version: row.version,
    benchmarkStatus: row.benchmark_status,
    dailyBudgetUsd: row.daily_budget_usd,
    updatedAt: row.updated_at,
  });
  return parsed.success ? parsed.data : null;
}

/** Load (cached per isolate) the DB profiles; failures fall back to the package defaults. */
export async function loadDbProfiles(service: DbClient, log: Logger, force = false): Promise<{ profiles: ModelProfile[]; ids: Set<string> }> {
  if (!force && profileCache && Date.now() - profileCache.loadedAt < PROFILE_CACHE_TTL_MS) return profileCache;
  const res = await service.from('ai_model_profiles').select('*');
  if (res.error) {
    log.error('ai.profiles_load_failed', { error: res.error.message });
    return profileCache ?? { profiles: [], ids: new Set() };
  }
  const profiles: ModelProfile[] = [];
  for (const row of res.data ?? []) {
    const p = rowToModelProfile(row);
    if (p) profiles.push(p);
    else log.warn('ai.profile_invalid', { id: row.id, task: row.task });
  }
  profileCache = { loadedAt: Date.now(), profiles, ids: new Set(profiles.map((p) => p.id)) };
  return profileCache;
}

/**
 * Rows handed to the registry overlay. Only ENABLED rows override the package defaults: the catalog seed ships
 * every `ai_model_profiles` row disabled until an admin runs smoke tests (§8.7), and a disabled row for the global
 * scope must not erase the default route for that task (that would turn every AI feature off).
 * Admin-reviewed overrides therefore win as soon as they are enabled; nothing else changes routing.
 */
export function overlayProfiles(profiles: readonly ModelProfile[]): ModelProfile[] {
  return profiles.filter((p) => p.enabled);
}

export const invalidateProfileCache = (): void => {
  profileCache = null;
};

export const encodingForMime = (mime: string): AudioEncoding => {
  const m = mime.toLowerCase();
  if (m.includes('mpeg') || m.includes('mp3')) return 'mp3';
  if (m.includes('mp4') || m.includes('m4a')) return 'm4a';
  if (m.includes('wav')) return 'wav';
  if (m.includes('flac')) return 'flac';
  if (m.includes('webm')) return 'webm_opus';
  if (m.includes('ogg') || m.includes('opus')) return 'opus';
  if (m.includes('aac')) return 'aac';
  return 'pcm16';
};

export interface AiWiringDeps {
  env: ApiEnv;
  service: DbClient;
  media: MediaStore;
  log: Logger;
  waitUntil: (p: Promise<unknown>) => void;
  userId: string | null;
  sessionId?: string | null;
  fetch?: typeof fetch;
}

/** Resolve learner-owned (or published-lesson) audio assets for STT/pronunciation adapters. */
export function createAssetResolver(deps: Pick<AiWiringDeps, 'service' | 'media' | 'userId'>): AudioAssetResolver {
  return {
    async resolve(assetId) {
      const res = await deps.service.from('media_assets').select('id, storage_key, mime_type, owner_id, disposition, state, visibility, sample_rate_hz').eq('id', assetId).maybeSingle();
      if (res.error) throw problem.internal('Could not read the audio asset');
      const asset = res.data;
      if (!asset || asset.disposition !== 'active') throw problem.notFound('Audio asset');
      const owned = deps.userId !== null && asset.owner_id === deps.userId;
      if (!owned && asset.state !== 'published') throw problem.forbidden('You can only submit recordings you own');
      const encoding = encodingForMime(asset.mime_type);
      if (deps.media.canPresign) return { url: await deps.media.presignGet(asset.storage_key, 300), encoding, sampleRateHz: asset.sample_rate_hz };
      const head = await deps.media.head(asset.storage_key);
      if (!head) throw problem.notFound('Audio object');
      const bytes = await deps.media.readBytes(asset.storage_key, 0, head.size - 1);
      if (!bytes) throw problem.notFound('Audio object');
      return { bytes, encoding, sampleRateHz: asset.sample_rate_hz };
    },
  };
}

/** R2-backed cache for approved TTS (shared across learners; never caches learner-personal input). */
export function createTtsCache(media: MediaStore, log: Logger): TtsCache {
  const keyFor = (cacheKey: string): string => `tts/${cacheKey.replace(/[^a-z0-9:]/gi, '_')}.json`;
  return {
    async get(key) {
      if (!media.available) return null;
      try {
        const head = await media.head(keyFor(key));
        if (!head) return null;
        const bytes = await media.readBytes(keyFor(key), 0, head.size - 1);
        if (!bytes) return null;
        const parsed = JSON.parse(new TextDecoder().decode(bytes)) as AudioOutput;
        return { ...parsed, cached: true };
      } catch (error) {
        log.warn('tts.cache_read_failed', { error });
        return null;
      }
    },
    async set(key, output) {
      if (!media.available) return;
      try {
        await media.put(keyFor(key), new TextEncoder().encode(JSON.stringify(output)), 'application/json');
      } catch (error) {
        log.warn('tts.cache_write_failed', { error });
      }
    },
  };
}

/** Build the AI services for this request. Throws `capability_unsupported` when OpenRouter is not configured. */
export async function buildAiServices(deps: AiWiringDeps): Promise<AiServices> {
  if (!deps.env.OPENROUTER_API_KEY) throw problem.unsupported('AI features are not configured on this deployment (OPENROUTER_API_KEY missing)');
  const loaded = await loadDbProfiles(deps.service, deps.log);
  const sink = createAiRequestSink({ service: deps.service, log: deps.log, waitUntil: deps.waitUntil, knownProfileIds: () => loaded.ids, defaultUserId: deps.userId });
  const salt = deps.env.AI_SESSION_TICKET_SECRET ?? deps.env.SUPABASE_ANON_KEY;
  return createAiServices(
    {
      OPENROUTER_API_KEY: deps.env.OPENROUTER_API_KEY,
      OPENROUTER_BASE_URL: deps.env.OPENROUTER_BASE_URL,
      AZURE_SPEECH_KEY: deps.env.AZURE_SPEECH_KEY,
      AZURE_SPEECH_REGION: deps.env.AZURE_SPEECH_REGION,
      AI_SESSION_TICKET_SECRET: deps.env.AI_SESSION_TICKET_SECRET,
      AI_REALTIME_CONNECT_URL: deps.env.AI_REALTIME_CONNECT_URL,
      AI_APP_NAME: 'LangQuest',
      AI_APP_REFERER: 'https://langquest.app',
    },
    {
      fetch: deps.fetch,
      logger: { debug: (e, f) => deps.log.debug(e, f), info: (e, f) => deps.log.info(e, f), warn: (e, f) => deps.log.warn(e, f), error: (e, f) => deps.log.error(e, f) },
      requestSink: sink,
      incidentSink: createIncidentSink({ service: deps.service, log: deps.log, waitUntil: deps.waitUntil }, { userId: deps.userId, sessionId: deps.sessionId ?? null }),
      profileLoader: { load: async () => overlayProfiles(loaded.profiles) },
      assetResolver: createAssetResolver(deps),
      ttsCache: createTtsCache(deps.media, deps.log),
      userHash: deps.userId ? pseudonymizeLearnerId(deps.userId, salt) : null,
    },
  );
}
