/**
 * Course manifest as the learner app consumes it.
 *
 * The API serves every published character of the track with a structural extension that
 * `@langquest/contracts` `ManifestCharacterSchema` does not carry yet (`characterKey`, `region`,
 * `regionalOption`, `portraitKey`; see `packages/db` `LocalizedManifestCharacter`). A strict parse
 * with `CourseManifestSchema` would strip them, so the app parses with this superset: every field
 * is optional, which keeps manifests cached by an older build readable. `id` stays the character's
 * database uuid — the value `POST /v1/ai/conversation/session` expects as `characterId`.
 */
import { CourseManifestSchema, ManifestCharacterSchema } from '@langquest/contracts';
import { z } from 'zod';

export const LearnerManifestCharacterSchema = ManifestCharacterSchema.extend({
  /** `characters.character_key`: the `@langquest/ui` roster slug (e.g. `ary-cafe-staff-nadia`). */
  characterKey: z.string().min(1).optional(),
  /** Home region ("Casablanca, Morocco"). */
  region: z.string().nullable().optional(),
  /** Regional option id within the variety (matches `COURSE_TRACKS[].regionalOptions[].id`). */
  regionalOption: z.string().nullable().optional(),
  /** Key for the in-code portrait (`findCharacter(portraitKey)` in `@langquest/ui`). */
  portraitKey: z.string().min(1).optional(),
});
export type LearnerManifestCharacter = z.infer<typeof LearnerManifestCharacterSchema>;

export const LearnerManifestSchema = CourseManifestSchema.extend({
  characters: z.array(LearnerManifestCharacterSchema),
});
export type LearnerManifest = z.infer<typeof LearnerManifestSchema>;
