import { describe, expect, it } from 'vitest';
import { INTENTS } from '@langquest/curriculum';
import { INTENT_PATTERNS, guessIntents, intentsCoveredByHeuristics, scenarioTagsForIntent, validateIntentPatterns } from './intent-heuristics';

describe('intent heuristics', () => {
  it('references only known intents and covers most of the registry', () => {
    expect(validateIntentPatterns()).toEqual([]);
    const { covered, uncovered } = intentsCoveredByHeuristics();
    expect(covered.length).toBeGreaterThan(INTENTS.length * 0.75);
    expect(uncovered).not.toContain('greet_hello');
    expect(Object.keys(INTENT_PATTERNS)).toEqual(expect.arrayContaining(['eng', 'fra', 'spa']));
  });

  it('guesses intents from the target text and corroborates with the English translation', () => {
    const spa = guessIntents({ text: '¿Cuánto cuesta esto?', lang: 'spa' }, { text: 'How much does this cost?' });
    expect(spa[0]?.intentKey).toBe('ask_price');
    expect(spa[0]?.confidence).toBeGreaterThan(0.95);
    expect(spa[0]?.evidence.map((e) => e.via)).toEqual(['target', 'eng']);

    const fra = guessIntents({ text: "Je voudrais un café, s'il vous plaît.", lang: 'fra' });
    expect(fra[0]?.intentKey).toBe('request_drink');

    const rus = guessIntents({ text: 'Где вокзал?', lang: 'rus' }, { text: 'Where is the station?' });
    expect(rus[0]?.intentKey).toBe('ask_where_is');
    expect(rus[0]?.evidence[0]?.via).toBe('eng');
  });

  it('never proposes bare_command or insult and returns [] for unmatched text', () => {
    expect(guessIntents({ text: 'The weather report mentioned isobars.', lang: 'eng' })).toEqual([]);
    const all = Object.values(INTENT_PATTERNS).flat().map((p) => p.intentKey);
    expect(all).not.toContain('insult');
  });

  it('maps intents to scenario tags by concept', () => {
    expect(scenarioTagsForIntent('ask_price')).toEqual(['market']);
    expect(scenarioTagsForIntent('ask_where_is')).toEqual(['directions']);
    expect(scenarioTagsForIntent('nope')).toEqual([]);
  });
});
