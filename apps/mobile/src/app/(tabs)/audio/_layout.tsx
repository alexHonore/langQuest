import { useTheme } from '@langquest/ui';
import { Stack } from 'expo-router';
import React from 'react';

/** Audio tab: library → collection → lesson player, plus the downloads/storage screen. */
export default function AudioLayout(): React.JSX.Element {
  const theme = useTheme();
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.colors.background }, animation: theme.reducedMotion ? 'none' : 'default' }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="collection/[id]" />
      <Stack.Screen name="lesson/[id]" />
      <Stack.Screen name="downloads" />
    </Stack>
  );
}
