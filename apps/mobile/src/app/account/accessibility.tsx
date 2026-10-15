import type { ConversationMode } from '@langquest/contracts';
import { Divider, StatusLine, ThemedText, useTheme } from '@langquest/ui';
import { useRouter } from 'expo-router';
import React from 'react';
import { Screen } from '@/components/Screen';
import { ChoiceRow, SwitchRow } from '@/components/SettingRow';
import { usePatchSettings } from '@/features/account/use-settings';
import { useT } from '@/lib/i18n';
import { track } from '@/lib/telemetry';
import { usePrefs, type ThemeSchemePref } from '@/state/prefs';

const SCALES = [0.9, 1, 1.15, 1.3, 1.5, 1.8] as const;

/** Accessibility + display + speech preferences (§10.3): mirrored to `accessibility_options` server-side. */
export default function AccessibilitySettings(): React.JSX.Element {
  const theme = useTheme();
  const router = useRouter();
  const t = useT();
  const prefs = usePrefs();
  const patch = usePatchSettings();
  const push = (acc: Partial<{ reduce_motion: boolean; mascot_enabled: boolean; high_contrast: boolean; text_scale: number; haptics_enabled: boolean; captions_default_on: boolean }>): void => patch.mutate({ accessibilityOptions: acc });

  return (
    <Screen title={t('account.accessibility.title')} onBack={() => router.back()}>
      <ChoiceRow<ThemeSchemePref> label={t('account.theme.label')} value={prefs.scheme} options={[{ value: 'system', label: t('account.theme.system') }, { value: 'light', label: t('account.theme.light') }, { value: 'dark', label: t('account.theme.dark') }]} onChange={(v) => prefs.set({ scheme: v })} />
      <SwitchRow label={t('account.accessibility.highContrast')} value={prefs.highContrast} onChange={(v) => { prefs.set({ highContrast: v }); push({ high_contrast: v }); }} />
      <SwitchRow label={t('account.accessibility.reduceMotion')} hint={prefs.reducedMotion === 'system' ? t('account.theme.system') : undefined} value={prefs.reducedMotion === true || (prefs.reducedMotion === 'system' && theme.reducedMotion)} onChange={(v) => { prefs.set({ reducedMotion: v ? true : 'system' }); push({ reduce_motion: v }); track.mascotPreference(prefs.mascotEnabled, v); }} />
      <SwitchRow label={t('account.accessibility.mascotOff')} value={!prefs.mascotEnabled} onChange={(v) => { prefs.set({ mascotEnabled: !v }); push({ mascot_enabled: !v }); track.mascotPreference(!v, prefs.reducedMotion === true); }} />
      <ChoiceRow label={t('account.accessibility.largeText')} value={String(prefs.textScale)} options={SCALES.map((s) => ({ value: String(s), label: `${Math.round(s * 100)}%` }))} onChange={(v) => { prefs.set({ textScale: Number(v) }); push({ text_scale: Number(v) }); }} />
      <SwitchRow label={t('account.accessibility.haptics')} value={prefs.hapticsEnabled} onChange={(v) => { prefs.set({ hapticsEnabled: v }); push({ haptics_enabled: v }); }} />
      <Divider />
      <SwitchRow label={t('account.accessibility.deafMode')} hint={t('account.accessibility.deafModeHint')} value={prefs.captionsDefaultOn} onChange={(v) => { prefs.set({ captionsDefaultOn: v }); push({ captions_default_on: v }); }} />
      <SwitchRow label={t('account.accessibility.motorMode')} hint={t('account.accessibility.motorModeHint')} value={prefs.tapToTalk} onChange={(v) => prefs.set({ tapToTalk: v })} />
      <ChoiceRow<ConversationMode> label={t('account.speakMode.label')} hint={t('speak.modeSwitchHint')} value={prefs.speakMode} options={[{ value: 'push_to_talk', label: t('account.speakMode.push_to_talk') }, { value: 'hands_free', label: t('account.speakMode.hands_free') }, { value: 'text_only', label: t('account.speakMode.text_only') }]} onChange={(v) => { prefs.set({ speakMode: v }); patch.mutate({ conversationMode: v }); }} />
      <Divider />
      <SwitchRow label={t('audio.download.wifiOnly')} value={prefs.wifiOnlyDownloads} onChange={(v) => { prefs.set({ wifiOnlyDownloads: v }); patch.mutate({ offlineDownloadSettings: { wifiOnly: v } }); }} />
      <SwitchRow label={t('audio.download.download')} hint={t('audio.download.manage')} value={prefs.autoDownload} onChange={(v) => { prefs.set({ autoDownload: v }); patch.mutate({ offlineDownloadSettings: { autoDownload: v } }); }} />
      <StatusLine icon="info" tone="secondary" text={t('account.accessibility.noTimers')} />
      <ThemedText variant="caption" tone="muted">{t('account.accessibility.screenReaderNote')}</ThemedText>
    </Screen>
  );
}
