/** Honest synthetic-speech disclosure for a character (§8.6): always text, never colour alone. */
import { Chip } from '@langquest/ui';
import React from 'react';
import { useT } from '@/lib/i18n';

export function SyntheticVoiceBadge(props: { name: string }): React.JSX.Element {
  const t = useT();
  return <Chip label={t('speak.syntheticVoice.badge')} icon="volume" tone="info" accessibilityLabel={t('speak.syntheticVoice.detail', { name: props.name })} />;
}
