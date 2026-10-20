/**
 * `ContentPublishRequestSchema` carries the editor override of a blocking review flag (`overrideReviewFlags` +
 * `overrideReason`, optional and additive), and `DIVERSITY_REVIEW_FLAG` has one definition: the jobs and scripts
 * writers and the API publish gate import this constant instead of spelling the string.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ContentPublishRequestSchema, ContentUnpublishRequestSchema, DIVERSITY_REVIEW_FLAG, PUBLISH_BLOCKING_REVIEW_FLAGS } from './admin';

const REASON = 'Reviewed by hand: the uniform phrasing is the drill the chapter wants.';

describe('ContentPublishRequestSchema: the review-flag override', () => {
  it('older bodies without the override parse unchanged (backward compatible)', () => {
    expect(ContentPublishRequestSchema.parse({ entityTable: 'audio_lessons', expectedRevision: 3, note: 'launch' })).toEqual({ entityTable: 'audio_lessons', expectedRevision: 3, note: 'launch' });
    expect(ContentPublishRequestSchema.parse({ entityTable: 'missions', expectedRevision: 0 })).toEqual({ entityTable: 'missions', expectedRevision: 0 });
    // The unpublish schema still shares the entity table enum.
    expect(ContentUnpublishRequestSchema.shape.entityTable).toBe(ContentPublishRequestSchema.shape.entityTable);
  });

  it('accepts a named blocking flag with a reason of at least 10 characters (trimmed)', () => {
    expect(ContentPublishRequestSchema.parse({ entityTable: 'expressions', expectedRevision: 1, overrideReviewFlags: [DIVERSITY_REVIEW_FLAG], overrideReason: `  ${REASON}  ` })).toEqual({ entityTable: 'expressions', expectedRevision: 1, overrideReviewFlags: [DIVERSITY_REVIEW_FLAG], overrideReason: REASON });
  });

  it('refuses an unknown flag, an empty list, a short or overlong reason, and either field without the other', () => {
    const base = { entityTable: 'missions', expectedRevision: 0 };
    const refused: [Record<string, unknown>, string][] = [
      [{ overrideReviewFlags: ['made_up_flag'], overrideReason: REASON }, 'overrideReviewFlags'],
      [{ overrideReviewFlags: [], overrideReason: REASON }, 'overrideReviewFlags'],
      [{ overrideReviewFlags: [DIVERSITY_REVIEW_FLAG, DIVERSITY_REVIEW_FLAG], overrideReason: REASON }, 'overrideReviewFlags'],
      [{ overrideReviewFlags: [DIVERSITY_REVIEW_FLAG], overrideReason: '   too short   ' }, 'overrideReason'],
      [{ overrideReviewFlags: [DIVERSITY_REVIEW_FLAG], overrideReason: 'x'.repeat(1001) }, 'overrideReason'],
      [{ overrideReviewFlags: [DIVERSITY_REVIEW_FLAG] }, 'overrideReason'],
      [{ overrideReason: REASON }, 'overrideReviewFlags'],
    ];
    for (const [extra, path] of refused) {
      const parsed = ContentPublishRequestSchema.safeParse({ ...base, ...extra });
      expect(parsed.success, JSON.stringify(extra)).toBe(false);
      expect(parsed.error!.issues.map((i) => String(i.path[0])), JSON.stringify(extra)).toContain(path);
    }
  });

  it('documents both fields as optional properties in the JSON Schema the OpenAPI document is built from', () => {
    const schema = z.toJSONSchema(ContentPublishRequestSchema, { io: 'input' }) as { properties: Record<string, { items?: { enum?: string[] } }>; required: string[] };
    expect(Object.keys(schema.properties)).toEqual(expect.arrayContaining(['overrideReviewFlags', 'overrideReason']));
    expect(schema.properties.overrideReviewFlags!.items!.enum).toEqual([...PUBLISH_BLOCKING_REVIEW_FLAGS]);
    expect(schema.required).not.toContain('overrideReviewFlags');
    expect(schema.required).not.toContain('overrideReason');
  });
});

describe('DIVERSITY_REVIEW_FLAG: one definition', () => {
  const root = resolve(import.meta.dirname, '../../../..');
  /** Source with comments removed: a flag named in prose is fine, a string literal in code is a second definition. */
  const codeOf = (path: string): string =>
    readFileSync(resolve(root, path), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|\s)\/\/.*$/gm, '$1');

  it('is the diversity gate flag and the only publish-blocking flag', () => {
    expect(DIVERSITY_REVIEW_FLAG).toBe('diversity_needs_regeneration');
    expect(PUBLISH_BLOCKING_REVIEW_FLAGS).toEqual([DIVERSITY_REVIEW_FLAG]);
  });

  it('the jobs and scripts writers and the API gate import it instead of spelling the string', () => {
    const consumers = ['apps/api/src/routes/admin/content.ts', 'apps/jobs/src/handlers/generate-content.ts', 'scripts/src/lib/content-factory.ts', 'scripts/src/content-factory.ts'];
    for (const path of consumers) {
      const code = codeOf(path);
      expect(code, path).not.toMatch(/['"`]diversity_needs_regeneration['"`]/);
      expect(code, path).toMatch(/import \{[^}]*\bDIVERSITY_REVIEW_FLAG\b[^}]*\} from '@langquest\/contracts'/);
    }
    // The definition itself lives here, once.
    expect(codeOf('packages/contracts/src/api/admin.ts').match(/['"]diversity_needs_regeneration['"]/g)).toHaveLength(1);
  });
});
