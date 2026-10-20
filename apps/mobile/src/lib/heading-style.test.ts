import { describe, expect, it } from 'vitest';
import { HEADING_FORBIDDEN_STYLE_KEYS, HEADING_WRAP_STYLE, headingCanWrap } from './heading-style';

describe('HEADING_WRAP_STYLE (display / title headings wrap at 375–430 px)', () => {
  it('lets the heading shrink and span its column, with no fixed box or single-line constraint', () => {
    expect(HEADING_WRAP_STYLE.flexShrink).toBeGreaterThan(0);
    expect(HEADING_WRAP_STYLE.alignSelf).toBe('stretch');
    expect(HEADING_WRAP_STYLE.maxWidth).toBe('100%');
    for (const k of HEADING_FORBIDDEN_STYLE_KEYS) expect(HEADING_WRAP_STYLE[k], k).toBeUndefined();
    expect(headingCanWrap(HEADING_WRAP_STYLE)).toBe(true);
  });

  it('rejects styles that would clip a long French heading', () => {
    expect(headingCanWrap({ ...HEADING_WRAP_STYLE, width: 320 })).toBe(false);
    expect(headingCanWrap({ ...HEADING_WRAP_STYLE, flexShrink: 0 })).toBe(false);
    expect(headingCanWrap({ ...HEADING_WRAP_STYLE, flexWrap: 'nowrap' })).toBe(false);
    expect(headingCanWrap({ flexShrink: 1 })).toBe(false);
    expect(headingCanWrap(null)).toBe(false);
  });

  it('is frozen so a screen cannot mutate the shared style', () => {
    expect(Object.isFrozen(HEADING_WRAP_STYLE)).toBe(true);
  });
});
