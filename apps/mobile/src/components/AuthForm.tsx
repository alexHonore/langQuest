/** Shared pieces for the auth screens: labelled inputs and the configuration notice. */
import { Button, Row, StatusLine, ThemedText, useTheme } from '@langquest/ui';
import React from 'react';
import { ScrollView, TextInput, View, type TextInputProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ENV, isBackendConfigured } from '@/config/env';
import { useT } from '@/lib/i18n';
import { useAuth } from '@/state/auth';

export function Field(props: { label: string; value: string; onChangeText: (v: string) => void; secure?: boolean; keyboardType?: TextInputProps['keyboardType']; autoComplete?: TextInputProps['autoComplete']; textContentType?: TextInputProps['textContentType'] }): React.JSX.Element {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.spacing.xs }}>
      <ThemedText variant="label">{props.label}</ThemedText>
      <TextInput
        value={props.value}
        onChangeText={props.onChangeText}
        secureTextEntry={props.secure}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType={props.keyboardType}
        autoComplete={props.autoComplete}
        textContentType={props.textContentType}
        accessibilityLabel={props.label}
        style={{ borderWidth: 1, borderColor: theme.colors.borderStrong, borderRadius: theme.radii.md, padding: theme.spacing.md, color: theme.colors.textPrimary, fontSize: theme.text('body').fontSize, minHeight: theme.touchTargets.comfortable }}
        placeholderTextColor={theme.colors.textMuted}
      />
    </View>
  );
}

export function AuthFrame(props: { title: string; children: React.ReactNode }): React.JSX.Element {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const t = useT();
  const error = useAuth((s) => s.error);
  return (
    <ScrollView style={{ flex: 1, backgroundColor: theme.colors.background }} contentContainerStyle={{ padding: theme.spacing.xl, paddingTop: insets.top + theme.spacing.xl, paddingBottom: insets.bottom + theme.spacing.xl, gap: theme.spacing.lg }} keyboardShouldPersistTaps="handled">
      <ThemedText variant="title" accessibilityRole="header">
        {props.title}
      </ThemedText>
      {!isBackendConfigured() ? <StatusLine icon="warning" tone="warning" text={`Sign-in is not configured in this build (missing ${[!ENV.supabaseUrl && 'EXPO_PUBLIC_SUPABASE_URL', !ENV.supabaseAnonKey && 'EXPO_PUBLIC_SUPABASE_ANON_KEY', !ENV.apiBaseUrl && 'EXPO_PUBLIC_API_BASE_URL'].filter(Boolean).join(', ')}).`} /> : null}
      {error ? <StatusLine icon="warning" tone="error" text={error} /> : null}
      {props.children}
      <ThemedText variant="caption" tone="muted" align="center">
        {t('common.free')}
      </ThemedText>
    </ScrollView>
  );
}

export function OAuthButtons(): React.JSX.Element | null {
  const signInWithOAuth = useAuth((s) => s.signInWithOAuth);
  const theme = useTheme();
  if (ENV.oauthProviders.length === 0) return null;
  return (
    <Row gap={theme.spacing.sm} wrap>
      {ENV.oauthProviders.map((p) => (
        <Button key={p} label={p.charAt(0).toUpperCase() + p.slice(1)} variant="secondary" onPress={() => void signInWithOAuth(p)} accessibilityLabel={p} />
      ))}
    </Row>
  );
}
