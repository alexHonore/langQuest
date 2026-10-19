/**
 * XP amounts — single source of truth shared by the database and every runtime.
 *
 * Mirrors `public.xp_amount_for_reason(text)` in `supabase/migrations/20261014100600_060_functions.sql`
 * EXACTLY; `award_xp` pays these amounts server-side and `apply_sync_events` rejects unknown reasons.
 * `@langquest/curriculum` (`XP_RULES`) and the API import this table; change the SQL and this file together.
 * XP is never proof of proficiency (§3.8): mastery lives in observations.
 */
import { XP_REASON_VALUES, type XpReason } from './enums';

export const XP_AMOUNTS: Readonly<Record<XpReason, number>> = Object.freeze({
  mission_completed: 50,
  step_completed: 5,
  review_completed: 3,
  conversation_turns: 2,
  skill_state_advanced: 20,
  audio_lesson_completed: 15,
  daily_goal: 25,
  achievement: 30,
});

/** Amount for a reason, or 0 for an unknown one — same contract as the SQL function. */
export function xpAmountForReason(reason: string): number {
  return (XP_REASON_VALUES as readonly string[]).includes(reason) ? XP_AMOUNTS[reason as XpReason] : 0;
}
