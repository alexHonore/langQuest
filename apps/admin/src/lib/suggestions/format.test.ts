import { describe, expect, it } from 'vitest';
import { currentFields, formatConfidence, parseOverride, proposalChanges, proposedFields, renderJsonValue } from './format';

describe('suggestion formatting', () => {
  it('renders proposals as stable field rows', () => {
    expect(proposedFields({ topic: 'market', tags: ['food', 'prices'], level: null })).toEqual([
      { key: 'level', value: '—' },
      { key: 'tags', value: 'food, prices' },
      { key: 'topic', value: 'market' },
    ]);
    expect(renderJsonValue({ a: 1 })).toBe('{"a":1}');
    expect(renderJsonValue([])).toBe('[]');
  });

  it('maps the current value onto the proposed keys', () => {
    expect(currentFields({ topic: 'shop', tags: [] }, { topic: 'market' })).toEqual({ topic: 'shop', tags: '[]' });
    expect(currentFields('shop', { topic: 'market' })).toEqual({ topic: 'shop' });
    expect(currentFields(null, { topic: 'market', level: 'beginner' })).toEqual({});
  });

  it('detects no-op proposals', () => {
    expect(proposalChanges({ topic: 'market' }, { topic: 'market' })).toBe(false);
    expect(proposalChanges({ topic: 'market' }, { topic: 'shop' })).toBe(true);
    expect(proposalChanges({ topic: 'market' }, null)).toBe(true);
  });

  it('accepts only JSON objects as overrides', () => {
    expect(parseOverride('{"topic":"bakery"}')).toEqual({ topic: 'bakery' });
    expect(parseOverride('["a"]')).toBeNull();
    expect(parseOverride('not json')).toBeNull();
  });

  it('shows confidence as reported and null when missing', () => {
    expect(formatConfidence(0.734)).toBe('73%');
    expect(formatConfidence(null)).toBeNull();
  });
});
