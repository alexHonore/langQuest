import type { SeedChapter, SeedExpression } from './types';

/** A short Cairo greeting using phrases already recorded for the course. */
export function withEgyptianGreetingDialogue(chapter: SeedChapter, authoredChapters: readonly SeedChapter[]): SeedChapter {
  if (chapter.key !== 'arabic_egyptian_ch1') return chapter;

  const reference = authoredChapters
    .find((candidate) => candidate.key === 'arabic_egyptian_ch3')
    ?.missions.find((mission) => mission.key === 'arabic_egyptian_describe_your_day');

  function reuse(key: string, from: string): SeedExpression {
    const expression = reference?.expressions.find((candidate) => candidate.key === from);
    if (!expression) throw new Error('The Egyptian Arabic greeting is missing its recorded line ' + from);
    return { ...expression, key, slotId: null };
  }

  return {
    ...chapter,
    missions: chapter.missions.map((mission) => {
      if (mission.blueprintKey !== 'greet_and_introduce') return mission;

      return {
        ...mission,
        sceneNotes: {
          fr: 'Dans votre rue au Caire, Mona vous salue et vous demande ce que vous faites ici.',
          en: 'On your street in Cairo, Mona greets you and asks what you do here.',
        },
        sceneOrder: ['mona_morning', 'fine', 'mona_ask_about_work', 'work_in_design'],
        expressions: [
          ...mission.expressions,
          reuse('mona_morning', 'you_look_tired'),
          reuse('mona_ask_about_work', 'what_job'),
          reuse('work_in_design', 'job'),
        ],
      };
    }),
  };
}
