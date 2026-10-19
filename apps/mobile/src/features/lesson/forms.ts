/**
 * Per-enrollment script mode (§2.3 `target_script_mode`) applied to expression
 * forms, plus the source-language text direction (§2.2: `ar`/`he` are valid
 * instruction languages inside an LTR UI). Pure helpers shared by the lesson,
 * review, pronunciation and conversation screens.
 */
import type { MissionExpression, ScriptId, ScriptMode } from '@langquest/contracts';
import { isRtlLocale, isolateBidi, type TextDirection } from '@langquest/locales';

export interface DisplayForm {
  text: string;
  /** Script the text is rendered in (`Latn` for transliterations). */
  script: ScriptId;
  /** Transliteration scheme id, or null for native-script text. */
  transliterationScheme: string | null;
}

type FormLike = Pick<MissionExpression['forms'][number], 'text' | 'script' | 'transliterationScheme'>;

/**
 * Forms to render for `mode`:
 * - `native`: native-script forms only;
 * - `latin`: transliterations only (falls back to native when the expression has none, never hides the text);
 * - `both`: native first, then transliterations (spec §2.3 display order).
 * When the expression carries no usable form, the canonical text is returned as a native form.
 */
export function formsForScriptMode(expression: Pick<MissionExpression, 'canonicalText' | 'forms'>, primaryScript: ScriptId, mode: ScriptMode): DisplayForm[] {
  const native = expression.forms.filter((f: FormLike) => f.transliterationScheme === null);
  const translit = expression.forms.filter((f: FormLike) => f.transliterationScheme !== null);
  const toDisplay = (f: FormLike): DisplayForm => ({ text: f.text, script: f.transliterationScheme ? 'Latn' : ((f.script as ScriptId | null) ?? primaryScript), transliterationScheme: f.transliterationScheme });
  const canonical: DisplayForm = { text: expression.canonicalText, script: primaryScript, transliterationScheme: null };
  const nativeForms = native.length > 0 ? native.map(toDisplay) : [canonical];
  if (mode === 'native') return nativeForms;
  if (mode === 'latin') return translit.length > 0 ? translit.map(toDisplay) : nativeForms;
  return [...nativeForms, ...translit.map(toDisplay)];
}

/** Which of a conversation turn's two text layers to show for the enrollment's script mode. */
export function turnLayersForScriptMode(turn: { text: string; transliteration: string | null }, mode: ScriptMode): { primary: string; secondary: string | null; primaryIsTransliteration: boolean } {
  if (mode === 'latin' && turn.transliteration) return { primary: turn.transliteration, secondary: null, primaryIsTransliteration: true };
  if (mode === 'native') return { primary: turn.text, secondary: null, primaryIsTransliteration: false };
  return { primary: turn.text, secondary: turn.transliteration, primaryIsTransliteration: false };
}

/** Direction of instruction-language text (hints, meanings, glosses) for one enrollment. */
export function sourceTextDirection(sourceLanguageCode: string | null | undefined): TextDirection {
  return sourceLanguageCode && isRtlLocale(sourceLanguageCode) ? 'rtl' : 'ltr';
}

/** Isolate a source-language segment so it cannot reorder the LTR chrome around it (ui components we cannot pass `direction` to). */
export function isolateSourceText(text: string, sourceLanguageCode: string | null | undefined): string {
  return isolateBidi(text, sourceTextDirection(sourceLanguageCode));
}
