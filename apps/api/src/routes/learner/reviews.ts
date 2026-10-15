/**
 * §6.1 `GET /v1/me/reviews/due?enrollmentId=` (§3.5, A17): due cards from `get_due_reviews` (RLS-scoped),
 * each paired with a varied practical scenario (never the same flashcard twice in a row), the expression
 * content in the enrollment's source language, or the skill descriptor.
 */
import { ReviewsDueQuerySchema, ReviewsDueResponseSchema, type MissionExpression, type SourceLanguageCode } from '@langquest/contracts';
import { SITUATIONAL_BLUEPRINTS } from '@langquest/curriculum/missions/scenarios';
import { chooseReviewScenario } from '@langquest/curriculum/scheduler/scheduler';
import { findSkill } from '@langquest/curriculum/skills';
import type { Row } from '@langquest/db/types';
import { sourceLanguageTranslator } from '@langquest/locales';
import type { DefineRoute } from '../../app';
import { respondOk } from '../../http/envelope';
import { parseQuery } from '../../http/validate';
import { MEDIA_ASSET_COLUMNS, mediaAssetToRef, reviewRowToCard, type MediaAssetPublicRow } from '../../lib/dto';
import { loadOwnedEnrollment } from '../../lib/enrollment';

export function registerReviewRoutes(define: DefineRoute): void {
  define('reviewsDue', {}, async (c) => {
    const query = parseQuery(c, ReviewsDueQuerySchema);
    const s = c.get('services')!;
    const { db, repos } = s.requireUser();
    const enrollment = await loadOwnedEnrollment(db, query.enrollmentId);
    const now = query.now ? new Date(query.now) : new Date();
    const [rows, dueCount] = await Promise.all([repos.progress.getDueReviews(enrollment.id, query.limit, now), repos.progress.countDueReviews(enrollment.id, now)]);
    const expressionIds = rows.map((r) => r.expression_id).filter((v): v is string => v !== null);
    const expressions = expressionIds.length ? await repos.curriculum.getExpressions(expressionIds) : [];
    const [forms, translations, audio] = expressionIds.length
      ? await Promise.all([
          db.from('expression_forms').select('*').in('expression_id', expressionIds).then((r) => r.data ?? []),
          db.from('expression_translations').select('*').in('expression_id', expressionIds).eq('source_language_code', enrollment.source_language_code).then((r) => r.data ?? []),
          db.from('expression_audio').select('*').in('expression_id', expressionIds).then((r) => r.data ?? []),
        ])
      : [[], [], []];
    const assetIds = [...new Set(audio.map((a) => a.asset_id))];
    const assets = assetIds.length ? (((await db.from('media_assets').select(MEDIA_ASSET_COLUMNS).in('id', assetIds)).data as MediaAssetPublicRow[] | null) ?? []) : [];
    const assetById = new Map(assets.map((a) => [a.id, a]));
    const t = sourceLanguageTranslator({ sourceLanguage: enrollment.source_language_code as SourceLanguageCode });
    const scenarioPool = SITUATIONAL_BLUEPRINTS.map((b) => b.key);
    const toExpression = (e: Row<'expressions'>): MissionExpression => {
      const tr = translations.find((x) => x.expression_id === e.id);
      return {
        id: e.id,
        canonicalText: e.canonical_text,
        forms: forms.filter((f) => f.expression_id === e.id).map((f) => ({ script: f.script, transliterationScheme: f.transliteration_scheme, text: f.text })),
        meaning: tr?.natural_meaning ?? '',
        contextNote: tr?.context_note ?? null,
        register: e.register as MissionExpression['register'],
        audio: audio.filter((a) => a.expression_id === e.id && assetById.has(a.asset_id)).map((a) => ({ asset: mediaAssetToRef(assetById.get(a.asset_id)!), speechRate: a.speech_rate as 'slow' | 'normal' | 'fast', synthetic: a.synthetic, regionalOption: a.regional_option })),
        translationQaState: (tr ? tr.qa_state : 'needs_review') as MissionExpression['translationQaState'],
      };
    };
    const items = rows.map((row) => {
      const card = reviewRowToCard(row);
      const scenarioKey = chooseReviewScenario(card, scenarioPool) ?? scenarioPool[0] ?? 'free_practice';
      const blueprint = SITUATIONAL_BLUEPRINTS.find((b) => b.key === scenarioKey);
      const description = blueprint && t.translator.has(blueprint.titleKey) ? t.translator.t(blueprint.titleKey) : (blueprint ? `${blueprint.situation}: ${blueprint.learnerRole}` : scenarioKey);
      const expression = row.expression_id ? expressions.find((e) => e.id === row.expression_id) : undefined;
      const skill = row.skill_key ? findSkill(row.skill_key) : undefined;
      return {
        card,
        scenario: { id: scenarioKey, description, characterId: null, sceneArt: null },
        expression: expression ? toExpression(expression) : null,
        skill: skill ? { skillKey: skill.skillKey, descriptor: skill.descriptor } : row.skill_key ? { skillKey: row.skill_key, descriptor: row.skill_key } : null,
        estimatedSeconds: row.expression_id ? 90 : 150,
      };
    });
    return respondOk(c, ReviewsDueResponseSchema.parse({ enrollmentId: enrollment.id, dueCount, items, generatedAt: now.toISOString() }));
  });
}
