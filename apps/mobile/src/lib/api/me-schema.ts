/**
 * `/v1/me` response as the app consumes it.
 *
 * `profiles.default_source_language_code` is nullable in the database (a learner
 * may not have chosen one yet) and `MeResponseSchema` in `@langquest/contracts`
 * now models that as `defaultSourceLanguageCode: nullable`. The app treats
 * `null` as "no prefill" in the enrollment wizard. This module keeps the
 * historical `MeResponseSchemaLenient` / `MeProfile` names as aliases of the
 * contract schema so call sites have a single import point.
 */
import { MeResponseSchema } from '@langquest/contracts';
import type { z } from 'zod';

export const MeResponseSchemaLenient = MeResponseSchema;
export type MeProfile = z.infer<typeof MeResponseSchemaLenient>;
