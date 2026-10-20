'use client';
/**
 * Per-track cast table (owner decision 2026-10-19): the C2 clay characters cast for a course,
 * with age band, gender presentation, skin-tone family, situations and the curriculum intents
 * they carry, so editors can check diversity and role ↔ lesson correlation per course. Data
 * comes from the shared roster (`@langquest/ui/art`); the track defaults to the working context.
 */
import { useMemo, useState } from 'react';
import { useI18n } from '@/src/lib/i18n/client';
import { useWorkingContext } from '@/src/lib/working-context';
import { AGE_BANDS, GENDER_PRESENTATIONS, SKIN_FAMILIES, castForTrack, isCourseTrackId } from '@/src/lib/visual/cast';
import { CastPortrait, Melo } from '@/src/components/brand';
import { Badge } from '@/src/components/badges';
import { EmptyState, Select } from '@/src/components/ui';

export function CastTable({ tracks }: { tracks: Array<{ id: string; name: string }> }) {
  const { t } = useI18n();
  const [ctx] = useWorkingContext();
  const [trackId, setTrackId] = useState(() => (tracks.some((tr) => tr.id === ctx.courseTrackId) ? ctx.courseTrackId! : (tracks[0]?.id ?? '')));
  const cast = useMemo(() => castForTrack(trackId), [trackId]);
  const bandLabel = (b: string) => t(`admin.ui.ageBand.${b}`);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select aria-label={t('admin.ui.castTrack')} className="w-auto" value={trackId} onChange={(e) => setTrackId(e.target.value)}>
          {tracks.map((tr) => (
            <option key={tr.id} value={tr.id}>
              {tr.name}
            </option>
          ))}
        </Select>
        {cast ? (
          <span className="text-xs text-fg-muted">{t('admin.ui.castSummary', { members: cast.members.length, intents: cast.intentCount })}</span>
        ) : null}
      </div>
      {cast && cast.members.length > 0 ? (
        <>
          <div className="flex flex-wrap gap-1.5" aria-label={t('admin.ui.castTitle')}>
            {AGE_BANDS.map((b) => (
              <Badge key={b} tone={cast.ageBands[b] === 0 ? 'warning' : 'neutral'}>
                {bandLabel(b)} {cast.ageBands[b]}
              </Badge>
            ))}
            {GENDER_PRESENTATIONS.map((g) => (
              <Badge key={g} tone={cast.genders[g] === 0 ? 'warning' : 'neutral'}>
                {t(`admin.ui.genderPresentation.${g}`)} {cast.genders[g]}
              </Badge>
            ))}
            {SKIN_FAMILIES.map((f) => (
              <Badge key={f} tone={cast.skinFamilies[f] === 0 ? 'warning' : 'neutral'}>
                {t(`admin.ui.skinFamily.${f}`)} {cast.skinFamilies[f]}
              </Badge>
            ))}
          </div>
          {cast.missingAgeBands.length > 0 || cast.missingGenders.length > 0 ? (
            <p className="text-xs text-warning">
              {t('admin.ui.castMissing', { bands: [...cast.missingAgeBands.map(bandLabel), ...cast.missingGenders.map((g) => t(`admin.ui.genderPresentation.${g}`))].join(', ') })}
            </p>
          ) : null}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-fg-muted">
                <tr>
                  <th className="py-1 text-start" />
                  <th className="py-1 text-start">{t('admin.ui.castName')}</th>
                  <th className="py-1 text-start">{t('admin.ui.castRole')}</th>
                  <th className="py-1 text-start">{t('admin.ui.castAge')}</th>
                  <th className="py-1 text-start">{t('admin.ui.castGender')}</th>
                  <th className="py-1 text-start">{t('admin.ui.castSkin')}</th>
                  <th className="py-1 text-start">{t('admin.ui.castSituations')}</th>
                </tr>
              </thead>
              <tbody>
                {cast.members.map((m) => (
                  <tr key={m.id} className="border-t border-border align-top">
                    <td className="py-1.5 pe-2">
                      <CastPortrait characterId={m.id} size={40} />
                    </td>
                    <td className="py-1.5 font-medium">
                      {m.name}
                      <div className="text-[11px] font-normal text-fg-muted">
                        {m.city}, {m.region}
                      </div>
                    </td>
                    <td className="py-1.5">{m.role}</td>
                    <td className="py-1.5">{bandLabel(m.ageBand)}</td>
                    <td className="py-1.5">{t(`admin.ui.genderPresentation.${m.gender}`)}</td>
                    <td className="py-1.5">{t(`admin.ui.skinFamily.${m.skinFamily}`)}</td>
                    <td className="py-1.5">
                      <div className="flex flex-wrap gap-1">
                        {m.situations.map((s) => (
                          <Badge key={s.tag} title={s.tag}>
                            {s.label}
                          </Badge>
                        ))}
                      </div>
                      <div className="mt-0.5 text-[11px] text-fg-muted">{t('admin.ui.castIntents', { count: m.intents.length })}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <EmptyState art={<Melo state="curious" size={72} trackId={isCourseTrackId(trackId) ? trackId : null} />} title={t('admin.ui.castEmpty')} />
      )}
    </div>
  );
}
