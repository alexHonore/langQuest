import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ AppState: { addEventListener: vi.fn() }, Platform: { OS: 'ios' } }));
vi.mock('expo-router', () => ({ useFocusEffect: vi.fn() }));

describe('isAppFocused (React Query focus on native)', () => {
  it('only an active app counts as focused', async () => {
    const { isAppFocused } = await import('./query-focus');
    expect(isAppFocused('active')).toBe(true);
    expect(isAppFocused('background')).toBe(false);
    expect(isAppFocused('inactive')).toBe(false);
  });
});
