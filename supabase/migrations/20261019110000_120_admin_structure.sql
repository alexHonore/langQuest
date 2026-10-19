-- ---------------------------------------------------------------------------
-- 120: admin structure helpers behind the promoted admin routes (contracts `ROUTES.admin*`, 2026-10-19).
--
--  1. `visual_assets.alt_text_translations` — per-source-language alt text written by editors at upload
--     time (§10.2A accessibility). `alt_text_key` stays for in-code vector art whose text lives in the
--     locale catalogs; uploaded assets carry their own translations instead of inventing a catalog key.
--  2. `conversation_sessions.scope` — what the session practises (`mission` / `audio_lesson` / `free`,
--     ids and transcript segment ids), persisted as sent so summaries and evaluations can say honestly
--     what the learner was working on.
--  3. `reorder_audio_chapters` / `reorder_audio_lessons` — a reorder is a FULL permutation of the parent's
--     children applied in one statement; partial lists, foreign ids and duplicates are rejected so two
--     editors can never interleave half-applied orders. SECURITY INVOKER (RLS applies); a JWT caller
--     must be a content editor (`42501` otherwise), the service role and migrations pass.
--  4. `revoke_content_rights` — one transaction: stamps `revoked_at`, unpublishes every dependent
--     published entity (publication event per row), flags approved visual assets for re-review, marks
--     speaker consent revoked and revokes offline download manifests of the affected lessons (§7.5).
--     SECURITY DEFINER (learner-owned manifests) behind an explicit editor / service-role guard.
--     Returns the rows it touched so the API can record revisions and invalidate manifests.
-- ---------------------------------------------------------------------------

-- 1. per-language alt text ---------------------------------------------------
alter table public.visual_assets
  add column if not exists alt_text_translations jsonb not null default '{}'::jsonb;
comment on column public.visual_assets.alt_text_translations is
  'Alt text per source-language code ({"en": "...", "fr": "..."}); `en` required for uploaded assets (migration 120). `alt_text_key` remains for catalog-backed art.';

-- 2. conversation scope ------------------------------------------------------
alter table public.conversation_sessions
  add column if not exists scope jsonb null;
comment on column public.conversation_sessions.scope is
  'ConversationSessionScope as sent by the client: {kind: mission|audio_lesson|free, missionId?, audioLessonId?, transcriptSegmentIds?} (migration 120).';

-- 3. atomic reorders ---------------------------------------------------------
/**
 * Re-sorts every chapter of `p_collection_id` to the position of its id in `p_ordered_ids`.
 * Raises `reorder_not_permutation` unless the array is exactly the set of the collection's chapter ids.
 */
create or replace function public.reorder_audio_chapters(p_collection_id uuid, p_ordered_ids uuid[])
returns table (id uuid, sort_order integer)
language plpgsql
set search_path = public
as $$
declare
  v_children integer;
  v_matched integer;
  v_distinct integer;
begin
  if auth.role() = 'authenticated' and not public.is_content_editor() then
    raise exception 'insufficient_privilege: content editors only' using errcode = '42501';
  end if;
  select count(*) into v_children from public.audio_chapters c where c.collection_id = p_collection_id;
  select count(distinct x) into v_distinct from unnest(p_ordered_ids) as x;
  select count(*) into v_matched from public.audio_chapters c where c.collection_id = p_collection_id and c.id = any(p_ordered_ids);
  if v_distinct <> coalesce(array_length(p_ordered_ids, 1), 0) or v_matched <> v_children or v_matched <> v_distinct then
    raise exception 'reorder_not_permutation: orderedIds must list every chapter of the collection exactly once'
      using errcode = '23514';
  end if;
  return query
    with positions as (select x as chapter_id, (ord - 1)::integer as pos from unnest(p_ordered_ids) with ordinality as u(x, ord)),
    updated as (
      update public.audio_chapters c
        set sort_order = p.pos
        from positions p
        where c.id = p.chapter_id and c.collection_id = p_collection_id
        returning c.id, c.sort_order
    )
    select u.id, u.sort_order from updated u order by u.sort_order;
end;
$$;
revoke all on function public.reorder_audio_chapters(uuid, uuid[]) from public, anon;
grant execute on function public.reorder_audio_chapters(uuid, uuid[]) to authenticated, service_role;

/** Same contract as `reorder_audio_chapters` for the lessons of one chapter. */
create or replace function public.reorder_audio_lessons(p_chapter_id uuid, p_ordered_ids uuid[])
returns table (id uuid, sort_order integer)
language plpgsql
set search_path = public
as $$
declare
  v_children integer;
  v_matched integer;
  v_distinct integer;
begin
  if auth.role() = 'authenticated' and not public.is_content_editor() then
    raise exception 'insufficient_privilege: content editors only' using errcode = '42501';
  end if;
  select count(*) into v_children from public.audio_lessons l where l.chapter_id = p_chapter_id;
  select count(distinct x) into v_distinct from unnest(p_ordered_ids) as x;
  select count(*) into v_matched from public.audio_lessons l where l.chapter_id = p_chapter_id and l.id = any(p_ordered_ids);
  if v_distinct <> coalesce(array_length(p_ordered_ids, 1), 0) or v_matched <> v_children or v_matched <> v_distinct then
    raise exception 'reorder_not_permutation: orderedIds must list every lesson of the chapter exactly once'
      using errcode = '23514';
  end if;
  return query
    with positions as (select x as lesson_id, (ord - 1)::integer as pos from unnest(p_ordered_ids) with ordinality as u(x, ord)),
    updated as (
      update public.audio_lessons l
        set sort_order = p.pos
        from positions p
        where l.id = p.lesson_id and l.chapter_id = p_chapter_id
        returning l.id, l.sort_order
    )
    select u.id, u.sort_order from updated u order by u.sort_order;
end;
$$;
revoke all on function public.reorder_audio_lessons(uuid, uuid[]) from public, anon;
grant execute on function public.reorder_audio_lessons(uuid, uuid[]) to authenticated, service_role;

-- 4. rights revocation -------------------------------------------------------
/**
 * Revokes one `content_rights` grant and unpublishes everything that depends on it, atomically.
 *
 * - `content_rights.revoked_at = now()` (idempotent: an already revoked row keeps its original stamp).
 * - Published rows of audio_lessons, audio_course_collections, media_assets, expressions and
 *   lesson_courses whose `content_rights_id` is the grant → `unpublished`, with a `publication_events`
 *   row (reason = p_reason, actor = auth.uid() or p_actor_id).
 * - visual_assets whose `license_id` is the grant and are `approved` → `review_needed`.
 * - speakers whose `content_rights_id` is the grant → `consent_state = 'revoked'`.
 * - `user_download_manifests` of the unpublished lessons → `revoked_at = now()` (offline eligibility).
 *
 * SECURITY DEFINER with an explicit guard: a JWT caller must be a content editor (`42501` otherwise); the
 * service role must pass `p_actor_id` because `publication_events.actor_id` is NOT NULL. Definer rights are
 * needed because `user_download_manifests` is learner-owned (editors cannot touch it under RLS), and the
 * revocation must still reach every pack in the same transaction. Returns every entity it changed.
 */
create or replace function public.revoke_content_rights(
  p_rights_id uuid,
  p_reason text default 'rights_revoked',
  p_note text default null,
  p_actor_id uuid default null
)
returns table (entity_table text, entity_id uuid, previous_state text, new_state text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := coalesce(auth.uid(), p_actor_id);
  v_revoked_at timestamptz;
  v_lesson_ids uuid[] := '{}';
  r record;
begin
  if auth.role() = 'authenticated' and not public.is_content_editor() then
    raise exception 'insufficient_privilege: content editors only' using errcode = '42501';
  end if;
  if v_actor is null then
    raise exception 'revoke_content_rights requires an authenticated editor or p_actor_id' using errcode = '42501';
  end if;
  if p_reason is null or p_reason not in ('rights_revoked', 'takedown', 'expired', 'other') then
    raise exception 'revoke_content_rights: unknown reason %', p_reason using errcode = '22023';
  end if;

  update public.content_rights c
    set revoked_at = coalesce(c.revoked_at, now())
    where c.id = p_rights_id
    returning c.revoked_at into v_revoked_at;
  if not found then
    raise exception 'content_rights % not found or not writable', p_rights_id using errcode = 'P0002';
  end if;

  -- audio lessons
  for r in update public.audio_lessons l set state = 'unpublished' where l.content_rights_id = p_rights_id and l.state = 'published' returning l.id, l.published_revision loop
    insert into public.publication_events (entity_table, entity_id, revision, from_state, to_state, actor_id, reason)
      values ('audio_lessons', r.id, coalesce(r.published_revision, 0), 'published', 'unpublished', v_actor, p_reason || coalesce(': ' || p_note, ''));
    v_lesson_ids := v_lesson_ids || r.id;
    entity_table := 'audio_lessons'; entity_id := r.id; previous_state := 'published'; new_state := 'unpublished'; return next;
  end loop;

  -- audio collections
  for r in update public.audio_course_collections c set state = 'unpublished' where c.content_rights_id = p_rights_id and c.state = 'published' returning c.id, c.published_version loop
    insert into public.publication_events (entity_table, entity_id, revision, from_state, to_state, actor_id, reason)
      values ('audio_course_collections', r.id, coalesce(r.published_version, 0), 'published', 'unpublished', v_actor, p_reason || coalesce(': ' || p_note, ''));
    entity_table := 'audio_course_collections'; entity_id := r.id; previous_state := 'published'; new_state := 'unpublished'; return next;
  end loop;

  -- media assets (any non-terminal state other than unpublished/rejected goes back to rights_unverified; published → unpublished)
  for r in update public.media_assets m set state = 'unpublished' where m.content_rights_id = p_rights_id and m.state = 'published' returning m.id loop
    insert into public.publication_events (entity_table, entity_id, revision, from_state, to_state, actor_id, reason)
      values ('media_assets', r.id, 0, 'published', 'unpublished', v_actor, p_reason || coalesce(': ' || p_note, ''));
    entity_table := 'media_assets'; entity_id := r.id; previous_state := 'published'; new_state := 'unpublished'; return next;
  end loop;

  -- expressions
  for r in update public.expressions e set state = 'unpublished' where e.content_rights_id = p_rights_id and e.state = 'published' returning e.id loop
    insert into public.publication_events (entity_table, entity_id, revision, from_state, to_state, actor_id, reason)
      values ('expressions', r.id, 0, 'published', 'unpublished', v_actor, p_reason || coalesce(': ' || p_note, ''));
    entity_table := 'expressions'; entity_id := r.id; previous_state := 'published'; new_state := 'unpublished'; return next;
  end loop;

  -- lesson courses
  for r in update public.lesson_courses lc set state = 'unpublished' where lc.content_rights_id = p_rights_id and lc.state = 'published' returning lc.id, lc.published_revision loop
    insert into public.publication_events (entity_table, entity_id, revision, from_state, to_state, actor_id, reason)
      values ('lesson_courses', r.id, coalesce(r.published_revision, 0), 'published', 'unpublished', v_actor, p_reason || coalesce(': ' || p_note, ''));
    entity_table := 'lesson_courses'; entity_id := r.id; previous_state := 'published'; new_state := 'unpublished'; return next;
  end loop;

  -- visual assets: approved art loses its approval until re-reviewed under new rights
  for r in update public.visual_assets v set review_status = 'review_needed' where v.license_id = p_rights_id and v.review_status = 'approved' returning v.id loop
    entity_table := 'visual_assets'; entity_id := r.id; previous_state := 'approved'; new_state := 'review_needed'; return next;
  end loop;

  -- speakers: the consent grant behind the voice is gone
  for r in update public.speakers s set consent_state = 'revoked' where s.content_rights_id = p_rights_id and s.consent_state <> 'revoked' returning s.id, s.consent_state loop
    entity_table := 'speakers'; entity_id := r.id; previous_state := null; new_state := 'revoked'; return next;
  end loop;

  -- offline packs of the unpublished lessons are no longer eligible
  if coalesce(array_length(v_lesson_ids, 1), 0) > 0 then
    update public.user_download_manifests d
      set revoked_at = coalesce(d.revoked_at, v_revoked_at)
      where d.lesson_id = any(v_lesson_ids) and d.revoked_at is null;
  end if;

  return;
end;
$$;
revoke all on function public.revoke_content_rights(uuid, text, text, uuid) from public, anon;
grant execute on function public.revoke_content_rights(uuid, text, text, uuid) to authenticated, service_role;
