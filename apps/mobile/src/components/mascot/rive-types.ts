import type { MascotState } from '@langquest/contracts';

export interface MeloRiveProps {
  state: MascotState;
  size: number;
  /** Index into `COURSE_FAMILY_IDS`, −1 when the course has no family (spec §1). */
  courseFamilyIndex: number;
  reducedMotion: boolean;
  accessibilityLabel: string;
  /** The runtime failed to load the rig: the caller swaps to the SVG. */
  onError?: () => void;
  testID?: string;
}
