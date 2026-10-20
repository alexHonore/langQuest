'use client';
/**
 * AI models (§8.7): profile editor per task × target variety × source language, test harness
 * (prompt / synthesize / transcribe probes), benchmark results, and the enable toggle that only
 * succeeds through the API with passing smoke tests. Fallbacks never cross a variety boundary —
 * the API enforces it; the UI shows the capability matrix status for the selected variety.
 */
import { useEffect, useMemo, useState } from 'react';
import { AI_TASK_NAME_VALUES, LATENCY_CLASS_VALUES, AiProviderSchema, ModelBenchmarkRequestSchema, ModelConfigPutRequestSchema, type ModelProfile } from '@langquest/contracts';
import type { z } from 'zod';

type ModelConfigPutRequest = z.input<typeof ModelConfigPutRequestSchema>;
type ModelBenchmarkRequest = z.input<typeof ModelBenchmarkRequestSchema>;

/** Benchmark dialog state: the variety is explicit — a global profile never defaults to one dialect. */
interface BenchmarkForm {
  profile: ProfileRow;
  sampleSetId: string;
  targetVariety: string | null;
  sourceLanguage: string | null;
}
import { browserApi } from '@/src/lib/api-browser';
import { localCall } from '@/src/lib/local-api/client';
import { useI18n } from '@/src/lib/i18n/client';
import { useAction } from '@/src/lib/use-action';
import { formatDateTime, formatUsd, newIdempotencyKey, shortId } from '@/src/lib/format';
import { Button, Card, Checkbox, Field, Input, Notice, Select, Textarea } from '@/src/components/ui';
import { Dialog } from '@/src/components/dialog';
import { Badge } from '@/src/components/badges';
import { DataTable, type Column } from '@/src/components/data-table';
import { LanguageSelect, TagListInput, VarietySelect } from '@/src/components/forms';
import { SetupCard } from '@/src/components/setup-card';
import { useDeployment } from '@/src/lib/setup/context';

export interface ProfileRow {
  id: string;
  task: string;
  target_variety_id: string | null;
  source_language_code: string | null;
  provider: string;
  primary_model: string;
  fallback_models: string[];
  params: Record<string, unknown>;
  capabilities: Record<string, unknown>;
  latency_class: string;
  daily_budget_usd: number | null;
  enabled: boolean;
  version: number;
  benchmark_status: string;
  updated_by: string | null;
  updated_at: string;
}
export interface BenchmarkRow {
  id: string;
  profile_id: string;
  model: string;
  target_variety_id: string | null;
  source_language_code: string | null;
  sample_set_id: string;
  evaluator_version: string;
  naturalness: number | null;
  intelligibility: number | null;
  dialect_adherence: number | null;
  false_correction_rate: number | null;
  wer: number | null;
  latency_p50_ms: number | null;
  latency_p95_ms: number | null;
  cost_per_call_usd: number | null;
  passed: boolean;
  notes: string | null;
  created_at: string;
}

interface ProfileForm {
  id?: string;
  task: string;
  targetVariety: string | null;
  sourceLanguage: string | null;
  provider: string;
  primaryModel: string;
  fallbackModels: string[];
  temperature: string;
  topP: string;
  maxOutputTokens: string;
  timeoutMs: string;
  sttLanguage: string;
  voiceId: string;
  latencyClass: string;
  dailyBudgetUsd: string;
  enabled: boolean;
  expectedVersion?: number;
}

const BENCH_TONE = (s: string) => (s === 'passing' ? 'success' : s === 'failing' ? 'error' : s === 'stale' ? 'warning' : 'neutral') as 'success' | 'error' | 'warning' | 'neutral';

const emptyForm: ProfileForm = { task: 'character_dialogue', targetVariety: null, sourceLanguage: null, provider: 'openrouter', primaryModel: '', fallbackModels: [], temperature: '', topP: '', maxOutputTokens: '', timeoutMs: '', sttLanguage: '', voiceId: '', latencyClass: 'interactive', dailyBudgetUsd: '', enabled: false };

function toForm(p: ProfileRow): ProfileForm {
  const params = p.params ?? {};
  const str = (v: unknown) => (v == null ? '' : String(v));
  return {
    id: p.id,
    task: p.task,
    targetVariety: p.target_variety_id,
    sourceLanguage: p.source_language_code,
    provider: p.provider,
    primaryModel: p.primary_model,
    fallbackModels: p.fallback_models,
    temperature: str(params.temperature),
    topP: str(params.topP),
    maxOutputTokens: str(params.maxOutputTokens),
    timeoutMs: str(params.timeoutMs),
    sttLanguage: str(params.sttLanguage),
    voiceId: str(params.voiceId),
    latencyClass: p.latency_class,
    dailyBudgetUsd: str(p.daily_budget_usd),
    enabled: p.enabled,
    expectedVersion: p.version,
  };
}

const num = (v: string) => (v.trim() === '' ? undefined : Number(v));

export function AiModelsScreen({ profiles, benchmarks, localProbeAvailable }: { profiles: ProfileRow[]; benchmarks: BenchmarkRow[]; localProbeAvailable: boolean }) {
  const { t, locale } = useI18n();
  const { aiAvailable } = useDeployment();
  const [form, setForm] = useState<ProfileForm | null>(null);
  const [taskFilter, setTaskFilter] = useState('');
  const [smoke, setSmoke] = useState<Array<{ name: string; passed: boolean; detail: string | null }> | null>(null);
  const [models, setModels] = useState<Array<{ id: string; provider: string; modalities: string[] }> | null>(null);
  const [modelsError, setModelsError] = useState<string | null>(null);

  useEffect(() => {
    browserApi()
      .call('adminModelsList')
      .then((res) => setModels(res.availableModels))
      .catch((e: unknown) => setModelsError(e instanceof Error ? e.message : String(e)));
  }, []);

  const rows = useMemo(() => profiles.filter((p) => !taskFilter || p.task === taskFilter), [profiles, taskFilter]);

  const saveViaApi = useAction(
    async (f: ProfileForm, requireSmokeTests: boolean) => {
      const body: ModelConfigPutRequest = {
        task: f.task as ModelProfile['task'],
        targetVariety: f.targetVariety as ModelProfile['targetVariety'],
        sourceLanguage: f.sourceLanguage as ModelProfile['sourceLanguage'],
        provider: AiProviderSchema.parse(f.provider),
        primaryModel: f.primaryModel,
        fallbackModels: f.fallbackModels,
        params: { temperature: num(f.temperature), topP: num(f.topP), maxOutputTokens: num(f.maxOutputTokens), timeoutMs: num(f.timeoutMs), sttLanguage: f.sttLanguage || undefined, voiceId: f.voiceId || undefined },
        latencyClass: f.latencyClass as ModelProfile['latencyClass'],
        enabled: f.enabled,
        dailyBudgetUsd: f.dailyBudgetUsd.trim() === '' ? null : Number(f.dailyBudgetUsd),
        expectedVersion: f.expectedVersion,
        requireSmokeTests,
      };
      const res = await browserApi().call('adminModelConfigPut', { params: { task: f.task }, body });
      setSmoke(res.smokeTests);
      return res;
    },
    { successMessage: (res) => `${t('admin.models.save')} · ${t('admin.models.version', { version: res.profile.version })}` },
  );
  const saveDraftLocally = useAction(
    async (f: ProfileForm) =>
      localCall<{ id: string; version: number }>('/api/admin/models/profiles', {
        method: 'POST',
        body: {
          id: f.id,
          task: f.task,
          targetVariety: f.targetVariety,
          sourceLanguage: f.sourceLanguage,
          provider: f.provider,
          primaryModel: f.primaryModel,
          fallbackModels: f.fallbackModels,
          params: { temperature: num(f.temperature), topP: num(f.topP), maxOutputTokens: num(f.maxOutputTokens), timeoutMs: num(f.timeoutMs), sttLanguage: f.sttLanguage || undefined, voiceId: f.voiceId || undefined },
          latencyClass: f.latencyClass,
          dailyBudgetUsd: f.dailyBudgetUsd.trim() === '' ? null : Number(f.dailyBudgetUsd),
          expectedVersion: f.expectedVersion,
        },
      }),
    { successMessage: t('admin.ui.saved') },
  );
  const [bench, setBench] = useState<BenchmarkForm | null>(null);
  const benchmark = useAction(
    async (f: BenchmarkForm) => {
      // Validate against the contract before calling: the variety must be a real VarietyId chosen by
      // the operator (or the profile's own); nothing is ever substituted for a global profile.
      const body: ModelBenchmarkRequest = ModelBenchmarkRequestSchema.parse({
        profileId: f.profile.id,
        targetVariety: f.targetVariety,
        sourceLanguage: f.sourceLanguage ?? undefined,
        sampleSetId: f.sampleSetId.trim(),
        idempotencyKey: newIdempotencyKey('bench'),
      });
      const res = await browserApi().call('adminModelBenchmark', { params: { task: f.profile.task }, body });
      setBench(null);
      return res;
    },
    { successMessage: (res) => t('admin.ui.aiBenchmarkQueued', { jobId: res.jobId.slice(0, 8), state: res.state }) },
  );
  const benchReady = Boolean(bench && bench.sampleSetId.trim() && bench.targetVariety);

  const columns: Column<ProfileRow>[] = [
    { key: 'task', header: t('admin.models.task'), render: (p) => <button type="button" className="font-medium text-accent-text hover:underline" onClick={() => { setForm(toForm(p)); setSmoke(null); }}>{p.task}</button> },
    { key: 'scope', header: t('admin.ui.aiSpecificity'), render: (p) => <span className="text-xs">{p.target_variety_id ?? '*'} / {p.source_language_code ?? '*'}{!p.target_variety_id && !p.source_language_code ? <Badge tone="neutral">{t('admin.ui.aiGlobal')}</Badge> : null}</span> },
    { key: 'model', header: t('admin.models.primaryModel'), render: (p) => <span className="font-mono text-xs">{p.primary_model}{p.fallback_models.length ? <span className="text-fg-muted"> → {p.fallback_models.join(' → ')}</span> : null}</span> },
    { key: 'provider', header: t('admin.models.provider'), render: (p) => p.provider },
    { key: 'latency', header: t('admin.models.latencyClass'), render: (p) => p.latency_class },
    { key: 'enabled', header: t('admin.models.enabled'), render: (p) => <Badge tone={p.enabled ? 'success' : 'neutral'}>{p.enabled ? t('admin.ui.yes') : t('admin.ui.no')}</Badge> },
    { key: 'bench', header: t('admin.models.benchmarkStatus', { status: '' }).replace(': ', ''), render: (p) => <Badge tone={BENCH_TONE(p.benchmark_status)}>{p.benchmark_status}</Badge> },
    { key: 'budget', header: t('admin.models.dailyBudget'), className: 'tabular-nums', render: (p) => formatUsd(p.daily_budget_usd, locale) },
    { key: 'version', header: t('admin.models.version', { version: '' }).trim(), render: (p) => <span className="text-xs">v{p.version} · {formatDateTime(p.updated_at, locale)}</span> },
    // Benchmarks run through the API's provider: without an AI route the column does not exist (CONVENTIONS §8).
    ...(aiAvailable
      ? [
          {
            key: 'actions',
            header: t('admin.ui.actions'),
            render: (p: ProfileRow) => (
              <Button size="sm" loading={benchmark.busy} onClick={() => setBench({ profile: p, sampleSetId: 'default', targetVariety: p.target_variety_id, sourceLanguage: p.source_language_code })}>
                {t('admin.models.benchmark')}
              </Button>
            ),
          } satisfies Column<ProfileRow>,
        ]
      : []),
  ];

  const newProfile = (
    <Button variant="primary" className="ms-auto" onClick={() => { setForm(emptyForm); setSmoke(null); }}>
      {t('admin.ui.aiNewProfile')}
    </Button>
  );

  return (
    <div className="space-y-4">
      {!aiAvailable ? <SetupCard keys={['api', 'ai']} /> : null}
      <div className="flex flex-wrap items-center gap-2">
        <Select aria-label={t('admin.models.task')} className="w-auto" value={taskFilter} onChange={(e) => setTaskFilter(e.target.value)}>
          <option value="">{t('admin.ui.all')}</option>
          {AI_TASK_NAME_VALUES.map((task) => (
            <option key={task} value={task}>
              {task}
            </option>
          ))}
        </Select>
        <span className="text-xs text-fg-muted">{models ? `${models.length} models discoverable` : modelsError ? t('admin.ui.aiNoModels') : t('admin.ui.loading')}</span>
        {rows.length > 0 ? newProfile : null}
      </div>
      <DataTable columns={columns} rows={rows} rowKey={(p) => p.id} caption={t('admin.ui.aiProfiles')} empty={t('admin.ui.aiEmptyProfiles')} emptyAction={newProfile} dense />

      {/* The harness needs a server-side key on the admin host; without it the card is simply absent (listed on Setup). */}
      {localProbeAvailable || benchmarks.length > 0 ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {localProbeAvailable ? <Harness defaultModel={profiles[0]?.primary_model ?? ''} /> : null}
          {benchmarks.length > 0 ? (
        <Card title={t('admin.ui.aiBenchmarks')}>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-fg-muted">
                <tr>
                  <th className="py-1 text-start">model</th>
                  <th className="py-1 text-start">{t('admin.models.variety')}</th>
                  <th className="py-1 text-end">{t('admin.ui.aiNaturalness')}</th>
                  <th className="py-1 text-end">{t('admin.ui.aiIntelligibility')}</th>
                  <th className="py-1 text-end">{t('admin.ui.aiDialect')}</th>
                  <th className="py-1 text-end">{t('admin.ui.aiWer')}</th>
                  <th className="py-1 text-end">{t('admin.ui.aiFalseCorrection')}</th>
                  <th className="py-1 text-end">p50/p95</th>
                  <th className="py-1 text-end">{t('admin.analytics.cost')}</th>
                  <th className="py-1 text-start">{t('admin.ui.aiPassed')}</th>
                </tr>
              </thead>
              <tbody>
                {benchmarks.map((b) => (
                  <tr key={b.id} className="border-t border-border">
                    <td className="py-1 font-mono">{b.model}</td>
                    <td className="py-1">{b.target_variety_id ?? '*'}/{b.source_language_code ?? '*'}</td>
                    <td className="py-1 text-end tabular-nums">{pct(b.naturalness)}</td>
                    <td className="py-1 text-end tabular-nums">{pct(b.intelligibility)}</td>
                    <td className="py-1 text-end tabular-nums">{pct(b.dialect_adherence)}</td>
                    <td className="py-1 text-end tabular-nums">{pct(b.wer)}</td>
                    <td className="py-1 text-end tabular-nums">{pct(b.false_correction_rate)}</td>
                    <td className="py-1 text-end tabular-nums">{b.latency_p50_ms ?? '—'}/{b.latency_p95_ms ?? '—'} ms</td>
                    <td className="py-1 text-end tabular-nums">{formatUsd(b.cost_per_call_usd, locale)}</td>
                    <td className="py-1">
                      <Badge tone={b.passed ? 'success' : 'error'}>{b.passed ? t('admin.ui.yes') : t('admin.ui.no')}</Badge> <span className="text-fg-muted">{b.sample_set_id} · {shortId(b.profile_id)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
          ) : null}
        </div>
      ) : null}

      <Dialog
        open={bench !== null}
        onClose={() => setBench(null)}
        title={bench ? t('admin.ui.aiBenchmarkTitle', { task: bench.profile.task, model: bench.profile.primary_model }) : ''}
        footer={
          bench ? (
            <>
              <Button onClick={() => setBench(null)}>{t('admin.ui.cancel')}</Button>
              <Button variant="primary" loading={benchmark.busy} disabled={!benchReady} onClick={() => void benchmark.run(bench)}>
                {t('admin.ui.aiRunBenchmark')}
              </Button>
            </>
          ) : null
        }
      >
        {bench ? (
          <div className="space-y-3">
            <Field label={t('admin.ui.aiSampleSet')} required>
              {(id) => <Input id={id} value={bench.sampleSetId} onChange={(e) => setBench({ ...bench, sampleSetId: e.target.value })} />}
            </Field>
            {bench.profile.target_variety_id ? (
              <Field label={t('admin.models.variety')}>{() => <p className="text-sm">{bench.profile.target_variety_id}</p>}</Field>
            ) : (
              <>
                <Notice tone="warning">{t('admin.ui.aiBenchmarkVarietyHint')}</Notice>
                <Field label={t('admin.models.variety')} required error={bench.targetVariety ? undefined : t('admin.ui.aiBenchmarkVarietyRequired')}>
                  {(id) => <VarietySelect id={id} value={bench.targetVariety} onChange={(v) => setBench({ ...bench, targetVariety: v })} />}
                </Field>
              </>
            )}
            {bench.profile.source_language_code ? (
              <Field label={t('admin.models.sourceLanguage')}>{() => <p className="text-sm">{bench.profile.source_language_code}</p>}</Field>
            ) : (
              <Field label={t('admin.models.sourceLanguage')} hint={t('admin.ui.aiBenchmarkSourceHint')}>
                {(id) => <LanguageSelect id={id} value={bench.sourceLanguage} onChange={(v) => setBench({ ...bench, sourceLanguage: v })} emptyLabel={t('admin.ui.aiBenchmarkSourceAny')} />}
              </Field>
            )}
            {benchmark.error ? <Notice tone="error">{benchmark.error}</Notice> : null}
          </div>
        ) : null}
      </Dialog>

      <Dialog
        open={form !== null}
        onClose={() => setForm(null)}
        wide
        title={form?.id ? `${t('admin.ui.edit')} · ${form.task}` : t('admin.ui.aiNewProfile')}
        footer={
          form ? (
            <>
              <Button onClick={() => setForm(null)}>{t('admin.ui.cancel')}</Button>
              <Button variant={aiAvailable ? 'secondary' : 'primary'} loading={saveDraftLocally.busy} disabled={!form.primaryModel.trim()} onClick={() => void saveDraftLocally.run(form).then((r) => r && setForm(null))} title={t('admin.ui.aiEnableRequiresSmoke')}>
                {t('admin.ui.aiSaveDraft')}
              </Button>
              {aiAvailable ? (
                <Button variant="primary" loading={saveViaApi.busy} disabled={!form.primaryModel.trim()} onClick={() => void saveViaApi.run(form, true)}>
                  {t('admin.models.save')} {form.enabled ? '+ smoke tests' : ''}
                </Button>
              ) : null}
            </>
          ) : null
        }
      >
        {form ? (
          <div className="space-y-3">
            <Notice tone="info">{t('admin.ui.aiEnableRequiresSmoke')}</Notice>
            <div className="grid gap-2 sm:grid-cols-3">
              <Field label={t('admin.models.task')}>
                {(id) => (
                  <Select id={id} value={form.task} disabled={Boolean(form.id)} onChange={(e) => setForm({ ...form, task: e.target.value })}>
                    {AI_TASK_NAME_VALUES.map((task) => (
                      <option key={task} value={task}>
                        {task}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label={t('admin.models.variety')}>{(id) => <VarietySelect id={id} value={form.targetVariety} onChange={(v) => setForm({ ...form, targetVariety: v })} />}</Field>
              <Field label={t('admin.models.sourceLanguage')}>{(id) => <LanguageSelect id={id} value={form.sourceLanguage} onChange={(v) => setForm({ ...form, sourceLanguage: v })} />}</Field>
              <Field label={t('admin.models.provider')}>
                {(id) => (
                  <Select id={id} value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })}>
                    {AiProviderSchema.options.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label={t('admin.models.primaryModel')} required className="sm:col-span-2">
                {(id) => <Input id={id} list="lq-models" value={form.primaryModel} onChange={(e) => setForm({ ...form, primaryModel: e.target.value })} placeholder="openai/gpt-4.1-mini" />}
              </Field>
              <datalist id="lq-models">{models?.slice(0, 500).map((m) => <option key={m.id} value={m.id} />)}</datalist>
              <Field label={t('admin.models.fallbackModels')} hint={t('admin.models.fallbackNote')} className="sm:col-span-3">
                {() => <TagListInput label={t('admin.models.fallbackModels')} value={form.fallbackModels} onChange={(v) => setForm({ ...form, fallbackModels: v })} />}
              </Field>
              <Field label={t('admin.ui.aiVoice')}>{(id) => <Input id={id} value={form.voiceId} onChange={(e) => setForm({ ...form, voiceId: e.target.value })} />}</Field>
              <Field label={t('admin.ui.aiSttLanguage')}>{(id) => <Input id={id} value={form.sttLanguage} onChange={(e) => setForm({ ...form, sttLanguage: e.target.value })} />}</Field>
              <Field label={t('admin.models.latencyClass')}>
                {(id) => (
                  <Select id={id} value={form.latencyClass} onChange={(e) => setForm({ ...form, latencyClass: e.target.value })}>
                    {LATENCY_CLASS_VALUES.map((l) => (
                      <option key={l} value={l}>
                        {l}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label={t('admin.ui.aiTemperature')}>{(id) => <Input id={id} type="number" step="0.1" min={0} max={2} value={form.temperature} onChange={(e) => setForm({ ...form, temperature: e.target.value })} />}</Field>
              <Field label={t('admin.ui.aiTopP')}>{(id) => <Input id={id} type="number" step="0.05" min={0} max={1} value={form.topP} onChange={(e) => setForm({ ...form, topP: e.target.value })} />}</Field>
              <Field label={t('admin.ui.aiMaxTokens')}>{(id) => <Input id={id} type="number" min={0} value={form.maxOutputTokens} onChange={(e) => setForm({ ...form, maxOutputTokens: e.target.value })} />}</Field>
              <Field label={t('admin.ui.aiTimeout')}>{(id) => <Input id={id} type="number" min={0} value={form.timeoutMs} onChange={(e) => setForm({ ...form, timeoutMs: e.target.value })} />}</Field>
              <Field label={t('admin.models.dailyBudget')} hint={t('admin.models.budgetNote')}>{(id) => <Input id={id} type="number" min={0} step="0.5" value={form.dailyBudgetUsd} onChange={(e) => setForm({ ...form, dailyBudgetUsd: e.target.value })} />}</Field>
              {aiAvailable ? (
                <div className="flex items-end">
                  <Checkbox label={t('admin.models.enabled')} checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
                </div>
              ) : null}
            </div>
            {smoke ? (
              <div>
                <h3 className="text-xs font-semibold">{t('admin.ui.aiSmokeResults')}</h3>
                <ul className="mt-1 space-y-0.5 text-xs">
                  {smoke.map((s) => (
                    <li key={s.name} className="flex items-center gap-2">
                      <Badge tone={s.passed ? 'success' : 'error'}>{s.passed ? 'pass' : 'fail'}</Badge>
                      <span>{s.name}</span>
                      <span className="text-fg-muted">{s.detail}</span>
                    </li>
                  ))}
                  {smoke.length === 0 ? <li className="text-fg-muted">{t('admin.ui.none')}</li> : null}
                </ul>
              </div>
            ) : null}
            {saveViaApi.error ? <Notice tone="error">{saveViaApi.error}</Notice> : null}
            {saveDraftLocally.error ? <Notice tone="error">{saveDraftLocally.error}</Notice> : null}
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}

function pct(v: number | null): string {
  return v == null ? '—' : `${Math.round(v * 100)}%`;
}

function Harness({ defaultModel }: { defaultModel: string }) {
  const { t } = useI18n();
  const [mode, setMode] = useState<'prompt' | 'synthesize' | 'transcribe'>('prompt');
  const [model, setModel] = useState(defaultModel);
  const [prompt, setPrompt] = useState('');
  const [system, setSystem] = useState('');
  const [text, setText] = useState('');
  const [voice, setVoice] = useState('');
  const [language, setLanguage] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const run = useAction(
    async () => {
      let body: Record<string, unknown>;
      if (mode === 'prompt') body = { mode, models: model.split(',').map((m) => m.trim()).filter(Boolean), prompt, system: system || undefined };
      else if (mode === 'synthesize') body = { mode, model, text, voice: voice || undefined };
      else {
        if (!file) throw new Error('audio file required');
        const buf = new Uint8Array(await file.arrayBuffer());
        let bin = '';
        for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
        body = { mode, model, audioBase64: btoa(bin), format: file.name.split('.').pop() ?? 'mp3', language: language || undefined };
      }
      const res = await localCall<Record<string, unknown>>('/api/admin/models/test', { method: 'POST', body });
      setResult(res);
      return res;
    },
    { refresh: false },
  );
  return (
    <Card title={t('admin.ui.aiHarness')}>
      <div className="mt-2 space-y-2">
        <div className="flex gap-1">
          {(['prompt', 'synthesize', 'transcribe'] as const).map((m) => (
            <Button key={m} size="sm" variant={mode === m ? 'primary' : 'secondary'} onClick={() => setMode(m)}>
              {m === 'prompt' ? t('admin.ui.aiRunPrompt') : m === 'synthesize' ? t('admin.ui.aiSynthesize') : t('admin.ui.aiTranscribe')}
            </Button>
          ))}
        </div>
        <Field label={t('admin.models.primaryModel')} hint={mode === 'prompt' ? 'comma-separated chain: primary, fallback…' : undefined}>
          {(id) => <Input id={id} value={model} onChange={(e) => setModel(e.target.value)} />}
        </Field>
        {mode === 'prompt' ? (
          <>
            <Field label="system">{(id) => <Textarea id={id} rows={2} value={system} onChange={(e) => setSystem(e.target.value)} />}</Field>
            <Field label={t('admin.ui.aiPrompt')}>{(id) => <Textarea id={id} rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} />}</Field>
          </>
        ) : null}
        {mode === 'synthesize' ? (
          <>
            <Field label={t('admin.ui.aiTextToSpeak')}>{(id) => <Textarea id={id} rows={2} value={text} onChange={(e) => setText(e.target.value)} />}</Field>
            <Field label={t('admin.ui.aiVoice')}>{(id) => <Input id={id} value={voice} onChange={(e) => setVoice(e.target.value)} />}</Field>
          </>
        ) : null}
        {mode === 'transcribe' ? (
          <>
            <Field label={t('admin.ui.aiAudioFile')}>{(id) => <input id={id} type="file" accept="audio/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />}</Field>
            <Field label={t('admin.ui.aiSttLanguage')}>{(id) => <Input id={id} value={language} onChange={(e) => setLanguage(e.target.value)} placeholder="ar" />}</Field>
          </>
        ) : null}
        <Button variant="primary" disabled={!model.trim() || (mode === 'prompt' && !prompt.trim()) || (mode === 'synthesize' && !text.trim()) || (mode === 'transcribe' && !file)} loading={run.busy} onClick={() => void run.run()}>
          {t('admin.ui.aiRunPrompt')}
        </Button>
        {run.error ? <Notice tone="error">{run.error}</Notice> : null}
        {result ? (
          <div className="rounded-md border border-border bg-surface-muted p-2 text-xs">
            <div className="mb-1 flex flex-wrap gap-2 text-fg-muted">
              {typeof result.latencyMs === 'number' ? <span>{t('admin.ui.aiLatency', { ms: result.latencyMs })}</span> : null}
              {typeof result.estimatedCostUsd === 'number' ? <span>{t('admin.ui.aiCost', { usd: formatUsd(result.estimatedCostUsd) })}</span> : null}
              {typeof result.model === 'string' ? <span className="font-mono">{result.model}</span> : null}
              {typeof result.fallbackIndex === 'number' && result.fallbackIndex > 0 ? <Badge tone="warning">fallback #{result.fallbackIndex}</Badge> : null}
            </div>
            {result.mode === 'prompt' ? <pre className="whitespace-pre-wrap">{String(result.content)}</pre> : null}
            {result.mode === 'synthesize' && typeof result.audioBase64 === 'string' ? (
              <audio controls src={`data:${String(result.mimeType)};base64,${result.audioBase64}`} className="w-full">
                <track kind="captions" />
              </audio>
            ) : null}
            {result.mode === 'transcribe' ? (
              <div>
                <p className="whitespace-pre-wrap">{String(result.text)}</p>
                <p className="text-fg-muted">
                  {String(result.language ?? '')} · confidence {result.confidence == null ? '—' : String(result.confidence)}
                </p>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </Card>
  );
}
