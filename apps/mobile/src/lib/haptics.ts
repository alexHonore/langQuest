/** Optional haptics (§10.3): every call is a no-op when the learner disabled them or the platform lacks them. */
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';
import { usePrefs } from '@/state/prefs';

export type HapticKind = 'start' | 'stop' | 'error' | 'success' | 'select';

export async function haptic(kind: HapticKind): Promise<void> {
  if (Platform.OS === 'web' || !usePrefs.getState().hapticsEnabled) return;
  try {
    switch (kind) {
      case 'start':
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        break;
      case 'stop':
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        break;
      case 'error':
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        break;
      case 'success':
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        break;
      case 'select':
        await Haptics.selectionAsync();
        break;
    }
  } catch {
    /* haptics unavailable */
  }
}
