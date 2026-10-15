import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runTaskmaster, renderSkeletonsMarkdown } from '../import-taskmaster';
import { ScenarioSkeletonSchema, actOf, condenseActs, domainOf, extractPattern, parseAnnotation, type TmDialog } from './taskmaster';

const FIXTURES = resolve(__dirname, '../fixtures/taskmaster');

describe('taskmaster pattern extraction', () => {
  it('maps instruction ids to domains and parses annotations', () => {
    expect(domainOf('movie-tickets-2')).toBe('movie-tickets');
    expect(domainOf('movie')).toBe('movie-tickets');
    expect(domainOf('coffee-ordering-1')).toBe('coffee-ordering');
    expect(domainOf('uber-lyft-1')).toBe('uber-lyft');
    expect(domainOf('unknown-thing-3')).toBeNull();
    expect(parseAnnotation('movie_ticket.location.theater.accept')).toEqual({ slot: 'location.theater', act: 'accept' });
    expect(parseAnnotation('coffee_order.size.drink')).toEqual({ slot: 'size.drink', act: null });
  });

  it('abstracts utterances into acts without leaking text', () => {
    const dialog: TmDialog = {
      conversation_id: 'dlg-1',
      instruction_id: 'coffee-ordering-1',
      utterances: [
        { index: 0, speaker: 'ASSISTANT', text: 'Hi there! How can I help?' },
        { index: 1, speaker: 'USER', text: "I'd like a large latte.", segments: [{ start_index: 9, end_index: 14, text: 'large', annotations: [{ name: 'coffee_order.size.drink' }] }, { start_index: 15, end_index: 20, text: 'latte', annotations: [{ name: 'coffee_order.type.drink' }] }] },
        { index: 2, speaker: 'ASSISTANT', text: 'Sorry, we are out of oat milk. Almond instead?' },
        { index: 3, speaker: 'USER', text: 'Actually, make it a small.', segments: [{ start_index: 20, end_index: 25, text: 'small', annotations: [{ name: 'coffee_order.size.drink' }] }] },
        { index: 4, speaker: 'ASSISTANT', text: 'Your order has been placed.' },
        { index: 5, speaker: 'USER', text: 'Thanks!' },
      ],
    };
    expect(actOf(dialog.utterances[0]!).act).toBe('assistant.greet');
    expect(actOf(dialog.utterances[1]!)).toEqual({ act: 'user.request', slots: ['size.drink', 'type.drink'] });
    expect(actOf(dialog.utterances[2]!).act).toBe('assistant.unavailable');
    expect(actOf(dialog.utterances[3]!).act).toBe('user.revise');
    expect(actOf(dialog.utterances[4]!).act).toBe('assistant.confirm');
    expect(actOf(dialog.utterances[5]!).act).toBe('user.thank');
    const p = extractPattern(dialog)!;
    expect(p).toMatchObject({ domain: 'coffee-ordering', turnCount: 6, revisions: 1, unavailable: 1, slotOrder: ['size.drink', 'type.drink'] });
    expect(condenseActs(p.acts)).toBe('assistant.greet > user.request > assistant.unavailable > user.revise > assistant.confirm > user.thank');
    expect(JSON.stringify(p)).not.toContain('latte');
  });

  it('builds per-domain skeletons from the fixture clone with a CC BY attribution record', async () => {
    const run = await runTaskmaster({ dir: FIXTURES, files: ['self-dialogs.json', 'woz-dialogs.json'], limit: 0, top: 5, now: new Date('2026-10-14T00:00:00Z') });
    expect(run.attribution.dialogsRead).toBe(50);
    expect(run.attribution.licenseId).toBe('CC-BY');
    expect(run.attribution.licenseVersion).toBe('4.0');
    expect(run.attribution.inputs).toHaveLength(2);
    expect(run.skeletons.length).toBe(6);
    for (const s of run.skeletons) {
      expect(ScenarioSkeletonSchema.safeParse(s).success).toBe(true);
      expect(s.sampleSize).toBeGreaterThan(0);
      expect(s.brief.length).toBeGreaterThan(3);
      expect(s.turnCount.max).toBeGreaterThanOrEqual(s.turnCount.min);
    }
    const coffee = run.skeletons.find((s) => s.domain === 'coffee-ordering')!;
    expect(coffee.blueprintKey).toBe('cafe_order_drink');
    expect(coffee.slots.required).toContain('name.drink');
    expect(coffee.intentKeys).toContain('request_drink');
    const md = renderSkeletonsMarkdown(run);
    expect(md).toContain('## coffee-ordering → cafe_order_drink');
    // No utterance text leaks into the markdown (texts contain lowercase sentences with articles; acts are dotted labels).
    expect(md).not.toMatch(/\bI would like\b/);
  });
});
