/**
 * Heading levels for web. react-native-web renders `accessibilityRole="header"` as `<h1>` unless an
 * `aria-level` is given, so every section heading of a screen would be an `<h1>` next to the screen
 * title. React Native's `TextProps` does not type `aria-level`; native platforms ignore it.
 */
export const headingLevel = (level: 2 | 3 | 4): Record<string, number> => ({ 'aria-level': level });
