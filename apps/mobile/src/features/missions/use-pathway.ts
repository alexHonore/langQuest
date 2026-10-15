/** Pathway hook: manifest + local progress → recommended mission and story nodes. */
import { getCourseTrack, type EnrollmentDto } from '@langquest/contracts';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useManifest } from '@/features/session/queries';
import { getLocalStore } from '@/store';
import { buildPathway, type Pathway } from './story';

export function useLocalMissionProgress(enrollmentId: string | null) {
  return useQuery({
    queryKey: ['local-progress', enrollmentId],
    enabled: Boolean(enrollmentId),
    networkMode: 'always',
    queryFn: async () => (await getLocalStore()).cache.listLocalMissions(enrollmentId!),
  });
}

export function usePathway(enrollment: EnrollmentDto | null): { pathway: Pathway | null; manifest: ReturnType<typeof useManifest>; local: ReturnType<typeof useLocalMissionProgress> } {
  const manifest = useManifest(enrollment);
  const local = useLocalMissionProgress(enrollment?.id ?? null);
  const pathway = useMemo(() => {
    if (!manifest.data || !enrollment) return null;
    const tonal = getCourseTrack(enrollment.courseTrackId).tonal;
    return buildPathway(manifest.data.data, local.data ?? [], enrollment.activeMissionId, tonal);
  }, [manifest.data, local.data, enrollment]);
  return { pathway, manifest, local };
}
