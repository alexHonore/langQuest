/**
 * `/v1/me` response as the app consumes it. The contract schema requires a
 * `defaultSourceLanguageCode`, but `profiles.default_source_language_code` is
 * nullable in the database (a learner may not have chosen one yet), so the app
 * accepts `null` and treats it as "no prefill" in the enrollment wizard.
 */
import { MeResponseSchema, SourceLanguageCodeSchema } from '@langquest/contracts';
import type { z } from 'zod';

export const MeResponseSchemaLenient = MeResponseSchema.extend({
  defaultSourceLanguageCode: SourceLanguageCodeSchema.nullable(),
});
export type MeProfile = z.infer<typeof MeResponseSchemaLenient>;
