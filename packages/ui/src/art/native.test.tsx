import type React from 'react';
import { describe, expect, it, vi } from 'vitest';

// react-native-svg needs the RN runtime; stand in with tag-named components so the
// element tree (not pixels) can be verified in Node.
vi.mock('react-native-svg', async () => {
  const React = await import('react');
  const make = (tag: string) => {
    const C = (props: Record<string, unknown>) => React.createElement(tag, props);
    C.displayName = tag;
    return C;
  };
  return {
    default: make('svg'),
    Svg: make('svg'),
    G: make('g'),
    Circle: make('circle'),
    Ellipse: make('ellipse'),
    Path: make('path'),
    Rect: make('rect'),
    Line: make('line'),
    Polyline: make('polyline'),
    Polygon: make('polygon'),
    Defs: make('defs'),
    LinearGradient: make('linearGradient'),
    RadialGradient: make('radialGradient'),
    Stop: make('stop'),
    ClipPath: make('clipPath'),
  };
});

import { CHARACTER_EXPRESSIONS, CHARACTER_ROSTER } from './characters';
import { ICON_NAMES } from './icons';
import { MASCOT_STATES, buildMascotNodes } from './mascot';
import {
  CharacterPortraitSvg,
  CourseCoverSvg,
  ICONS,
  MascotSvg,
  SceneArtSvg,
  renderSvgNode,
} from './native';
import { countNodes } from './svg-node';

type El = React.ReactElement<Record<string, unknown>>;

/** Expand function components and count host (string-tag) elements. */
function flatten(el: unknown): { tags: string[]; props: Array<Record<string, unknown>> } {
  const tags: string[] = [];
  const props: Array<Record<string, unknown>> = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!node || typeof node !== 'object' || !('type' in node)) return;
    const e = node as El;
    if (typeof e.type === 'function') {
      walk((e.type as (p: Record<string, unknown>) => unknown)(e.props));
      return;
    }
    tags.push(String(e.type));
    props.push(e.props);
    walk(e.props.children);
  };
  walk(el);
  return { tags, props };
}

describe('react-native-svg renderer', () => {
  it('renders every mascot state to an accessible Svg root', () => {
    for (const state of MASCOT_STATES) {
      const el = MascotSvg({ state, size: 64, theme: 'dark', reducedMotion: true }) as El;
      const { tags, props } = flatten(el);
      expect(tags[0]).toBe('svg');
      expect(props[0]?.accessibilityLabel).toContain('Mascot');
      expect(props[0]?.viewBox).toBe('0 0 100 100');
      expect(props[0]?.width).toBe(64);
      // The RN tree mirrors the shared node tree one-to-one.
      expect(tags.length - 1).toBe(
        countNodes(buildMascotNodes(state, { size: 64, theme: 'dark' })),
      );
    }
  });
  it('honours a custom accessibility label', () => {
    const { props } = flatten(MascotSvg({ state: 'welcome', accessibilityLabel: 'Bonjour !' }));
    expect(props[0]?.accessibilityLabel).toBe('Bonjour !');
  });
  it('is static unless animation is requested and motion is not reduced', () => {
    const staticEl = MascotSvg({ state: 'neutral' }) as El;
    expect(typeof staticEl.type).toBe('function'); // Svg stub root, no animated wrapper
    expect(flatten(staticEl).tags[0]).toBe('svg');
    const reduced = MascotSvg({ state: 'neutral', animate: true, reducedMotion: true }) as El;
    expect(flatten(reduced).tags[0]).toBe('svg');
    const animated = MascotSvg({ state: 'neutral', animate: true }) as El;
    expect((animated.type as { name?: string }).name).toBe('AnimatedMascot');
  });
  it('renders character portraits, scenes, covers and icons', () => {
    const c = CHARACTER_ROSTER[0]!;
    for (const e of CHARACTER_EXPRESSIONS)
      expect(flatten(CharacterPortraitSvg({ characterId: c.id, expression: e })).tags[0]).toBe(
        'svg',
      );
    const scene = flatten(SceneArtSvg({ sceneId: 'cafe', width: 200, variant: 'evening' }));
    expect(scene.tags[0]).toBe('svg');
    expect(scene.props[0]?.height).toBe(113);
    expect(
      flatten(CourseCoverSvg({ trackId: 'arabic-moroccan', width: 150 })).props[0]?.height,
    ).toBe(100);
    for (const n of ICON_NAMES) {
      const { tags, props } = flatten(ICONS[n]({ size: 20, color: '#ABCDEF' }));
      expect(tags[0]).toBe('svg');
      expect(props[0]?.width).toBe(20);
      expect(props.some((p) => p.stroke === '#ABCDEF' || p.fill === '#ABCDEF')).toBe(true);
    }
  });
  it('passes camelCase attrs through untouched and drops undefined', () => {
    const el = renderSvgNode(
      { tag: 'rect', attrs: { x: 1, strokeWidth: 2, fill: undefined } },
      'k',
    ) as El;
    expect(el.props).toEqual({ x: 1, strokeWidth: 2 });
    expect(el.key).toBe('k');
  });
});
