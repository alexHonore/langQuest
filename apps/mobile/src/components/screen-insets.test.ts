import { describe, expect, it } from 'vitest';
import { screenInsets } from './screen-insets';

// iPhone 17 portrait safe area (Dynamic Island + home indicator).
const PHONE = { top: 62, bottom: 34, left: 0, right: 0 };

describe('screenInsets (device QA 2026-10-20: tab headers under the status bar)', () => {
  it('pads tab screens below the status bar; the tab bar keeps the bottom edge', () => {
    expect(screenInsets(PHONE, { insideTabs: true })).toEqual({ top: 62, bottom: 0, left: 0, right: 0 });
    expect(screenInsets(PHONE, { insideTabs: true, hasFooter: true }).bottom).toBe(0);
  });

  it('pads stack screens at the top and only pads the bottom for a footer', () => {
    expect(screenInsets(PHONE)).toEqual({ top: 62, bottom: 0, left: 0, right: 0 });
    expect(screenInsets(PHONE, { hasFooter: true }).bottom).toBe(34);
  });

  it('keeps landscape side insets', () => {
    expect(screenInsets({ top: 0, bottom: 21, left: 59, right: 59 }, { insideTabs: true })).toEqual({ top: 0, bottom: 0, left: 59, right: 59 });
  });
});
