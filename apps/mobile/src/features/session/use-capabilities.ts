/**
 * React side of `capabilities.ts`: the navigation an enrollment renders (CONVENTIONS §8). The snapshot comes
 * from the enrollment DTO (`/v1/me`), which the offline cache keeps with the rest of the profile, so the same
 * tabs are hidden offline as online. Unknown (older cached DTO, first run) → everything optional hidden.
 */
import type { EnrollmentDto } from '@langquest/contracts';
import { useMemo } from 'react';
import { Platform } from 'react-native';
import { resolveNavigation, type EnrollmentNavigation } from './capabilities';

/** Download packs need the native file system (`expo-file-system` `Directory` is native-only; UX observation #6). */
export const DOWNLOADS_SUPPORTED_ON_PLATFORM = Platform.OS !== 'web';

export function useEnrollmentNavigation(enrollment: Pick<EnrollmentDto, 'capabilities'> | null | undefined): EnrollmentNavigation {
  const caps = enrollment?.capabilities ?? null;
  return useMemo(() => resolveNavigation(caps, { downloadsSupported: DOWNLOADS_SUPPORTED_ON_PLATFORM }), [caps]);
}
