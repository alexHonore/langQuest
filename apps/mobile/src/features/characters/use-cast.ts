/** The active course's cast (manifest characters ranked for the enrollment's regional preference). */
import type { EnrollmentDto } from '@langquest/contracts';
import { useMemo } from 'react';
import { useManifest } from '@/features/session/queries';
import { castFromManifest, type CastCharacter } from './cast';

export function useCast(enrollment: EnrollmentDto | null): { cast: CastCharacter[]; query: ReturnType<typeof useManifest> } {
  const query = useManifest(enrollment);
  const manifest = query.data?.data ?? null;
  const cast = useMemo(() => castFromManifest(manifest, enrollment?.regionalPreference ?? null), [manifest, enrollment?.regionalPreference]);
  return { cast, query };
}
