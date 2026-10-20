import type { ConversationMode } from '@langquest/contracts';
import { Divider, InfoAffordance, useTheme } from '@langquest/ui';
import { useRouter } from 'expo-router';
import React from 'react';
import { Melo } from '@/components/Melo';
import { Screen } from '@/components/Screen';
import { ChoiceRow, SwitchRow } from '@/components/SettingRow';
import { usePatchSettings } from '@/features/account/use-settings';
import { downloadsOfferedForAny } from '@/features/session/capabilities';
import { useActiveEnrollment } from '@/features/session/queries';
import { DOWNLOADS_SUPPORTED_ON_PLATFORM } from '@/features/session/use-capabilities';
import { useT } from '@/lib/i18n';
import { track } from '@/lib/telemetry';
import { usePrefs, type ThemeSchemePref } from '@/state/prefs';

const SCALES = [0.9, 1, 1.15, 1.3, 1.5, 1.8] as const;

/**
 * Accessibility + display + speech preferences (§10.3, calm density): mirrored to `accessibility_options`
 * server-side. Theme (dark-first), high contrast, motion, the mascot, the lanterns, text size, haptics, the
 * deaf / motor modes, the mic mode and the download rules. Each switch carries at most one hint; the
 * general notes (no hidden timers, screen readers) sit behind the header ⓘ. Melo previews the choices.
 */
export default function AccessibilitySettings(): React.JSX.Element {
  const theme = useTheme();
  const router = useRouter();
  const t = useT();
  const prefs = usePrefs();
  const patch = usePatchSettings();
  const { enrollments } = useActiveEnrollment();
  const downloadsOffered = downloadsOfferedForAny(enrollments.map((e) => e.capabilities ?? null), { downloadsSupported: DOWNLOADS_SUPPORTED_ON_PLATFORM });
  const push = (acc: Partial<{ reduce_motion: boolean; mascot_enabled: boolean; high_contrast: boolean; text_scale: number; haptics_enabled: boolean; captions_default_on: boolean }>): void => patch.mutate({ accessibilityOptions: acc });

  return (
    <Screen title={t('account.accessibility.title')} onBack={() => router.back()} headerEnd={<InfoAffordance label={t('account.aboutSettings')} title={t('account.accessibility.title')} text={[t('account.accessibility.noTimers'), t('account.accessibility.screenReaderNote'), t('speak.modeSwitchHint')]} />}>
      <Melo state="happy" size="companion" bubbleWhenDisabled={false} testID="accessibility-mascot" style={{ alignSelf: 'center' }} />
      <ChoiceRow<ThemeSchemePref> label={t('account.theme.label')} value={prefs.scheme} options={[{ value: 'system', label: t('account.theme.system') }, { value: 'dark', label: t('account.theme.dark') }, { value: 'light', label: t('account.theme.light') }]} onChange={(v) => prefs.set({ scheme: v })} />
      <SwitchRow label={t('account.accessibility.highContrast')} value={prefs.highContrast} onChange={(v) => { prefs.set({ highContrast: v }); push({ high_contrast: v }); }} />
      <SwitchRow label={t('account.accessibility.reduceMotion')} hint={prefs.reducedMotion === 'system' ? t('account.theme.system') : undefined} value={prefs.reducedMotion === true || (prefs.reducedMotion === 'system' && theme.reducedMotion)} onChange={(v) => { prefs.set({ reducedMotion: v ? true : 'system' }); push({ reduce_motion: v }); track.mascotPreference(prefs.mascotEnabled, v); }} />
      <SwitchRow label={t('account.accessibility.mascotOff')} value={!prefs.mascotEnabled} onChange={(v) => { prefs.set({ mascotEnabled: !v }); push({ mascot_enabled: !v }); track.mascotPreference(!v, prefs.reducedMotion === true); }} />
      {/* Device-local: the lanterns are decorative and never part of the server-side accessibility options. */}
      <SwitchRow label={t('account.lanterns')} value={prefs.lanternsEnabled} disabled={prefs.highContrast} onChange={(v) => prefs.set({ lanternsEnabled: v })} />
      <ChoiceRow label={t('account.accessibility.largeText')} value={String(prefs.textScale)} options={SCALES.map((s) => ({ value: String(s), label: `${Math.round(s * 100)}%` }))} onChange={(v) => { prefs.set({ textScale: Number(v) }); push({ text_scale: Number(v) }); }} />
      <SwitchRow label={t('account.accessibility.haptics')} value={prefs.hapticsEnabled} onChange={(v) => { prefs.set({ hapticsEnabled: v }); push({ haptics_enabled: v }); }} />
      <Divider />
      <SwitchRow label={t('account.accessibility.deafMode')} hint={t('account.accessibility.deafModeHint')} value={prefs.captionsDefaultOn} onChange={(v) => { prefs.set({ captionsDefaultOn: v }); push({ captions_default_on: v }); }} />
      <SwitchRow label={t('account.accessibility.motorMode')} hint={t('account.accessibility.motorModeHint')} value={prefs.tapToTalk} onChange={(v) => prefs.set({ tapToTalk: v })} />
      <ChoiceRow<ConversationMode> label={t('account.speakMode.label')} value={prefs.speakMode} options={[{ value: 'push_to_talk', label: t('account.speakMode.push_to_talk') }, { value: 'hands_free', label: t('account.speakMode.hands_free') }, { value: 'text_only', label: t('account.speakMode.text_only') }]} onChange={(v) => { prefs.set({ speakMode: v }); patch.mutate({ conversationMode: v }); }} />
      {/* §8: download rules only when one of the learner's courses can download (device QA 2026-10-20). */}
      {downloadsOffered ? <Divider /> : null}
      {downloadsOffered ? <SwitchRow label={t('audio.download.wifiOnly')} value={prefs.wifiOnlyDownloads} onChange={(v) => { prefs.set({ wifiOnlyDownloads: v }); patch.mutate({ offlineDownloadSettings: { wifiOnly: v } }); }} /> : null}
      {downloadsOffered ? <SwitchRow label={t('audio.download.download')} hint={t('audio.download.manage')} value={prefs.autoDownload} onChange={(v) => { prefs.set({ autoDownload: v }); patch.mutate({ offlineDownloadSettings: { autoDownload: v } }); }} /> : null}
    </Screen>
  );
}
