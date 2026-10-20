/**
 * Small themed building blocks shared by the components: text, surfaces,
 * buttons, chips, rows (RTL-aware) and a progress bar. Every interactive
 * primitive takes an `accessibilityLabel` and sets a role.
 */
import type { ScriptId } from '@langquest/contracts';
import React from 'react';
import {
  type AccessibilityRole,
  type AccessibilityState,
  Pressable,
  type PressableProps,
  type StyleProp,
  Text,
  type TextProps,
  type TextStyle,
  View,
  type ViewProps,
  type ViewStyle,
} from 'react-native';
import { ICONS, type IconName } from '../art';
import type { Theme } from '../theme/resolve';
import { useTheme } from '../theme/ThemeProvider';
import type { TypeRoleName } from '../tokens/typography';

/* ----------------------------------------------------------------- text --- */

export type TextTone =
  | 'primary'
  | 'secondary'
  | 'muted'
  | 'accent'
  | 'onAccent'
  /** Text drawn on `overlay` / `sceneScrim` (scene captions). */
  | 'onScrim'
  | 'amber'
  | 'cyan'
  | 'success'
  | 'warning'
  | 'error'
  | 'info';

export interface ThemedTextProps extends TextProps {
  variant?: TypeRoleName;
  tone?: TextTone;
  /** Script of the content (target-language text) for font stack + line height. */
  script?: ScriptId;
  /** Force text direction (e.g. Arabic phrase inside an LTR UI). */
  direction?: 'ltr' | 'rtl';
  align?: 'start' | 'center' | 'end';
  children?: React.ReactNode;
}

export function toneColor(theme: Theme, tone: TextTone): string {
  const c = theme.colors;
  switch (tone) {
    case 'secondary':
      return c.textSecondary;
    case 'muted':
      return c.textMuted;
    case 'accent':
      // Accent as TEXT follows the course (AA-tuned); the fill token is never used for text.
      return theme.accents.tinted ? theme.accents.primaryText : c.accentText;
    case 'onAccent':
      return theme.accents.onPrimary;
    case 'onScrim':
      return c.onScrim;
    case 'amber':
      return c.amberText;
    case 'cyan':
      return c.cyanText;
    case 'success':
      return c.success;
    case 'warning':
      return c.warning;
    case 'error':
      return c.error;
    case 'info':
      return c.info;
    default:
      return c.textPrimary;
  }
}

function resolveAlign(
  theme: Theme,
  align: ThemedTextProps['align'],
  direction?: 'ltr' | 'rtl',
): TextStyle['textAlign'] {
  if (align === 'center') return 'center';
  const rtl = direction ? direction === 'rtl' : theme.direction.rtl;
  if (align === 'end') return rtl ? 'left' : 'right';
  if (align === 'start') return rtl ? 'right' : 'left';
  return direction ? (rtl ? 'right' : 'left') : theme.direction.textAlign;
}

/** Theme-aware `Text` with a type role, tone and optional script metadata. */
export function ThemedText(props: ThemedTextProps): React.JSX.Element {
  const {
    variant = 'body',
    tone = 'primary',
    script,
    direction,
    align,
    style,
    children,
    ...rest
  } = props;
  const theme = useTheme();
  const t = theme.text(variant, script);
  const textStyle: TextStyle = {
    fontSize: t.fontSize,
    lineHeight: t.lineHeight,
    fontWeight: t.fontWeight,
    letterSpacing: t.letterSpacing,
    color: toneColor(theme, tone),
    textAlign: resolveAlign(theme, align, direction),
    writingDirection: direction ?? (script ? t.writingDirection : theme.direction.writingDirection),
  };
  if (t.fontFamily) textStyle.fontFamily = t.fontFamily;
  if (t.textTransform) textStyle.textTransform = t.textTransform;
  return (
    <Text
      allowFontScaling={false /* we apply the learner's text scale ourselves */}
      {...rest}
      style={[textStyle, style]}
    >
      {children}
    </Text>
  );
}

/* -------------------------------------------------------------- layout --- */

export interface RowProps extends ViewProps {
  gap?: number;
  align?: ViewStyle['alignItems'];
  justify?: ViewStyle['justifyContent'];
  wrap?: boolean;
  children?: React.ReactNode;
}

/** Horizontal flex row that mirrors under RTL when the native engine does not. */
export function Row(props: RowProps): React.JSX.Element {
  const {
    gap = 0,
    align = 'center',
    justify = 'flex-start',
    wrap = false,
    style,
    children,
    ...rest
  } = props;
  const theme = useTheme();
  return (
    <View
      {...rest}
      style={[
        {
          flexDirection: theme.direction.row,
          alignItems: align,
          justifyContent: justify,
          gap,
          flexWrap: wrap ? 'wrap' : 'nowrap',
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export interface SurfaceProps extends ViewProps {
  level?: 0 | 1 | 2 | 3 | 4;
  /**
   * `glass` / `glassStrong` are the Night Market translucent cards (solid on
   * the `glassFallback` tier); the other variants are opaque.
   */
  variant?:
    'surface' | 'elevated' | 'muted' | 'accentSoft' | 'transparent' | 'glass' | 'glassStrong';
  radius?: keyof Theme['radii'];
  padding?: number;
  bordered?: boolean;
  /** Glow ring + bloom (elevation 3). Reserved for the speech state and the primary action. */
  glow?: boolean | string;
  children?: React.ReactNode;
}

/** Themed container with elevation, radius and optional border (high contrast always borders). */
export function Surface(props: SurfaceProps): React.JSX.Element {
  const {
    level = 0,
    variant = 'surface',
    radius = 'md',
    padding,
    bordered,
    glow,
    style,
    children,
    ...rest
  } = props;
  const theme = useTheme();
  const glass =
    variant === 'glass' ? theme.glass(1) : variant === 'glassStrong' ? theme.glass(2) : null;
  const bg = glass
    ? glass.backgroundColor
    : variant === 'transparent'
      ? 'transparent'
      : variant === 'muted'
        ? theme.colors.surfaceMuted
        : variant === 'accentSoft'
          ? theme.accents.tinted
            ? theme.accents.primarySoft
            : theme.colors.accentSoft
          : variant === 'elevated'
            ? theme.colors.elevated
            : theme.colors.surface;
  const showBorder = bordered ?? (glass ? true : theme.highContrast && variant !== 'transparent');
  const glowStyleObj = glow
    ? theme.glow(typeof glow === 'string' ? glow : theme.accents.ring)
    : null;
  return (
    <View
      {...rest}
      style={[
        theme.elevation(level),
        {
          backgroundColor: bg,
          borderRadius: theme.radii[radius],
          padding,
          borderWidth: showBorder ? 1 : 0,
          borderColor: glass ? glass.borderColor : theme.colors.border,
        },
        glowStyleObj
          ? {
              borderWidth: glowStyleObj.ringWidth,
              borderColor: glowStyleObj.ringColor,
              shadowColor: glowStyleObj.shadowColor,
              shadowOffset: glowStyleObj.shadowOffset,
              shadowOpacity: glowStyleObj.shadowOpacity,
              shadowRadius: glowStyleObj.shadowRadius,
              elevation: glowStyleObj.elevation,
            }
          : null,
        style,
      ]}
    >
      {children}
    </View>
  );
}

/* ------------------------------------------------------------- buttons --- */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface ButtonProps extends Omit<PressableProps, 'style' | 'children'> {
  label: string;
  variant?: ButtonVariant;
  icon?: IconName;
  iconPosition?: 'start' | 'end';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  fullWidth?: boolean;
  /** Glow (elevation 3): only for THE primary action of a screen. */
  glow?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}

function buttonColors(
  theme: Theme,
  variant: ButtonVariant,
  pressed: boolean,
): { bg: string; fg: string; border: string } {
  const c = theme.colors;
  const a = theme.accents;
  const accentText = a.tinted ? a.primaryText : c.accentText;
  switch (variant) {
    case 'primary':
      return {
        bg: pressed ? a.primaryStrong : a.primary,
        fg: a.onPrimary,
        border: pressed ? a.primaryStrong : a.primary,
      };
    case 'danger':
      return { bg: pressed ? c.errorSoft : c.surface, fg: c.error, border: c.error };
    case 'ghost':
      return {
        bg: pressed ? c.surfaceMuted : 'transparent',
        fg: accentText,
        border: 'transparent',
      };
    default:
      return {
        bg: pressed ? theme.glass(2).backgroundColor : theme.glass(1).backgroundColor,
        fg: accentText,
        border: theme.highContrast ? c.border : theme.glass(1).borderColor,
      };
  }
}

/** Text button with optional leading/trailing icon. Minimum 44 dp hit area. */
export function Button(props: ButtonProps): React.JSX.Element {
  const {
    label,
    variant = 'primary',
    icon,
    iconPosition = 'start',
    size = 'md',
    loading = false,
    fullWidth = false,
    glow = false,
    disabled,
    style,
    accessibilityLabel,
    ...rest
  } = props;
  const theme = useTheme();
  const glowStyleObj = glow && variant === 'primary' ? theme.glow() : null;
  const height =
    size === 'lg' ? theme.touchTargets.comfortable : size === 'sm' ? theme.touchTargets.min : 48;
  const Icon = icon ? ICONS[icon] : null;
  const iconSize = size === 'lg' ? theme.iconSizes.md : theme.iconSizes.sm;
  const isDisabled = Boolean(disabled) || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      hitSlop={4}
      {...rest}
      style={({ pressed }) => {
        const col = buttonColors(theme, variant, pressed);
        return [
          {
            minHeight: height,
            paddingHorizontal: size === 'sm' ? theme.spacing.md : theme.spacing.xl,
            borderRadius: theme.radii.pill,
            backgroundColor: col.bg,
            borderWidth: 1.5,
            borderColor: col.border,
            opacity: isDisabled ? 0.5 : 1,
            alignSelf: fullWidth ? 'stretch' : 'flex-start',
            justifyContent: 'center',
            transform: [{ scale: pressed && !isDisabled ? 0.96 : 1 }],
          },
          glowStyleObj && !isDisabled
            ? {
                shadowColor: glowStyleObj.shadowColor,
                shadowOffset: glowStyleObj.shadowOffset,
                shadowOpacity: glowStyleObj.shadowOpacity,
                shadowRadius: glowStyleObj.shadowRadius,
                elevation: glowStyleObj.elevation,
              }
            : null,
          style,
        ];
      }}
    >
      {({ pressed }) => {
        const col = buttonColors(theme, variant, pressed);
        const iconEl = Icon ? <Icon size={iconSize} color={col.fg} /> : null;
        return (
          <Row gap={theme.spacing.sm} justify="center">
            {iconPosition === 'start' ? iconEl : null}
            <ThemedText
              variant={size === 'lg' ? 'subheading' : 'label'}
              style={{ color: col.fg }}
              align="center"
            >
              {loading ? '…' : label}
            </ThemedText>
            {iconPosition === 'end' ? iconEl : null}
          </Row>
        );
      }}
    </Pressable>
  );
}

export interface IconButtonProps extends Omit<PressableProps, 'style' | 'children'> {
  icon: IconName;
  /** Required: icons alone are not accessible names. */
  accessibilityLabel: string;
  size?: number;
  tone?: TextTone;
  /** Draws a filled circle behind the icon. */
  filled?: boolean;
  selected?: boolean;
  /** Mirror horizontally under RTL (chevrons, skip icons). */
  mirrorRtl?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityRole?: AccessibilityRole;
}

/** Icon-only button with a 44 dp minimum target and mandatory label. */
export function IconButton(props: IconButtonProps): React.JSX.Element {
  const {
    icon,
    accessibilityLabel,
    size,
    tone = 'primary',
    filled = false,
    selected = false,
    mirrorRtl = false,
    disabled,
    style,
    accessibilityRole = 'button',
    ...rest
  } = props;
  const theme = useTheme();
  const Icon = ICONS[icon];
  const iconSize = size ?? theme.iconSizes.md;
  const target = Math.max(theme.touchTargets.min, iconSize + theme.spacing.lg);
  const state: AccessibilityState = { disabled: Boolean(disabled), selected };
  const color = selected ? theme.accents.onPrimary : toneColor(theme, tone);
  return (
    <Pressable
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={state}
      disabled={disabled}
      hitSlop={4}
      {...rest}
      style={({ pressed }) => [
        {
          width: target,
          height: target,
          borderRadius: target / 2,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: selected
            ? theme.accents.primary
            : filled
              ? pressed
                ? theme.colors.surfaceMuted
                : theme.colors.surface
              : pressed
                ? theme.colors.surfaceMuted
                : 'transparent',
          borderWidth: filled || theme.highContrast ? 1 : 0,
          borderColor: theme.colors.border,
          opacity: disabled ? 0.45 : 1,
          transform: mirrorRtl ? [{ scaleX: theme.direction.iconScaleX }] : undefined,
        },
        style,
      ]}
    >
      <Icon size={iconSize} color={color} />
    </Pressable>
  );
}

/* --------------------------------------------------------------- chips --- */

export interface ChipProps {
  label: string;
  tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'error' | 'info';
  icon?: IconName;
  selected?: boolean;
  onPress?: () => void;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

/** Small label pill; always carries text, never colour alone. */
export function Chip(props: ChipProps): React.JSX.Element {
  const {
    label,
    tone = 'neutral',
    icon,
    selected = false,
    onPress,
    accessibilityLabel,
    style,
  } = props;
  const theme = useTheme();
  const c = theme.colors;
  const a = theme.accents;
  const palette = {
    neutral: { bg: c.surfaceMuted, fg: c.textSecondary },
    accent: {
      bg: a.tinted ? a.primarySoft : c.accentSoft,
      fg: a.tinted ? a.primaryText : c.accentText,
    },
    success: { bg: c.successSoft, fg: c.success },
    warning: { bg: c.warningSoft, fg: c.warning },
    error: { bg: c.errorSoft, fg: c.error },
    info: { bg: c.infoSoft, fg: c.info },
  }[tone];
  const bg = selected ? a.primary : palette.bg;
  const fg = selected ? a.onPrimary : palette.fg;
  const Icon = icon ? ICONS[icon] : null;
  const content = (
    <Row
      gap={theme.spacing.xs}
      style={{ paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.xs }}
    >
      {Icon ? <Icon size={theme.iconSizes.xs} color={fg} /> : null}
      <ThemedText variant="caption" style={{ color: fg, fontWeight: '600' }}>
        {label}
      </ThemedText>
    </Row>
  );
  const baseStyle: ViewStyle = {
    backgroundColor: bg,
    borderRadius: theme.radii.pill,
    borderWidth: theme.highContrast ? 1 : 0,
    borderColor: fg,
    alignSelf: 'flex-start',
    minHeight: onPress ? theme.touchTargets.min - 12 : undefined,
    justifyContent: 'center',
  };
  if (onPress) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? label}
        accessibilityState={{ selected }}
        onPress={onPress}
        hitSlop={6}
        style={[baseStyle, style]}
      >
        {content}
      </Pressable>
    );
  }
  return (
    <View accessible accessibilityLabel={accessibilityLabel ?? label} style={[baseStyle, style]}>
      {content}
    </View>
  );
}

/* ------------------------------------------------------------ progress --- */

export interface ProgressBarProps {
  /** 0..1 */
  value: number;
  accessibilityLabel: string;
  tone?: 'accent' | 'success' | 'info';
  height?: number;
  style?: StyleProp<ViewStyle>;
}

/** Determinate progress bar exposing `accessibilityValue`. */
export function ProgressBar(props: ProgressBarProps): React.JSX.Element {
  const { value, accessibilityLabel, tone = 'accent', height = 8, style } = props;
  const theme = useTheme();
  const pct = Math.round(Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0)) * 100);
  const fill =
    tone === 'success'
      ? theme.colors.success
      : tone === 'info'
        ? theme.colors.info
        : theme.accents.primary;
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: 100, now: pct, text: `${pct}%` }}
      style={[
        {
          height,
          borderRadius: height / 2,
          backgroundColor: theme.colors.surfaceMuted,
          overflow: 'hidden',
          borderWidth: theme.highContrast ? 1 : 0,
          borderColor: theme.colors.border,
        },
        style,
      ]}
    >
      <View
        style={{
          width: `${pct}%`,
          height: '100%',
          backgroundColor: fill,
          alignSelf: theme.direction.mirrorRows && theme.direction.rtl ? 'flex-end' : 'flex-start',
        }}
      />
    </View>
  );
}

/* --------------------------------------------------------------- misc --- */

/** Thin separator. */
export function Divider(props: { style?: StyleProp<ViewStyle> }): React.JSX.Element {
  const theme = useTheme();
  return (
    <View
      style={[
        { height: 1, backgroundColor: theme.colors.border, alignSelf: 'stretch' },
        props.style,
      ]}
    />
  );
}

/** Inline icon with a tone colour (non-interactive). */
export function InlineIcon(props: {
  name: IconName;
  size?: number;
  tone?: TextTone;
  color?: string;
}): React.JSX.Element {
  const theme = useTheme();
  const Icon = ICONS[props.name];
  return (
    <Icon
      size={props.size ?? theme.iconSizes.sm}
      color={props.color ?? toneColor(theme, props.tone ?? 'primary')}
    />
  );
}

/** Status line = icon + text, so meaning never depends on colour alone. */
export function StatusLine(props: {
  icon: IconName;
  tone: TextTone;
  text: string;
  variant?: TypeRoleName;
}): React.JSX.Element {
  const theme = useTheme();
  return (
    <Row gap={theme.spacing.sm} align="flex-start" accessible accessibilityLabel={props.text}>
      <InlineIcon name={props.icon} tone={props.tone} />
      <ThemedText variant={props.variant ?? 'label'} tone={props.tone} style={{ flexShrink: 1 }}>
        {props.text}
      </ThemedText>
    </Row>
  );
}
