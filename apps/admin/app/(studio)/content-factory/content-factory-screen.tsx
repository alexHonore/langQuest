'use client';
import { useMemo, useState } from 'react';
import { sceneArtSvgString, SCENE_IDS, type SceneId } from '@art/scenes';
import { COURSE_TRACKS, LEARNER_LEVEL_VALUES, type ContentGenerateRequest } from '@langquest/contracts';
import { browserApi } from '@/src/lib/api-browser';
import { localCall } from '@/src/lib/local-api/client';
import { useI18n } from '@/src/lib/i18n/client';
import { useAction } from '@/src/lib/use-action';
import { formatDateTime, newIdempotencyKey, pickLocalized, shortId } from '@/src/lib/format';
import { Button, Card, Field, Input, Notice, Select, TextField, Textarea } from '@/src/components/ui';
import { Badge, JobBadge, StatusBadge } from '@/src/components/badges';
import { SvgArt } from '@/src/components/asset-preview';
import { LanguageSelect, TrackSelect } from '@/src/components/forms';

export interface DraftMission {
  id: string;
  title_translations: unknown;
  mission_type: string;
  target_variety_id: string;
  level: string;
  state: string;
  sort_order: number;
  chapter_id: string | null;
  template_key: string | null;
  goals: unknown;
  narrative_segment: unknown;
  created_at: string;
  updated_at: string;
  localizations: Array<{ source_language_code: string; title: string; instructions: string; hints: string[]; qa_state: string }>;
}
export interface DraftExpression {
  id: string;
  intent_id: string;
  target_variety_id: string;
  canonical_text: string;
  register: string;
  difficulty: number;
  reviewed: boolean;
  origin: string;
  state: string;
  scenario_tags: string[];
  created_at: string;
  forms: Array<{ script: string | null; text: string; transliteration_scheme: string | null }>;
  translations: Array<{ source_language_code: string; natural_meaning: string; context_note: string | null; qa_state: string }>;
}
export interface GenerationJob {
  id: string;
  state: string;
  progress_pct: number;
  params: unknown;
  output: unknown;
  failure_message: string | null;
  created_at: string;
  finished_at: string | null;
}

export function ContentFactoryScreen({ intents, missions, expressions, jobs, canDecide }: { intents: Array<{ key: string; description: string; concept: string }>; missions: DraftMission[]; expressions: DraftExpression[]; jobs: GenerationJob[]; canDecide: boolean }) {
  const { t, locale } = useI18n();
  const [track, setTrack] = useState<string | null>(COURSE_TRACKS[0]?.id ?? null);
  // No preselected instruction language: the operator chooses it explicitly (never an implied English default).
  const [source, setSource] = useState<string | null>(null);
  const [level, setLevel] = useState<string>('beginner');
  const [scene, setScene] = useState<string>('cafe');
  const [count, setCount] = useState(1);
  const [intentQuery, setIntentQuery] = useState('');
  const [intentKeys, setIntentKeys] = useState<string[]>([]);
  const [selectedMission, setSelectedMission] = useState<string | null>(missions[0]?.id ?? null);
  const [qaComment, setQaComment] = useState('');
  const [lastJob, setLastJob] = useState<{ jobId: string; draftIds: string[]; replayed: boolean } | null>(null);

  const filteredIntents = useMemo(() => intents.filter((i) => !intentQuery || i.key.includes(intentQuery) || i.description.toLowerCase().includes(intentQuery.toLowerCase())).slice(0, 80), [intents, intentQuery]);
  const generate = useAction(
    async () => {
      const body: ContentGenerateRequest = {
        targetTrack: track as ContentGenerateRequest['targetTrack'],
        sourceLanguage: source as ContentGenerateRequest['sourceLanguage'],
        intentKeys,
        level: level as ContentGenerateRequest['level'],
        scene,
        count,
        idempotencyKey: newIdempotencyKey('gen'),
      };
      const res = await browserApi().call('adminContentGenerate', { body });
      setLastJob(res);
      return res;
    },
    { successMessage: (res) => (res.replayed ? t('admin.ui.cfReplayed') : t('admin.ui.cfJobQueued', { jobId: res.jobId.slice(0, 8) })) },
  );
  const decide = useAction(async (entityTable: 'missions' | 'expressions', id: string, decision: 'approve' | 'reject' | 'request_review') => localCall(`/api/admin/content/${id}/decision`, { method: 'POST', body: { entityTable, decision, note: qaComment || undefined } }), { successMessage: t('admin.ui.saved') });
  const requestReview = useAction(async (id: string) => browserApi().call('adminContentRequestReview', { params: { id }, body: { note: qaComment || undefined, targetVarietyId: undefined } }), { successMessage: t('admin.contentFactory.sendToReview') });

  const mission = missions.find((m) => m.id === selectedMission) ?? null;
  const missionExpressions = useMemo(() => (mission ? expressions.filter((e) => e.target_variety_id === mission.target_variety_id).slice(0, 40) : []), [expressions, mission]);
  const sceneId = (SCENE_IDS as readonly string[]).includes(scene) ? (scene as SceneId) : null;

  return (
    <div className="grid gap-4 xl:grid-cols-[22rem_1fr]">
      <div className="space-y-4">
        <Card title={t('admin.ui.cfBrief')}>
          <div className="space-y-2">
            <Field label={t('admin.contentFactory.track')}>{(id) => <TrackSelect id={id} value={track} onChange={setTrack} allowEmpty={false} />}</Field>
            <Field label={t('admin.contentFactory.sourceLanguage')} required>{(id) => <LanguageSelect id={id} value={source} onChange={setSource} emptyLabel={t('admin.ui.cfChooseSource')} />}</Field>
            <Field label={t('admin.contentFactory.level')}>
              {(id) => (
                <Select id={id} value={level} onChange={(e) => setLevel(e.target.value)}>
                  {LEARNER_LEVEL_VALUES.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={t('admin.ui.lsScene')}>
              {(id) => (
                <Select id={id} value={scene} onChange={(e) => setScene(e.target.value)}>
                  {SCENE_IDS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            {sceneId ? <SvgArt svg={sceneArtSvgString(sceneId, { width: 320 })} label={sceneId} className="rounded-md border border-border" /> : null}
            <Field label={t('admin.ui.cfCount')}>{(id) => <Input id={id} type="number" min={1} max={20} value={count} onChange={(e) => setCount(Number(e.target.value))} />}</Field>
            <Field label={t('admin.contentFactory.intent')} hint={`${intentKeys.length} selected`}>
              {(id) => (
                <>
                  <Input placeholder={t('common.searchPlaceholder')} value={intentQuery} onChange={(e) => setIntentQuery(e.target.value)} className="mb-1" />
                  <Select id={id} multiple size={8} value={intentKeys} onChange={(e) => setIntentKeys(Array.from(e.target.selectedOptions).map((o) => o.value))}>
                    {filteredIntents.map((i) => (
                      <option key={i.key} value={i.key} title={i.description}>
                        {i.key}
                      </option>
                    ))}
                  </Select>
                </>
              )}
            </Field>
            <Button variant="primary" className="w-full justify-center" disabled={!track || !source || intentKeys.length === 0} loading={generate.busy} onClick={() => void generate.run()}>
              {generate.busy ? t('admin.contentFactory.generating') : t('admin.contentFactory.generate')}
            </Button>
            {lastJob ? (
              <Notice tone="success">
                {t('admin.ui.cfJobQueued', { jobId: lastJob.jobId.slice(0, 8) })} · {lastJob.draftIds.length} drafts
              </Notice>
            ) : null}
            {generate.error ? <Notice tone="error">{generate.error}</Notice> : null}
          </div>
        </Card>
        <Card title={t('admin.jobs.title')}>
          {jobs.length === 0 ? <p className="text-xs text-fg-muted">{t('admin.jobs.noJobs')}</p> : null}
          <ul className="space-y-1 text-xs">
            {jobs.slice(0, 10).map((j) => (
              <li key={j.id} className="flex items-center gap-2">
                <code className="font-mono">{shortId(j.id)}</code>
                <JobBadge state={j.state} />
                <span className="text-fg-muted">{j.progress_pct}% · {formatDateTime(j.created_at, locale)}</span>
                {j.failure_message ? <span className="text-error">{j.failure_message}</span> : null}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="space-y-4">
        <Card title={t('admin.ui.cfQueue')}>
          {missions.length === 0 ? <p className="text-sm text-fg-muted">{t('admin.ui.cfNoDrafts')}</p> : null}
          <ul className="divide-y divide-border">
            {missions.map((m) => (
              <li key={m.id}>
                <button type="button" onClick={() => setSelectedMission(m.id)} className={`flex w-full items-center gap-2 py-1.5 text-start text-sm hover:bg-surface-muted ${selectedMission === m.id ? 'bg-accent-soft' : ''}`}>
                  <span className="flex-1 truncate font-medium">{pickLocalized(m.title_translations, locale) || m.template_key || shortId(m.id)}</span>
                  <span className="text-xs text-fg-muted">{m.target_variety_id} · {m.level} · {m.mission_type}</span>
                  <StatusBadge state={m.state} />
                </button>
              </li>
            ))}
          </ul>
        </Card>

        {mission ? (
          <Card
            title={`${t('admin.ui.cfDraftLesson')} · ${pickLocalized(mission.title_translations, locale) || shortId(mission.id)}`}
            actions={
              canDecide ? (
                <>
                  <Button size="sm" loading={requestReview.busy} onClick={() => void requestReview.run(mission.id)}>
                    {t('admin.ui.cfRequestReview')}
                  </Button>
                  <Button size="sm" variant="primary" loading={decide.busy} onClick={() => void decide.run('missions', mission.id, 'approve')}>
                    {t('admin.ui.cfApprove')}
                  </Button>
                  <Button size="sm" variant="danger" loading={decide.busy} onClick={() => void decide.run('missions', mission.id, 'reject')}>
                    {t('admin.ui.cfReject')}
                  </Button>
                </>
              ) : null
            }
          >
            <div className="grid gap-4 lg:grid-cols-2">
              <section>
                <h3 className="mb-1 text-xs font-semibold uppercase text-fg-muted">{t('admin.ui.cfOverlay', { language: mission.localizations.map((l) => l.source_language_code).join(', ') || '—' })}</h3>
                {mission.localizations.length === 0 ? <p className="text-xs text-fg-muted">{t('admin.ui.none')}</p> : null}
                {mission.localizations.map((l) => (
                  <div key={l.source_language_code} className="mb-2 rounded-md border border-border p-2 text-sm">
                    <div className="flex items-center gap-2">
                      <Badge>{l.source_language_code}</Badge>
                      <span className="font-medium">{l.title}</span>
                      <Badge tone={l.qa_state === 'approved' || l.qa_state === 'reviewed' ? 'success' : 'warning'}>{t(`admin.review.translationQa.${l.qa_state}`)}</Badge>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-xs">{l.instructions}</p>
                    {l.hints.length ? <p className="mt-1 text-xs text-fg-muted">hints: {l.hints.join(' · ')}</p> : null}
                  </div>
                ))}
                <h3 className="mb-1 mt-3 text-xs font-semibold uppercase text-fg-muted">{t('admin.ui.cfPrompts')}</h3>
                <p className="text-xs text-fg-muted">{t('admin.ui.cfPromptsHidden')}</p>
                <pre className="mt-1 max-h-40 overflow-auto rounded bg-surface-muted p-2 text-[11px]">{JSON.stringify({ goals: mission.goals, narrative: mission.narrative_segment }, null, 2)}</pre>
              </section>
              <section>
                <h3 className="mb-1 text-xs font-semibold uppercase text-fg-muted">{t('admin.ui.cfSourceExamples')}</h3>
                {missionExpressions.length === 0 ? <p className="text-xs text-fg-muted">{t('admin.ui.none')}</p> : null}
                <ul className="space-y-1">
                  {missionExpressions.map((e) => (
                    <li key={e.id} className="rounded-md border border-border p-2 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <TextField readOnly contentLanguage={e.target_variety_id} value={e.canonical_text} className="flex-1 bg-surface-muted" aria-label={e.id} />
                        <StatusBadge state={e.state} />
                        <Badge tone={e.reviewed ? 'success' : 'warning'}>{e.reviewed ? t('admin.ui.cfNativeReviewed') : t('enrollment.coverage.notNativeReviewed')}</Badge>
                      </div>
                      {e.forms.map((f, i) => (
                        <div key={i} className="mt-0.5 text-xs text-fg-muted">
                          {f.script ?? f.transliteration_scheme}: {f.text}
                        </div>
                      ))}
                      {e.translations.map((tr) => (
                        <div key={tr.source_language_code} className="mt-0.5 text-xs">
                          <Badge>{tr.source_language_code}</Badge> {tr.natural_meaning}
                          {tr.context_note ? <span className="text-fg-muted"> — {tr.context_note}</span> : null}
                        </div>
                      ))}
                      {canDecide && e.state === 'review_needed' ? (
                        <div className="mt-1 flex gap-1">
                          <Button size="sm" onClick={() => void decide.run('expressions', e.id, 'approve')}>
                            {t('admin.review.approve')}
                          </Button>
                          <Button size="sm" variant="danger" onClick={() => void decide.run('expressions', e.id, 'reject')}>
                            {t('admin.review.reject')}
                          </Button>
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
            </div>
            <div className="mt-3">
              <Field label={t('admin.ui.cfQa')} hint={t('admin.review.nativeRequired', { variety: mission.target_variety_id })}>
                {(id) => <Textarea id={id} value={qaComment} onChange={(e) => setQaComment(e.target.value)} />}
              </Field>
              {decide.error ? <Notice tone="error">{decide.error}</Notice> : null}
            </div>
          </Card>
        ) : (
          <Notice tone="info">{t('admin.ui.cfSelectDraft')}</Notice>
        )}
      </div>
    </div>
  );
}
