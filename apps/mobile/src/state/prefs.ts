/**
 * Device-local learner preferences (zustand + AsyncStorage persistence).
 *
 * These mirror the server-side `accessibility_options` / account settings so
 * the app renders correctly before `/v1/me` loads and while offline. Server
 * values win when they arrive (`applyServerSettings`), explicit local edits
 * are pushed to the server by the settings screens.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ConversationMode, SourceLanguageCode } from '@langquest/contracts';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type ThemeSchemePref = 'system' | 'light' | 'dark';

export interface PrefsState {
  /** Explicit UI locale; `null` follows the device. */
  uiLocale: string | null;
  scheme: ThemeSchemePref;
  highContrast: boolean;
  reducedMotion: 'system' | boolean;
  mascotEnabled: boolean;
  textScale: number;
  hapticsEnabled: boolean;
  captionsDefaultOn: boolean;
  speakMode: ConversationMode;
  /** Motor accessibility: tap-to-start / tap-to-stop instead of press-and-hold. */
  tapToTalk: boolean;
  onboardingComplete: boolean;
  /** Chosen during onboarding before an account exists; applied to the profile on sign-up. */
  pendingDefaultSourceLanguage: SourceLanguageCode | null;
  pendingTrackId: string | null;
  activeEnrollmentId: string | null;
  /** Wi-Fi only downloads + auto-download opt-in (read by the audio library). */
  wifiOnlyDownloads: boolean;
  autoDownload: boolean;
  hydrated: boolean;
}

export interface PrefsActions {
  set: (patch: Partial<Omit<PrefsState, 'hydrated'>>) => void;
  applyServerSettings: (opts: { reduce_motion: boolean; mascot_enabled: boolean; high_contrast: boolean; text_scale: number; haptics_enabled: boolean; captions_default_on: boolean }, uiLocale: string) => void;
  resetForSignOut: () => void;
  /** Internal: called once persisted state has been read (or failed to read). */
  markHydrated: () => void;
}

export const DEFAULT_PREFS: Omit<PrefsState, 'hydrated'> = {
  uiLocale: null,
  scheme: 'system',
  highContrast: false,
  reducedMotion: 'system',
  mascotEnabled: true,
  textScale: 1,
  hapticsEnabled: true,
  captionsDefaultOn: false,
  speakMode: 'push_to_talk',
  tapToTalk: false,
  onboardingComplete: false,
  pendingDefaultSourceLanguage: null,
  pendingTrackId: null,
  activeEnrollmentId: null,
  wifiOnlyDownloads: true,
  autoDownload: false,
};

export const usePrefs = create<PrefsState & PrefsActions>()(
  persist(
    (set) => ({
      ...DEFAULT_PREFS,
      hydrated: false,
      set: (patch) => set(patch),
      applyServerSettings: (opts, uiLocale) =>
        set({
          reducedMotion: opts.reduce_motion ? true : 'system',
          mascotEnabled: opts.mascot_enabled,
          highContrast: opts.high_contrast,
          textScale: opts.text_scale,
          hapticsEnabled: opts.haptics_enabled,
          captionsDefaultOn: opts.captions_default_on,
          uiLocale,
        }),
      resetForSignOut: () => set({ ...DEFAULT_PREFS, onboardingComplete: true, hydrated: true }),
      markHydrated: () => set({ hydrated: true }),
    }),
    {
      name: 'langquest:prefs',
      version: 1,
      // AsyncStorage is cross-platform (localStorage on web); hydration is async so `hydrated` gates the UI.
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => {
        const { hydrated: _h, set: _s, applyServerSettings: _a, resetForSignOut: _r, markHydrated: _m, ...rest } = s;
        return rest;
      },
      onRehydrateStorage: () => (state) => {
        state?.markHydrated();
      },
    },
  ),
);
