import { describe, expect, it } from 'vitest';
import { INTENTS, INTENT_KEYS, getIntent, intentsForConcept, intentsForSkill, isAcceptableParaphrase, validateIntentRegistry } from './intents';
import { SKILLS } from './skills';

describe('intents registry', () => {
  it('has at least 80 intents with unique keys and valid references', () => {
    expect(INTENTS.length).toBeGreaterThanOrEqual(80);
    expect(new Set(INTENT_KEYS).size).toBe(INTENTS.length);
    expect(validateIntentRegistry()).toEqual([]);
  });

  it('every intent has language-neutral acceptable variants and a social meaning', () => {
    for (const i of INTENTS) {
      expect(i.acceptableVariants.length).toBeGreaterThan(0);
      expect(i.socialMeaning.length).toBeGreaterThan(5);
    }
  });

  it('every skill has at least one intent giving evidence for it', () => {
    const uncovered = SKILLS.filter((s) => intentsForSkill(s.skillKey).length === 0).map((s) => s.skillKey);
    expect(uncovered).toEqual([]);
  });

  it('groups paraphrase-equivalent intents by concept', () => {
    const concept = getIntent('ask_price').conceptId;
    expect(intentsForConcept(concept).map((i) => i.intentKey)).toContain('ask_fare');
  });

  it('accepts semantic paraphrases but rejects rude/offensive or opposite-polarity ones', () => {
    expect(isAcceptableParaphrase('ask_price', 'ask_fare')).toBe(true);
    expect(isAcceptableParaphrase('greet_hello', 'greet_time_of_day')).toBe(true);
    expect(isAcceptableParaphrase('request_item', 'bare_command')).toBe(false);
    expect(isAcceptableParaphrase('reply_fine', 'reply_not_great')).toBe(false);
    expect(isAcceptableParaphrase('greet_hello', 'insult')).toBe(false);
    expect(isAcceptableParaphrase('greet_hello', 'nope_not_a_key')).toBe(false);
  });
});
