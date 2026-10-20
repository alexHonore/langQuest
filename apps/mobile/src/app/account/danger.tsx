import type { MeDeleteResponse } from '@langquest/contracts';
import { Button, InfoAffordance, StatusLine, Surface, ThemedText, useTheme } from '@langquest/ui';
import { File, Paths } from 'expo-file-system';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Platform, Share, TextInput } from 'react-native';
import { Screen } from '@/components/Screen';
import { ErrorView } from '@/components/StateViews';
import { useExtraLabels } from '@/lib/extra-labels';
import { newUuid } from '@/lib/ids';
import { useT } from '@/lib/i18n';
import { useServices } from '@/lib/services';
import { useAuth } from '@/state/auth';
import { usePrefs } from '@/state/prefs';

/**
 * Export + delete account (§11, A28) through the real learner routes:
 * `GET /v1/me/export` (saved as a JSON file the learner can share) and
 * `DELETE /v1/me` (server-side deletion, confirmed with the literal `DELETE`).
 * The local wipe and sign-out only happen AFTER the server confirmed, and the
 * server's own `status` / retained-tables answer is shown verbatim.
 */
export default function DangerZone(): React.JSX.Element {
  const theme = useTheme();
  const router = useRouter();
  const t = useT();
  const X = useExtraLabels();
  const { api, resetLocal, online } = useServices();
  const signOut = useAuth((s) => s.signOut);
  const resetPrefs = usePrefs((s) => s.resetForSignOut);
  const [confirm, setConfirm] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState<{ fileName: string; uri: string | null; notes: string[] } | null>(null);
  const [exportError, setExportError] = useState<unknown>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleted, setDeleted] = useState<MeDeleteResponse | null>(null);
  const [deleteError, setDeleteError] = useState<unknown>(null);
  const [deleteKey] = useState(() => newUuid());

  const exportData = async (): Promise<void> => {
    setExporting(true);
    setExportError(null);
    try {
      const bundle = await api.exportData();
      const json = JSON.stringify(bundle, null, 2);
      const fileName = `langquest-export-${bundle.exportedAt.slice(0, 10)}.json`;
      if (Platform.OS === 'web') {
        // No file system on web: hand the JSON to the share sheet / clipboard-capable share target.
        setExported({ fileName, uri: null, notes: bundle.notes });
        await Share.share({ message: json, title: fileName }).catch(() => undefined);
        return;
      }
      const file = new File(Paths.document, fileName);
      file.write(json);
      setExported({ fileName, uri: file.uri, notes: bundle.notes });
    } catch (error) {
      setExportError(error);
    } finally {
      setExporting(false);
    }
  };

  const shareExport = async (): Promise<void> => {
    if (!exported?.uri) return;
    await Share.share(Platform.OS === 'ios' ? { url: exported.uri, title: exported.fileName } : { message: exported.uri, title: exported.fileName }).catch(() => undefined);
  };

  const deleteAccount = async (): Promise<void> => {
    setDeleting(true);
    setDeleteError(null);
    try {
      // Server first: nothing local is wiped until the API confirmed the deletion.
      const res = await api.deleteAccount({ confirmation: 'DELETE', deleteOptInRecordings: true }, deleteKey);
      setDeleted(res);
      await resetLocal();
      resetPrefs();
      await signOut();
      router.replace('/auth/sign-in');
    } catch (error) {
      setDeleteError(error);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Screen title={t('account.deleteAccount.title')} onBack={() => router.back()} headerEnd={<InfoAffordance label={t('common.moreInformation')} title={t('account.deleteAccount.title')} text={[`${t('account.export.title')}: ${t('account.export.hint')}`, t('account.deleteAccount.hint')]} />}>
      {/* Calm density: the what-export / what-delete explanations sit behind the header ⓘ; only the confirm hint stays inline. */}
      <Surface radius="lg" padding={theme.spacing.lg} bordered style={{ gap: theme.spacing.sm }}>
        <ThemedText variant="heading">{t('account.export.title')}</ThemedText>
        {!online ? <StatusLine icon="offline" tone="warning" text={t('errors.network')} /> : null}
        <Button testID="account-export" label={X.exportButton} variant="secondary" icon="download" fullWidth loading={exporting} disabled={!online} onPress={() => void exportData()} accessibilityLabel={X.exportButton} />
        {exported ? (
          <>
            <StatusLine icon="check" tone="success" text={exported.uri ? X.exportSaved(exported.fileName) : t('account.export.ready')} />
            {exported.uri ? <Button testID="account-export-share" label={X.exportShare} variant="ghost" size="sm" onPress={() => void shareExport()} accessibilityLabel={X.exportShare} /> : null}
            {exported.notes.length > 0 ? <InfoAffordance label={t('common.details')} title={X.exportNotes} text={exported.notes} /> : null}
          </>
        ) : null}
        {exportError ? <ErrorView error={exportError} onRetry={() => void exportData()} /> : null}
      </Surface>
      <Surface radius="lg" padding={theme.spacing.lg} bordered style={{ gap: theme.spacing.sm }}>
        <ThemedText variant="heading">{t('account.deleteAccount.confirmTitle')}</ThemedText>
        <ThemedText variant="caption" tone="muted">{t('account.deleteAccount.confirmHint')}</ThemedText>
        <TextInput testID="account-delete-confirm" value={confirm} onChangeText={setConfirm} placeholder={t('account.deleteAccount.confirmPlaceholder')} placeholderTextColor={theme.colors.textMuted} autoCapitalize="characters" accessibilityLabel={t('account.deleteAccount.confirmPlaceholder')} style={{ borderWidth: 1, borderColor: theme.colors.error, borderRadius: theme.radii.md, padding: theme.spacing.md, color: theme.colors.textPrimary, minHeight: theme.touchTargets.min }} />
        {deleted ? (
          <>
            <StatusLine icon="check" tone="success" text={deleted.status === 'deleted' ? X.deleteDone : X.deleteScheduled} />
            {deleted.retainedForLegalReasons.length > 0 ? <ThemedText variant="caption" tone="muted">{X.retainedForLegalReasons(deleted.retainedForLegalReasons.join(', '))}</ThemedText> : null}
          </>
        ) : null}
        {deleteError ? (
          <>
            <StatusLine icon="warning" tone="warning" text={X.deleteFailed} />
            <ErrorView error={deleteError} />
          </>
        ) : null}
        <Button testID="account-delete" label={t('account.deleteAccount.button')} variant="danger" fullWidth loading={deleting} disabled={confirm.trim() !== 'DELETE' || !online || deleted !== null} onPress={() => void deleteAccount()} accessibilityLabel={t('account.deleteAccount.button')} />
      </Surface>
    </Screen>
  );
}
