import { describe, expect, it } from 'vitest';
import { canAccessSection, sectionForPath, visibleSections } from './roles';

describe('setup section', () => {
  it('is an admin-only section with its own path', () => {
    expect(sectionForPath('/setup')).toBe('setup');
    expect(canAccessSection(['admin'], 'setup')).toBe(true);
    expect(canAccessSection(['super_admin'], 'setup')).toBe(true);
    expect(canAccessSection(['content_editor'], 'setup')).toBe(false);
    expect(canAccessSection(['language_reviewer'], 'setup')).toBe(false);
  });

  it('is the first sidebar item while the deployment is incomplete, and sits with Settings otherwise', () => {
    const incomplete = visibleSections(['admin'], { setupIncomplete: true });
    expect(incomplete[0]).toBe('setup');
    expect(incomplete.filter((s) => s === 'setup')).toHaveLength(1);
    const complete = visibleSections(['admin']);
    expect(complete[0]).toBe('dashboard');
    expect(complete.indexOf('setup')).toBe(complete.indexOf('settings') - 1);
  });

  it('never appears for roles that cannot open it, incomplete or not', () => {
    expect(visibleSections(['content_editor'], { setupIncomplete: true })).not.toContain('setup');
  });
});
