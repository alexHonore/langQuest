import { PostgrestError } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { DbError, unwrap, unwrapMaybe } from './errors';

const pgError = (code: string, message = 'boom') => new PostgrestError({ code, message, details: 'd', hint: 'h' });

describe('unwrap', () => {
  it('returns data and throws DbError with code on error', () => {
    expect(unwrap({ data: { id: 1 }, error: null })).toEqual({ id: 1 });
    expect(() => unwrap({ data: null, error: pgError('42501') }, 'ctx')).toThrowError(/ctx: boom/);
    try {
      unwrap({ data: null, error: pgError('23505') });
    } catch (e) {
      expect(e).toBeInstanceOf(DbError);
      expect((e as DbError).isUniqueViolation).toBe(true);
      expect((e as DbError).isForbidden).toBe(false);
    }
  });
  it('unwrapMaybe maps PGRST116 to null and rethrows everything else', () => {
    expect(unwrapMaybe({ data: null, error: pgError('PGRST116') })).toBeNull();
    expect(unwrapMaybe({ data: 'x', error: null })).toBe('x');
    expect(() => unwrapMaybe({ data: null, error: pgError('P0002') })).toThrow(DbError);
  });
});
