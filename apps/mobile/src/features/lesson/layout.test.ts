import { describe, expect, it } from 'vitest';
import { MAX_CHOICE_OPTIONS, MIN_SCENE_HEIGHT, fitScene, pickChoiceOptions } from './layout';

describe('fitScene (lesson pages fit the screen, device QA 2026-10-20)', () => {
  it('takes the free height, capped at a 16:9 band of the width', () => {
    expect(fitScene(370, 120)).toEqual({ visible: true, height: 120 });
    expect(fitScene(370, 600)).toEqual({ visible: true, height: Math.floor(370 / (16 / 9)) });
  });

  it('hides the scene instead of drawing a strip or overflowing', () => {
    expect(fitScene(370, MIN_SCENE_HEIGHT - 1)).toEqual({ visible: false, height: 0 });
    expect(fitScene(370, 0)).toEqual({ visible: false, height: 0 });
    expect(fitScene(0, 300)).toEqual({ visible: false, height: 0 });
    expect(fitScene(370, Number.NaN)).toEqual({ visible: false, height: 0 });
  });
});

const EIGHT = ['Bonjour', 'Bonjour (réponse)', 'Ça va ?', 'Ça va, Dieu merci.', "Je m'appelle …", 'Comment tu t’appelles ?', 'Enchanté(e).', 'Au revoir.'].map((label, i) => ({ id: `e${i}`, label }));

describe('pickChoiceOptions', () => {
  it('keeps the answer and caps the list (8 rows overflowed an iPhone 17)', () => {
    const picked = pickChoiceOptions(EIGHT, 'e0', 'step-3');
    expect(picked).toHaveLength(MAX_CHOICE_OPTIONS);
    expect(picked.map((o) => o.id)).toContain('e0');
    expect(new Set(picked.map((o) => o.id)).size).toBe(picked.length);
  });

  it('is stable for a step and does not always put the answer first', () => {
    expect(pickChoiceOptions(EIGHT, 'e0', 'step-3')).toEqual(pickChoiceOptions(EIGHT, 'e0', 'step-3'));
    const firstIsAnswer = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].filter((seed) => pickChoiceOptions(EIGHT, 'e0', seed)[0]!.id === 'e0').length;
    expect(firstIsAnswer).toBeLessThan(10);
  });

  it('drops blank and duplicate-meaning distractors', () => {
    const picked = pickChoiceOptions([{ id: 'a', label: 'Bonjour' }, { id: 'b', label: 'Bonjour' }, { id: 'c', label: ' ' }, { id: 'd', label: 'Merci' }], 'a', 's');
    expect(picked.map((o) => o.id).sort()).toEqual(['a', 'd']);
  });

  it('works with a short step (fewer expressions than the cap)', () => {
    expect(pickChoiceOptions(EIGHT.slice(0, 2), 'e1', 's')).toHaveLength(2);
  });
});
