import { useTheme } from '@langquest/ui';
import { Stack } from 'expo-router';
import React from 'react';

export default function OnboardingLayout(): React.JSX.Element {
  const theme = useTheme();
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.colors.background }, animation: theme.reducedMotion ? 'none' : 'slide_from_right' }} />;
}
