/**
 * Audio tab availability flag read by Home ("Continue listening" button).
 * The library (`src/app/(tabs)/audio/**`, `src/audio/**`, `src/features/audio/**`)
 * is implemented; the flag stays so other screens do not need to import the
 * audio runtime just to enable a button.
 */
export interface AudioTabPlaceholder {
  /** True now that the audio library is wired in. */
  available: boolean;
  /** i18n key describing the empty/unsupported state shown on the tab. */
  messageKey: 'audio.offline.notDownloaded';
}

export const AUDIO_TAB_PLACEHOLDER: AudioTabPlaceholder = {
  available: true,
  messageKey: 'audio.offline.notDownloaded',
};
