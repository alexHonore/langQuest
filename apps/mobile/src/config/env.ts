/**
 * Public runtime configuration for the learner app.
 *
 * Only `EXPO_PUBLIC_*` values are ever bundled (CONVENTIONS §1): Supabase URL +
 * anon key and the API base URL. Server secrets (OpenRouter, service role, R2)
 * never appear here. When a value is missing the app keeps working in a
 * clearly labelled "not configured" state instead of crashing.
 */
export interface AppEnv {
  supabaseUrl: string | null;
  supabaseAnonKey: string | null;
  apiBaseUrl: string | null;
  /** Comma-separated OAuth providers enabled in Supabase (e.g. `google,apple`). Empty = buttons hidden. */
  oauthProviders: readonly string[];
  appVersion: string;
  /**
   * Feature flag: render the mascot with the Rive runtime when a `.riv` is bundled
   * (`EXPO_PUBLIC_MASCOT_RIVE=1`). Off, or without a bundled file, Melo is the SVG.
   */
  mascotRive: boolean;
}

const read = (value: string | undefined): string | null => {
  const v = value?.trim();
  return v && v.length > 0 ? v : null;
};

export const ENV: AppEnv = {
  supabaseUrl: read(process.env.EXPO_PUBLIC_SUPABASE_URL),
  supabaseAnonKey: read(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY),
  apiBaseUrl: read(process.env.EXPO_PUBLIC_API_BASE_URL)?.replace(/\/+$/, '') ?? null,
  oauthProviders: (read(process.env.EXPO_PUBLIC_OAUTH_PROVIDERS) ?? '')
    .split(',')
    .map((p) => p.trim().toLowerCase())
    .filter((p) => p.length > 0),
  appVersion: read(process.env.EXPO_PUBLIC_APP_VERSION) ?? '1.0.0',
  mascotRive: ['1', 'true', 'on'].includes((read(process.env.EXPO_PUBLIC_MASCOT_RIVE) ?? '').toLowerCase()),
};

/** True when both the auth backend and the API are configured. */
export const isBackendConfigured = (): boolean => Boolean(ENV.supabaseUrl && ENV.supabaseAnonKey && ENV.apiBaseUrl);
