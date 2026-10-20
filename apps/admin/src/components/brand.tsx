'use client';
/**
 * Brand spots of the Studio, all drawn from the shared art module (`@langquest/ui/art/web`
 * string renderers — original in-code vector art, no text baked in):
 *
 * - `Melo` — the chameleon mascot. Like a chameleon it changes colour with the situation
 *   (`state`) and with the active course (the working context's track, through the course
 *   family hue dial). Theme follows the Studio scheme.
 * - `CastPortrait` — a C2 clay portrait of a roster character (flat level of detail ≤ 48 px).
 * - `Lanterns` — the three soft lantern glows of the direction, coloured by the course × lesson
 *   accent variables set on the shell (`--lantern-1..3`); decorative only.
 */
import clsx from 'clsx';
import { useMemo, type CSSProperties } from 'react';
import type { CharacterExpression, MascotState } from '@langquest/contracts';
import { mascotSvgString } from '@art/mascot';
import { characterPortraitSvgString, findCharacter } from '@art/characters';
import { useI18n } from '@/src/lib/i18n/client';
import { useWorkingContext } from '@/src/lib/working-context';
import { useScheme } from '@/src/lib/visual/scheme';
import { InlineArt } from './ui';

export interface MeloProps {
  state?: MascotState;
  /** Render size in px (drives the art's level of detail). */
  size?: number;
  /** Course track for the chameleon tint; defaults to the working context's active course. */
  trackId?: string | null;
  className?: string;
}

export function Melo({ state = 'neutral', size = 64, trackId, className }: MeloProps) {
  const { t } = useI18n();
  const scheme = useScheme();
  const [ctx] = useWorkingContext();
  const track = trackId === undefined ? ctx.courseTrackId : trackId;
  const svg = useMemo(() => mascotSvgString(state, { size, theme: scheme, trackId: track }), [state, size, scheme, track]);
  return <InlineArt svg={svg} label={t(`mascot.a11yState.${state}`)} className={clsx('shrink-0', className)} style={{ width: size, height: size }} />;
}

export interface CastPortraitProps {
  characterId: string;
  expression?: CharacterExpression;
  size?: number;
  className?: string;
}

/** Portrait of a roster character; renders nothing for an unknown id (never a placeholder). */
export function CastPortrait({ characterId, expression = 'neutral', size = 40, className }: CastPortraitProps) {
  const scheme = useScheme();
  const character = findCharacter(characterId);
  const svg = useMemo(() => (character ? characterPortraitSvgString(character.id, expression, { size, theme: scheme }) : null), [character, expression, size, scheme]);
  if (!character || !svg) return null;
  return <InlineArt svg={svg} label={character.altText} className={clsx('shrink-0 overflow-hidden rounded-full', className)} style={{ width: size, height: size }} />;
}

/** Decorative lantern glows (course × lesson colours come from the shell's CSS variables). */
export function Lanterns({ className }: { className?: string }) {
  const blob = (i: 1 | 2 | 3, style: CSSProperties) => (
    <span key={i} className="absolute rounded-full blur-2xl" style={{ background: `var(--lantern-${i})`, opacity: 'var(--lantern-opacity)' as unknown as number, ...style }} />
  );
  return (
    <div aria-hidden="true" className={clsx('pointer-events-none absolute inset-0 overflow-hidden', className)}>
      {blob(1, { width: '55%', height: '140%', left: '-15%', top: '-40%' })}
      {blob(2, { width: '45%', height: '120%', left: '35%', top: '-10%' })}
      {blob(3, { width: '50%', height: '130%', right: '-15%', top: '-50%' })}
    </div>
  );
}
