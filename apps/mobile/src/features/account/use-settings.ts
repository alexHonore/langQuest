/** Mutation for `/v1/me/settings`; local prefs update immediately, the server copy follows. */
import type { PatchSettingsRequest } from '@langquest/contracts';
import { useMutation } from '@tanstack/react-query';
import { useInvalidateLearner } from '@/features/session/queries';
import { useServices } from '@/lib/services';

export function usePatchSettings() {
  const { api } = useServices();
  const invalidate = useInvalidateLearner();
  return useMutation({
    mutationFn: (body: PatchSettingsRequest) => api.patchSettings(body),
    onSuccess: () => invalidate(),
  });
}
