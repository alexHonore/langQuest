import { ICONS, useTheme } from '@langquest/ui';
import { Redirect, Tabs } from 'expo-router';
import React from 'react';
import { View, type ColorValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AudioRuntimeBridge } from '@/features/audio/components/AudioRuntimeBridge';
import { MINI_PLAYER_HEIGHT, MiniPlayer } from '@/features/audio/components/MiniPlayer';
import { useEngineState } from '@/features/audio/use-audio';
import { useT } from '@/lib/i18n';
import { useAuth } from '@/state/auth';

const TAB_BAR_HEIGHT = 56;

/** Five learner tabs (§1.3): Home, Missions, Audio, Speak, Progress — plus the global audio mini player above the bar. */
export default function TabsLayout(): React.JSX.Element {
  const theme = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const status = useAuth((s) => s.status);
  const engine = useEngineState();
  const miniVisible = engine.index >= 0;
  if (status === 'signed_out' || status === 'not_configured') return <Redirect href="/auth/sign-in" />;
  const icon = (name: keyof typeof ICONS) => {
    const Icon = ICONS[name];
    function TabIcon({ color, size }: { color: ColorValue; size: number }): React.JSX.Element {
      return <Icon color={String(color)} size={size} />;
    }
    return TabIcon;
  };
  const tabBarHeight = TAB_BAR_HEIGHT + insets.bottom;
  return (
    <View style={{ flex: 1 }}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: theme.colors.accent,
          tabBarInactiveTintColor: theme.colors.textMuted,
          tabBarStyle: { backgroundColor: theme.colors.surface, borderTopColor: theme.colors.border, height: tabBarHeight, paddingBottom: insets.bottom, paddingTop: 6 },
          tabBarLabelStyle: { fontSize: Math.round(12 * Math.min(theme.textScale, 1.3)) },
          sceneStyle: { backgroundColor: theme.colors.background, paddingBottom: miniVisible ? MINI_PLAYER_HEIGHT + 8 : 0 },
        }}
      >
        <Tabs.Screen name="index" options={{ title: t('common.tabs.home'), tabBarIcon: icon('home'), tabBarButtonTestID: 'tab-home' }} />
        <Tabs.Screen name="missions" options={{ title: t('common.tabs.missions'), tabBarIcon: icon('missions'), tabBarButtonTestID: 'tab-missions' }} />
        <Tabs.Screen name="audio" options={{ title: t('common.tabs.audio'), tabBarIcon: icon('audio'), tabBarButtonTestID: 'tab-audio' }} />
        <Tabs.Screen name="speak" options={{ title: t('common.tabs.speak'), tabBarIcon: icon('speak'), tabBarButtonTestID: 'tab-speak' }} />
        <Tabs.Screen name="progress" options={{ title: t('common.tabs.progress'), tabBarIcon: icon('progress'), tabBarButtonTestID: 'tab-progress' }} />
      </Tabs>
      <MiniPlayer bottomOffset={tabBarHeight + 6} />
      <AudioRuntimeBridge />
    </View>
  );
}
