'use client';
import { useState } from 'react';
import { SPEAKER_CONSENT_STATE_VALUES, type SpeakerCreateRequest, type SpeakerPatchRequest } from '@langquest/contracts';
import { browserApi } from '@/src/lib/api-browser';
import { useI18n } from '@/src/lib/i18n/client';
import { useAction } from '@/src/lib/use-action';
import type { RightsOption } from '@/src/lib/queries/library';
import { newIdempotencyKey, shortId } from '@/src/lib/format';
import { Button, Checkbox, Field, Input, Select, Textarea } from '@/src/components/ui';
import { Dialog } from '@/src/components/dialog';
import { VarietySelect } from '@/src/components/forms';
import { Badge } from '@/src/components/badges';
import { DataTable, type Column } from '@/src/components/data-table';
import { CastPortrait, Melo } from '@/src/components/brand';
import { charactersForVariety } from '@art/characters';
import { findVariety } from '@langquest/contracts';

export interface SpeakerRow {
  id: string;
  display_name: string;
  pseudonymous: boolean;
  target_variety_id: string | null;
  region: string | null;
  consent_state: string;
  content_rights_id: string | null;
  voice_description: string | null;
  synthetic: boolean;
  lessons: { id: string }[];
}

const CONSENT_TONE: Record<string, 'neutral' | 'info' | 'success' | 'warning' | 'error'> = { unknown: 'neutral', pending: 'info', granted: 'success', revoked: 'error' };

/** Form state = the contract create body minus its idempotency key (the client mints one per save). */
type SpeakerUpsert = Omit<SpeakerCreateRequest, 'idempotencyKey'> & { id?: string };

const emptyForm: SpeakerUpsert = { displayName: '', pseudonymous: true, targetVarietyId: null, region: null, consentState: 'unknown', contentRightsId: null, voiceDescription: null, synthetic: false };

export function SpeakersScreen({ speakers, rights }: { speakers: SpeakerRow[]; rights: RightsOption[] }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<SpeakerUpsert>(emptyForm);
  const save = useAction(
    async () => {
      const { id, ...fields } = form;
      if (id) {
        const body: SpeakerPatchRequest = fields;
        return browserApi().call('adminSpeakerPatch', { params: { id }, body });
      }
      const body: SpeakerCreateRequest = { ...fields, idempotencyKey: newIdempotencyKey('spk') };
      return browserApi().call('adminSpeakerCreate', { body, idempotencyKey: body.idempotencyKey });
    },
    { successMessage: t('admin.ui.saved') },
  );
  // Deleting a speaker still linked to lessons is refused by the API (`conflict`) unless reassigned; the button stays disabled.
  const remove = useAction(async (id: string) => browserApi().call('adminSpeakerDelete', { params: { id }, body: {} }), { successMessage: t('admin.ui.saved') });
  const edit = (s: SpeakerRow) => {
    setForm({ id: s.id, displayName: s.display_name, pseudonymous: s.pseudonymous, targetVarietyId: s.target_variety_id as SpeakerUpsert['targetVarietyId'], region: s.region, consentState: s.consent_state as SpeakerUpsert['consentState'], contentRightsId: s.content_rights_id, voiceDescription: s.voice_description, synthetic: s.synthetic });
    setOpen(true);
  };
  const columns: Column<SpeakerRow>[] = [
    { key: 'name', header: t('admin.ui.spName'), render: (s) => <button type="button" className="font-medium text-accent-text hover:underline" onClick={() => edit(s)}>{s.display_name}</button> },
    {
      key: 'variety',
      header: t('admin.speakersSection.variety'),
      render: (s) => {
        // C2 portraits of the characters cast for the speaker's variety (never a stand-in for the human speaker).
        const variety = s.target_variety_id ? findVariety(s.target_variety_id) : null;
        const cast = variety ? charactersForVariety(variety.id) : [];
        return (
          <span className="flex items-center gap-2">
            <span>{s.target_variety_id ?? '—'}</span>
            {cast.length > 0 ? (
              <span className="flex -space-x-1.5" title={t('admin.ui.castOfVariety')}>
                {cast.slice(0, 4).map((c) => (
                  <CastPortrait key={c.id} characterId={c.id} size={24} className="ring-1 ring-surface" />
                ))}
              </span>
            ) : null}
          </span>
        );
      },
    },
    { key: 'region', header: t('admin.speakersSection.region'), render: (s) => s.region ?? '—' },
    { key: 'consent', header: t('admin.speakersSection.consent'), render: (s) => <Badge tone={CONSENT_TONE[s.consent_state] ?? 'neutral'}>{t(`admin.speakersSection.consentState.${s.consent_state}`)}</Badge> },
    { key: 'flags', header: t('admin.ui.type'), render: (s) => <span className="flex gap-1">{s.pseudonymous ? <Badge>{t('admin.ui.spPseudonymous')}</Badge> : null}{s.synthetic ? <Badge tone="info">{t('admin.ui.spSynthetic')}</Badge> : null}</span> },
    { key: 'rights', header: t('admin.ui.colRightsLink'), render: (s) => (s.content_rights_id ? shortId(s.content_rights_id) : '—') },
    { key: 'lessons', header: t('admin.sections.lessons'), className: 'tabular-nums', render: (s) => s.lessons.length },
    {
      key: 'actions',
      header: t('admin.ui.actions'),
      render: (s) => (
        <div className="flex gap-1">
          <Button size="sm" onClick={() => edit(s)}>
            {t('admin.ui.edit')}
          </Button>
          <Button size="sm" variant="danger" disabled={s.lessons.length > 0} loading={remove.busy} onClick={() => window.confirm(t('admin.ui.confirmTitle')) && void remove.run(s.id)}>
            {t('admin.ui.delete')}
          </Button>
        </div>
      ),
    },
  ];
  const addSpeaker = (
    <Button
      variant="primary"
      onClick={() => {
        setForm(emptyForm);
        setOpen(true);
      }}
    >
      {t('admin.speakersSection.add')}
    </Button>
  );
  return (
    <div>
      {speakers.length > 0 ? <div className="mb-3 flex justify-end">{addSpeaker}</div> : null}
      <DataTable columns={columns} rows={speakers} rowKey={(s) => s.id} caption={t('admin.speakersSection.title')} empty={t('admin.ui.spEmptyHint')} emptyAction={addSpeaker} emptyArt={<Melo state="curious" size={72} />} />
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={form.id ? t('admin.ui.edit') : t('admin.ui.spNew')}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>{t('admin.ui.cancel')}</Button>
            <Button variant="primary" disabled={!form.displayName.trim()} loading={save.busy} onClick={() => void save.run().then((r) => r && setOpen(false))}>
              {t('admin.ui.save')}
            </Button>
          </>
        }
      >
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label={t('admin.ui.spName')} required className="sm:col-span-2">
            {(id) => <Input id={id} value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />}
          </Field>
          <Field label={t('admin.speakersSection.variety')}>{(id) => <VarietySelect id={id} value={form.targetVarietyId} onChange={(v) => setForm({ ...form, targetVarietyId: v as SpeakerUpsert['targetVarietyId'] })} />}</Field>
          <Field label={t('admin.speakersSection.region')}>{(id) => <Input id={id} value={form.region ?? ''} onChange={(e) => setForm({ ...form, region: e.target.value || null })} />}</Field>
          <Field label={t('admin.speakersSection.consent')} hint={t('admin.upload.speakerConsent')}>
            {(id) => (
              <Select id={id} value={form.consentState} onChange={(e) => setForm({ ...form, consentState: e.target.value as SpeakerUpsert['consentState'] })}>
                {SPEAKER_CONSENT_STATE_VALUES.map((v) => (
                  <option key={v} value={v}>
                    {t(`admin.speakersSection.consentState.${v}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t('admin.ui.colRightsLink')}>
            {(id) => (
              <Select id={id} value={form.contentRightsId ?? ''} onChange={(e) => setForm({ ...form, contentRightsId: e.target.value || null })}>
                <option value="">{t('admin.ui.none')}</option>
                {rights.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.license_id} {r.verified ? '✓' : ''} · {shortId(r.id)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t('admin.ui.spVoice')} className="sm:col-span-2">
            {(id) => <Textarea id={id} value={form.voiceDescription ?? ''} onChange={(e) => setForm({ ...form, voiceDescription: e.target.value || null })} />}
          </Field>
          <Checkbox label={t('admin.ui.spPseudonymous')} checked={form.pseudonymous} onChange={(e) => setForm({ ...form, pseudonymous: e.target.checked })} />
          <Checkbox label={t('admin.ui.spSynthetic')} checked={form.synthetic} onChange={(e) => setForm({ ...form, synthetic: e.target.checked })} />
        </div>
      </Dialog>
    </div>
  );
}
