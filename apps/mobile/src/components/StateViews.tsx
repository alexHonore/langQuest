/** Honest loading / error / offline states shared by screens. */
import { Button, CardSkeleton, EmptyState, Row, StatusLine, ThemedText, useTheme } from '@langquest/ui';
import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { ApiClientError } from '@/lib/api/client';
import { extraLabels } from '@/lib/extra-labels';
import { useI18n, useT } from '@/lib/i18n';

export function LoadingView(props: { rows?: number; label?: string }): React.JSX.Element {
  const t = useT();
  const theme = useTheme();
  return (
    <View accessibilityLabel={props.label ?? t('common.a11y.loadingIndicator')} accessible style={{ gap: theme.spacing.md }}>
      <ActivityIndicator color={theme.colors.accent} />
      {Array.from({ length: props.rows ?? 2 }).map((_, i) => (
        <CardSkeleton key={i} />
      ))}
    </View>
  );
}

export function errorMessageFor(error: unknown, t: ReturnType<typeof useT>, locale = 'en'): string {
  if (error instanceof ApiClientError) {
    switch (error.kind) {
      case 'network':
      case 'timeout':
        return t('errors.network');
      case 'not_configured':
        return extraLabels(locale).apiNotConfigured;
      case 'unauthorized':
        return t('errors.unauthorized');
      case 'forbidden':
        return t('errors.forbidden');
      case 'not_found':
        return t('errors.notFound');
      case 'validation_failed':
      case 'invalid_response':
        return t('errors.validation');
      case 'rate_limited':
        return t('errors.rateLimited');
      case 'conflict':
        return t('errors.conflict');
      case 'provider_unavailable':
        return t('errors.providerUnavailable');
      case 'capability_unsupported':
        return t('errors.capabilityUnsupported', { variety: '' }).trim();
      case 'rights_blocked':
        return t('errors.rightsBlocked');
      default:
        return t('errors.generic');
    }
  }
  if (error instanceof Error && error.message) return error.message;
  return t('errors.generic');
}

export function ErrorView(props: { error: unknown; onRetry?: () => void; title?: string }): React.JSX.Element {
  const { t, locale } = useI18n();
  const theme = useTheme();
  const message = errorMessageFor(props.error, t, locale);
  return (
    <View style={{ gap: theme.spacing.md }}>
      <StatusLine icon="warning" tone="error" text={props.title ?? message} />
      {props.title ? <ThemedText tone="secondary">{message}</ThemedText> : null}
      {props.onRetry ? (
        <Row>
          <Button label={t('common.retry')} variant="secondary" onPress={props.onRetry} accessibilityLabel={t('common.retry')} />
        </Row>
      ) : null}
    </View>
  );
}

export function CacheNotice(props: { fetchedAt: string | null }): React.JSX.Element {
  const t = useT();
  return <StatusLine icon="offline" tone="warning" text={`${t('errors.offlineLessonsAvailable')}${props.fetchedAt ? ` (${new Date(props.fetchedAt).toLocaleString()})` : ''}`} />;
}

export { EmptyState };
