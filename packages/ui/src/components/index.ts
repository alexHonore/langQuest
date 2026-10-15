/**
 * Shared React Native components (§10.2C). All components are typed, carry
 * accessibility labels/roles, are RTL-aware through the theme and contain no
 * audio engine, network or storage code.
 */
export * from './logic';
export * from './labels';

export type {
  TextTone,
  ThemedTextProps,
  RowProps,
  SurfaceProps,
  ButtonVariant,
  ButtonProps,
  IconButtonProps,
  ChipProps,
  ProgressBarProps,
} from './primitives';
export {
  ThemedText,
  toneColor,
  Row,
  Surface,
  Button,
  IconButton,
  Chip,
  ProgressBar,
  Divider,
  InlineIcon,
  StatusLine,
} from './primitives';

export type { SafeAreaInsets, CourseHeaderInfo, AppShellProps } from './AppShell';
export { AppShell } from './AppShell';

export type { MascotVariant, MascotProps } from './Mascot';
export { Mascot, mascotSize } from './Mascot';

export type { CharacterPortraitProps } from './CharacterPortrait';
export { CharacterPortrait, expressionForSpeechState } from './CharacterPortrait';

export type { SceneArtworkProps } from './SceneArtwork';
export { SceneArtwork } from './SceneArtwork';

export type { MissionCardSkill, MissionCardProps } from './MissionCard';
export { MissionCard } from './MissionCard';

export type { LessonProgressProps } from './LessonProgress';
export { LessonProgress } from './LessonProgress';

export type {
  AudioPlaybackStatus,
  AudioPlayerController,
  DownloadState,
  AudioPlayerProps,
} from './AudioPlayer';
export { AudioPlayer } from './AudioPlayer';

export type { HapticKind, SpeakButtonProps } from './SpeakButton';
export { SpeakButton } from './SpeakButton';

export type { SpeechStateIndicatorProps } from './SpeechStateIndicator';
export { SpeechStateIndicator, speechStateColor } from './SpeechStateIndicator';

export type { HintLevel, HintSheetProps } from './HintSheet';
export { HintSheet } from './HintSheet';

export type { PronunciationFeedbackProps } from './PronunciationFeedback';
export { PronunciationFeedback } from './PronunciationFeedback';

export type { LanguagePairSelection, LanguagePairPickerProps } from './LanguagePairPicker';
export { LanguagePairPicker } from './LanguagePairPicker';

export type { StoryMapProps } from './StoryMap';
export { StoryMap } from './StoryMap';

export type { AchievementCelebrationProps } from './AchievementCelebration';
export { AchievementCelebration } from './AchievementCelebration';

export type { RightsState, AssetPickerItem, AssetPickerProps } from './AssetPicker';
export { AssetPicker } from './AssetPicker';

export type { CourseCoverProps } from './CourseCover';
export { CourseCover } from './CourseCover';

export type { EmptyStateProps } from './EmptyState';
export { EmptyState } from './EmptyState';

export type { SkeletonProps } from './Skeleton';
export { Skeleton, CardSkeleton } from './Skeleton';

export type { CoverageBadgeProps } from './CoverageBadge';
export { CoverageBadge } from './CoverageBadge';
