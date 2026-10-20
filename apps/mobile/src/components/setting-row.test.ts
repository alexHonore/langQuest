import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Pressable: () => null, Switch: () => null, View: () => null }));
vi.mock('@langquest/ui', () => ({ Chip: () => null, Row: () => null, ThemedText: () => null, useTheme: () => ({}) }));

describe('SwitchRow accessibility (VoiceOver could read but not toggle settings, device QA 2026-10-20)', () => {
  it('exposes one switch with label, hint and checked state', async () => {
    const { switchRowAccessibility } = await import('./SettingRow');
    expect(switchRowAccessibility({ label: 'Réduire les animations', hint: 'Comme le système', value: false })).toEqual({
      accessibilityRole: 'switch',
      accessibilityLabel: 'Réduire les animations',
      accessibilityHint: 'Comme le système',
      accessibilityState: { checked: false, disabled: false },
    });
  });
  it('activating the row toggles it, and does nothing while disabled', async () => {
    const { switchRowActivation } = await import('./SettingRow');
    expect(switchRowActivation({ value: false })).toBe(true);
    expect(switchRowActivation({ value: true })).toBe(false);
    expect(switchRowActivation({ value: true, disabled: true })).toBeNull();
  });
});
