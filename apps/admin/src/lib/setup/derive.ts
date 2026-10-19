/**
 * Deployment setup status (CONVENTIONS §8, "visible means usable"), derived purely from public signals the
 * Studio can already observe — no new API route: `GET /healthz` (API reachability + media storage mode),
 * `GET /v1/courses` (per-track AI / pronunciation capability summary computed from the API's configured
 * providers), the public Supabase URL and the admin host's own optional probe key.
 *
 * The result drives two things:
 * - the Setup page checklist (what is configured, exact next step for what is not);
 * - `DeploymentCapabilities`, the non-secret booleans client components use to NOT render controls whose
 *   backing capability is missing (uploads / playback when there is no media storage, generate / benchmark /
 *   enable when the AI route has no provider key, …).
 *
 * Nothing here reads a secret value: only presence booleans and non-secret modes/URLs cross to the browser.
 */

export type MediaMode = 'none' | 's3' | 'binding' | 's3+binding';

export interface TrackCapabilityInput {
  speechRecognition: boolean;
  speechSynthesis: boolean;
  realtimeConversation: boolean;
  pronunciationScoring: 'full' | 'partial' | 'limited' | 'none';
}

export interface SetupSignals {
  supabaseUrl: string;
  apiBaseUrl: string;
  /** `null` when `/healthz` could not be reached or did not answer the contract envelope. */
  health: { mediaMode: MediaMode } | null;
  /** `null` when `/v1/courses` could not be read (unreachable API or malformed answer). */
  tracks: TrackCapabilityInput[] | null;
  /** The admin host holds a server-only OPENROUTER_API_KEY (test-harness probes). Presence only. */
  adminProbeKey: boolean;
}

export const SETUP_ITEM_KEYS = ['supabase', 'api', 'media', 'ai', 'speech', 'email', 'adminProbe'] as const;
export type SetupItemKey = (typeof SETUP_ITEM_KEYS)[number];

/**
 * `ok`: configured and observed working; `missing`: not configured (the next step says what to do);
 * `unknown`: cannot be determined until an upstream item is fixed (e.g. the API is unreachable);
 * `manual`: not observable from the Studio at all — the owner verifies it by hand (Resend SMTP).
 */
export type SetupItemState = 'ok' | 'missing' | 'unknown' | 'manual';

export interface SetupItem {
  key: SetupItemKey;
  state: SetupItemState;
  /** Non-secret detail shown next to the state (URL, mode, counts). */
  detail: string;
  /** `admin.ui.setup.<key>.step.<variant>` message key for the exact next step. */
  nextStepKey: string;
  /** Items this one is required by (shown as "unlocks: …" so the operator sees what each step buys). */
  unlocks: SetupItemKey[];
}

/** Public, non-secret snapshot consumed by client components to decide what to render. */
export interface DeploymentCapabilities {
  apiReachable: boolean;
  mediaMode: MediaMode;
  mediaAvailable: boolean;
  aiAvailable: boolean;
  acousticScoring: boolean;
  adminProbe: boolean;
  supabaseMode: 'local' | 'hosted';
}

export interface SetupStatus {
  items: SetupItem[];
  capabilities: DeploymentCapabilities;
  /** True when at least one item is `missing` or `unknown` (the sidebar then hoists Setup to the top). */
  incomplete: boolean;
  checkedAt: string;
}

export function isLocalSupabase(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === '127.0.0.1' || host === 'localhost' || host === '[::1]' || host === '::1' || host.endsWith('.localhost');
  } catch {
    return false;
  }
}

export function deriveSetup(signals: SetupSignals, now: Date = new Date()): SetupStatus {
  const supabaseMode: 'local' | 'hosted' = isLocalSupabase(signals.supabaseUrl) ? 'local' : 'hosted';
  const apiReachable = signals.health !== null;
  const mediaMode: MediaMode = signals.health?.mediaMode ?? 'none';
  const mediaAvailable = apiReachable && mediaMode !== 'none';
  const tracks = signals.tracks ?? [];
  const aiAvailable = apiReachable && tracks.some((t) => t.speechRecognition || t.speechSynthesis || t.realtimeConversation);
  const acousticScoring = aiAvailable && tracks.some((t) => t.pronunciationScoring === 'full' || t.pronunciationScoring === 'partial');
  const acousticTracks = tracks.filter((t) => t.pronunciationScoring === 'full' || t.pronunciationScoring === 'partial').length;
  const aiTracks = tracks.filter((t) => t.speechRecognition || t.speechSynthesis || t.realtimeConversation).length;

  const items: SetupItem[] = [
    {
      key: 'supabase',
      state: 'ok',
      detail: signals.supabaseUrl,
      nextStepKey: supabaseMode === 'local' ? 'admin.ui.setup.supabase.step.local' : 'admin.ui.setup.supabase.step.hosted',
      unlocks: [],
    },
    {
      key: 'api',
      state: apiReachable ? 'ok' : 'missing',
      detail: signals.apiBaseUrl,
      nextStepKey: apiReachable ? 'admin.ui.setup.api.step.ok' : 'admin.ui.setup.api.step.missing',
      unlocks: ['media', 'ai', 'speech'],
    },
    {
      key: 'media',
      state: !apiReachable ? 'unknown' : mediaAvailable ? 'ok' : 'missing',
      detail: apiReachable ? mediaMode : '',
      nextStepKey: !apiReachable ? 'admin.ui.setup.media.step.unknown' : mediaAvailable ? 'admin.ui.setup.media.step.ok' : 'admin.ui.setup.media.step.missing',
      unlocks: [],
    },
    {
      key: 'ai',
      state: !apiReachable || signals.tracks === null ? 'unknown' : aiAvailable ? 'ok' : 'missing',
      detail: apiReachable && signals.tracks !== null ? `${aiTracks}/${tracks.length}` : '',
      nextStepKey: !apiReachable || signals.tracks === null ? 'admin.ui.setup.ai.step.unknown' : aiAvailable ? 'admin.ui.setup.ai.step.ok' : 'admin.ui.setup.ai.step.missing',
      unlocks: ['speech'],
    },
    {
      key: 'speech',
      state: !apiReachable || signals.tracks === null ? 'unknown' : !aiAvailable ? 'unknown' : acousticScoring ? 'ok' : 'missing',
      detail: apiReachable && signals.tracks !== null && aiAvailable ? `${acousticTracks}/${tracks.length}` : '',
      nextStepKey: !apiReachable || signals.tracks === null || !aiAvailable ? 'admin.ui.setup.speech.step.unknown' : acousticScoring ? 'admin.ui.setup.speech.step.ok' : 'admin.ui.setup.speech.step.missing',
      unlocks: [],
    },
    {
      key: 'email',
      state: 'manual',
      detail: supabaseMode === 'local' ? 'Mailpit :54324' : '',
      nextStepKey: supabaseMode === 'local' ? 'admin.ui.setup.email.step.local' : 'admin.ui.setup.email.step.hosted',
      unlocks: [],
    },
    {
      key: 'adminProbe',
      state: signals.adminProbeKey ? 'ok' : 'missing',
      detail: '',
      nextStepKey: signals.adminProbeKey ? 'admin.ui.setup.adminProbe.step.ok' : 'admin.ui.setup.adminProbe.step.missing',
      unlocks: [],
    },
  ];

  return {
    items,
    capabilities: { apiReachable, mediaMode, mediaAvailable, aiAvailable, acousticScoring, adminProbe: signals.adminProbeKey, supabaseMode },
    // `manual` items never block: they cannot be verified here. The optional admin probe is a convenience, not setup.
    incomplete: items.some((i) => i.key !== 'adminProbe' && (i.state === 'missing' || i.state === 'unknown')),
    checkedAt: now.toISOString(),
  };
}

/** Everything-works default used before the first server check or outside the studio layout (tests, isolated renders). */
export const UNKNOWN_CAPABILITIES: DeploymentCapabilities = {
  apiReachable: false,
  mediaMode: 'none',
  mediaAvailable: false,
  aiAvailable: false,
  acousticScoring: false,
  adminProbe: false,
  supabaseMode: 'local',
};
