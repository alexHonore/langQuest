import type { MascotTint } from '@langquest/ui';

/** Clip names mirror `MASCOT_LOTTIE_CLIPS` in `@langquest/ui` (the generator owns the list). */
export type MeloClip = 'idle' | 'reaction' | 'celebrate_bounce' | 'thinking';

export interface MeloLottieProps {
  clip: MeloClip;
  size: number;
  /** Chameleon tint applied to the body / crest layers (native only). */
  tint?: MascotTint;
  loop?: boolean;
  accessibilityLabel: string;
  onFinish?: () => void;
  testID?: string;
}
