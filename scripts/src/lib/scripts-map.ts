/** Default writing script per LangQuest language code (from the contracts catalog). */
import { LANGUAGES, type ScriptId } from '@langquest/contracts';

export const SCRIPT_FOR_LANGUAGE: Readonly<Record<string, ScriptId>> = Object.fromEntries(LANGUAGES.map((l) => [l.code, l.defaultScript]));
