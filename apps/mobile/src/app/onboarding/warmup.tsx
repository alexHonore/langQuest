import { getCourseTrack, type CourseTrackId } from '@langquest/contracts';
import { Button, Mascot, NATIVE_SAMPLES, Row, SpeakButton, StatusLine, ThemedText, useTheme } from '@langquest/ui';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { View } from 'react-native';
import { OnboardingFrame } from '@/components/OnboardingFrame';
import { haptic } from '@/lib/haptics';
import { useT } from '@/lib/i18n';
import { useUiLabels } from '@/lib/labels';
import { requestMicPermission, useRecorder, type MicPermission } from '@/lib/recorder';
import { usePrefs } from '@/state/prefs';

/**
 * Low-pressure warm-up: look at a phrase, optionally say it back. Nothing is
 * scored (no scorer exists here and we never fake one). Microphone permission
 * is requested only when the learner taps the mic (just-in-time).
 */
export default function WarmupStep(): React.JSX.Element {
  const theme = useTheme();
  const router = useRouter();
  const t = useT();
  const labels = useUiLabels();
  const set = usePrefs((s) => s.set);
  const trackId = usePrefs((s) => s.pendingTrackId) as CourseTrackId | null;
  const recorder = useRecorder();
  const [permission, setPermission] = useState<MicPermission | null>(null);
  const [state, setState] = useState<'idle' | 'recording' | 'done'>('idle');
  const [elapsed, setElapsed] = useState<number | null>(null);
  const track = trackId ? getCourseTrack(trackId) : null;
  const sample = trackId ? NATIVE_SAMPLES[trackId] : null;

  const finish = (): void => {
    set({ onboardingComplete: true });
    router.replace('/auth/sign-up');
  };

  const start = async (): Promise<void> => {
    const p = permission === 'granted' ? 'granted' : await requestMicPermission();
    setPermission(p);
    if (p !== 'granted') return;
    try {
      await recorder.start();
      setState('recording');
      void haptic('start');
    } catch {
      setPermission('unavailable');
    }
  };
  const stop = async (): Promise<void> => {
    const clip = await recorder.stop();
    setElapsed(clip?.durationMs ?? null);
    setState('done');
    void haptic('stop');
  };

  return (
    <OnboardingFrame step={4} title={t('onboarding.baseline.title')} hint={t('onboarding.baseline.listenHint')} primaryLabel={t('onboarding.finish')} primaryTestID="onboarding-warmup-finish" onPrimary={finish} secondaryLabel={t('onboarding.baseline.skip')} secondaryTestID="onboarding-warmup-skip" onSecondary={finish}>
      <Row gap={theme.spacing.md} align="flex-start">
        <Mascot state="encouraging" size="companion" speech={t('onboarding.baseline.speakHint')} />
      </Row>
      {track && sample ? (
        <View style={{ alignItems: 'center', gap: theme.spacing.sm, paddingVertical: theme.spacing.lg }}>
          <ThemedText variant="phrase" script={track.scripts.primary} align="center">
            {sample.native}
          </ThemedText>
          {sample.latin ? (
            <ThemedText variant="transliteration" tone="muted" align="center">
              {sample.latin}
            </ThemedText>
          ) : null}
        </View>
      ) : null}
      <View style={{ alignItems: 'center', gap: theme.spacing.md }}>
        <SpeakButton
          mode="toggle"
          state={state === 'recording' ? 'recording' : permission === 'denied' || permission === 'unavailable' ? 'disabled' : 'idle'}
          onStart={() => void start()}
          onStop={() => void stop()}
          onHaptic={(k) => void haptic(k)}
          elapsedText={state === 'recording' ? t('pronunciation.recording') : null}
          labels={labels.speakButton}
        />
        <ThemedText variant="caption" tone="muted" align="center">
          {t('onboarding.baseline.micJustInTime')}
        </ThemedText>
        {permission === 'denied' ? <StatusLine icon="micOff" tone="warning" text={t('errors.permission.micDenied')} /> : null}
        {state === 'done' ? <StatusLine icon="check" tone="success" text={elapsed ? `${t('speak.noPenalty')} (${Math.round(elapsed / 100) / 10} s)` : t('speak.noSpeech')} /> : null}
        {state === 'done' ? <Button label={t('lesson.tryAgain')} variant="ghost" onPress={() => setState('idle')} accessibilityLabel={t('lesson.tryAgain')} /> : null}
      </View>
    </OnboardingFrame>
  );
}
