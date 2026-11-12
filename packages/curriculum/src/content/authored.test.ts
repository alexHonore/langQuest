import { describe, expect, it } from 'vitest';
import { COURSE_TRACKS, getCourseTrack } from '@langquest/contracts';
import { AUTHORED_LIMITS, CHAPTER_2_BLUEPRINT_KEYS, authoredChapterFor, authoredSources, checkAuthoredChapter, expandAuthoredChapter, type AuthoredChapterInput } from './authored';
import { AUTHORED_CHAPTER_2 as AUTHORED_CHAPTERS, AUTHORED_CHAPTER_2_INPUTS } from './authored/chapter-2';
import { findBlueprint } from '../missions/scenarios';

const spanish = AUTHORED_CHAPTER_2_INPUTS.find((c) => c.track === 'spanish-spain')!;
const clone = (c: AuthoredChapterInput): AuthoredChapterInput => JSON.parse(JSON.stringify(c)) as AuthoredChapterInput;

/** [chapter] with [change] applied to the mission of [blueprint]. */
function changed(blueprint: string, change: (mission: AuthoredChapterInput['missions'][number]) => void, chapter: AuthoredChapterInput = spanish): AuthoredChapterInput {
  const copy = clone(chapter);
  change(copy.missions.find((m) => m.blueprint === blueprint)!);
  return copy;
}

describe('chapter 2 of every course', () => {
  it('is written for every course but Chinese Simplified, which shares Mandarin’s', () => {
    expect(AUTHORED_CHAPTER_2_INPUTS.map((c) => c.track).sort()).toEqual(
      COURSE_TRACKS.map((t) => t.id)
        .filter((id) => id !== 'chinese-simplified')
        .sort(),
    );
    expect(AUTHORED_CHAPTERS.map((c) => c.courseTrackId).sort()).toEqual(COURSE_TRACKS.map((t) => t.id).sort());
    const mandarin = AUTHORED_CHAPTERS.find((c) => c.courseTrackId === 'chinese-mandarin')!;
    const simplified = AUTHORED_CHAPTERS.find((c) => c.courseTrackId === 'chinese-simplified')!;
    expect(simplified.key).toBe('chinese_simplified_ch2');
    expect(simplified.missions.map((m) => m.expressions.map((e) => e.targetText))).toEqual(mandarin.missions.map((m) => m.expressions.map((e) => e.targetText)));
    expect(simplified.missions[0]!.key).toBe('chinese_simplified_restaurant_order_meal');
  });

  it.each(AUTHORED_CHAPTER_2_INPUTS.map((c) => [c.track, c] as const))('%s passes every check of the format', (_track, chapter) => {
    expect(checkAuthoredChapter(chapter)).toEqual([]);
  });

  it.each(AUTHORED_CHAPTERS.map((c) => [c.courseTrackId, c] as const))('%s: six missions in story order, taught from the course’s instruction languages, as an unreviewed draft', (_track, chapter) => {
    expect(chapter.chapterIndex).toBe(2);
    expect(chapter.missions.map((m) => m.blueprintKey)).toEqual(CHAPTER_2_BLUEPRINT_KEYS);
    expect(chapter.sourceLanguages).toEqual(authoredSources(chapter.courseTrackId));
    expect(chapter.reviewStatus).toBe('review_needed');
    expect(chapter.nativeReviewed).toBe(false);
    const track = getCourseTrack(chapter.courseTrackId);
    for (const mission of chapter.missions) {
      const slots = findBlueprint(mission.blueprintKey)!.slots;
      // The conversation: every slot's own line, and the lines written around them.
      for (const slot of slots) expect(mission.expressions.filter((e) => e.slotId === slot.slotId).map((e) => [e.key, e.speaker, e.intentKey]), `${mission.key}/${slot.slotId}`).toEqual([[slot.slotId, slot.speaker, slot.intentKey]]);
      for (const e of mission.expressions) {
        expect(e.reviewStatus, `${mission.key}/${e.key}`).toBe('review_needed');
        expect(e.forms.filter((f) => f.transliterationScheme !== null).map((f) => f.transliterationScheme).sort(), `${mission.key}/${e.key}`).toEqual([...track.scripts.transliterations].sort());
        for (const source of chapter.sourceLanguages) expect(e.meanings[source]?.meaning, `${mission.key}/${e.key} from ${source}`).toBeTruthy();
      }
    }
  });

  it('gives French-speaking learners notes of their own, on most lines', () => {
    for (const chapter of AUTHORED_CHAPTER_2_INPUTS.filter((c) => authoredSources(c.track).includes('fr'))) {
      const lines = chapter.missions.flatMap((m) => m.lines);
      const noted = lines.filter((l) => l.fr?.n).length;
      expect(noted / lines.length, `${chapter.track}: ${noted}/${lines.length} lines with a French note`).toBeGreaterThanOrEqual(0.5);
      // Written for French speakers, not copied from the English: no note is the same in both languages.
      expect(lines.filter((l) => l.fr?.n && l.en?.n && l.fr.n === l.en.n).map((l) => l.key), chapter.track).toEqual([]);
    }
  });
});

describe('the checks of the authored format', () => {
  it('the reference chapter expands to keys that never collide with chapter 1', () => {
    const seed = expandAuthoredChapter(spanish);
    expect(seed.key).toBe('spanish_spain_ch2');
    expect(seed.missions[0]!.key).toBe('es_restaurant_order_meal');
    expect(seed.characters.map((c) => c.characterKey)).toContain('es_rafa_waiter');
    // A "+" line is part of the conversation under its own key; a variant is not.
    const meal = seed.missions[0]!;
    const source = spanish.missions[0]!;
    const extra = source.lines.find((l) => l.slot === '+')!;
    const variant = source.lines.find((l) => l.slot === null)!;
    expect(meal.expressions.find((e) => e.key === extra.key)!.slotId).toBe(extra.key);
    expect(meal.expressions.find((e) => e.key === variant.key)!.slotId).toBeNull();
  });

  it('a missing slot, a wrong speaker and blueprints out of order are refused', () => {
    expect(checkAuthoredChapter(changed('restaurant_order_meal', (m) => (m.lines = m.lines.filter((l) => l.key !== 'bill')))).join('\n')).toMatch(/restaurant_order_meal: .*bill/);
    expect(
      checkAuthoredChapter(
        changed('restaurant_order_meal', (m) => {
          m.lines.find((l) => l.key === 'table')!.by = 'character';
        }),
      ).join('\n'),
    ).toMatch(/slot table is said by the learner/);
    const swapped = clone(spanish);
    swapped.missions.reverse();
    expect(checkAuthoredChapter(swapped).join('\n')).toMatch(/expected the blueprints restaurant_order_meal/);
  });

  it('a variant that would take the slot from its own line is refused', () => {
    const stolen = changed('shop_for_clothes', (m) => {
      const own = m.lines.find((l) => l.key === 'variant')!;
      const other = m.lines.find((l) => l.slot === null && l.intent === own.intent)!;
      other.register = own.register;
      other.difficulty = 0.1;
    });
    expect(checkAuthoredChapter(stolen).join('\n')).toMatch(/slot "variant" .* would be filled by "\w+" instead of its own line/);
  });

  it('learner text must be there for each source, French written as French, and lines must be concrete and short', () => {
    const problems = (change: (line: AuthoredChapterInput['missions'][number]['lines'][number]) => void) =>
      checkAuthoredChapter(changed('buy_train_ticket', (m) => change(m.lines.find((l) => l.by === 'learner')!))).join('\n');
    expect(problems((l) => delete l.fr)).toMatch(/fr/);
    expect(problems((l) => (l.fr = { ...l.en! }))).toMatch(/French/i);
    expect(problems((l) => (l.text = 'Un billete para [ciudad], por favor.'))).toMatch(/placeholder/);
    expect(problems((l) => (l.text = `${'muy '.repeat(20)}lejos.`))).toMatch(new RegExp(`longer than ${AUTHORED_LIMITS.text} characters`));
    // A line of another script in a Latin-script course.
    expect(problems((l) => (l.text = 'Один билет, пожалуйста.'))).toMatch(/not written in Latn/);
  });

  it('a course in another script needs its script and every transliteration', () => {
    const japanese = AUTHORED_CHAPTER_2_INPUTS.find((c) => c.track === 'japanese')!;
    expect(
      checkAuthoredChapter(
        changed(
          'restaurant_order_meal',
          (m) => {
            delete m.lines[0]!.forms!.romaji;
          },
          japanese,
        ),
      ).join('\n'),
    ).toMatch(/missing the romaji form/);
    // The same chapter under another course is not that course's language.
    expect(checkAuthoredChapter(authoredChapterFor('korean', japanese)).length).toBeGreaterThan(0);
  });
});
