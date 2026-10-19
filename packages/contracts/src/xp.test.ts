import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { XP_REASON_VALUES } from './enums';
import { XP_AMOUNTS, xpAmountForReason } from './xp';

const SQL = resolve(import.meta.dirname, '../../../supabase/migrations/20261014100600_060_functions.sql');

/** Parses `when '<reason>' then <n>` pairs out of `xp_amount_for_reason`. */
function sqlAmounts(): Record<string, number> {
  const sql = readFileSync(SQL, 'utf8');
  const body = sql.slice(sql.indexOf('function public.xp_amount_for_reason'));
  const fn = body.slice(0, body.indexOf('$$;'));
  const out: Record<string, number> = {};
  for (const m of fn.matchAll(/when '([a-z_]+)' then (\d+)/g)) out[m[1]!] = Number(m[2]);
  return out;
}

describe('XP_AMOUNTS mirrors public.xp_amount_for_reason', () => {
  it('has exactly the SQL reasons with the SQL amounts', () => {
    const fromSql = sqlAmounts();
    expect(Object.keys(fromSql).sort()).toEqual([...XP_REASON_VALUES].sort());
    expect({ ...XP_AMOUNTS }).toEqual(fromSql);
  });

  it('every XpReason has a positive amount and unknown reasons pay 0 (same as SQL `else 0`)', () => {
    for (const reason of XP_REASON_VALUES) expect(XP_AMOUNTS[reason]).toBeGreaterThan(0);
    expect(xpAmountForReason('mission_completed')).toBe(XP_AMOUNTS.mission_completed);
    expect(xpAmountForReason('premium_bonus')).toBe(0);
    expect(Object.isFrozen(XP_AMOUNTS)).toBe(true);
  });
});
