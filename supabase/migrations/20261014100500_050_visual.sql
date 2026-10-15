-- 050 — visual asset tables (§10.2C) and the deferred cover/portrait foreign keys.

create table public.visual_assets (
  id uuid primary key default gen_random_uuid(),
  storage_key text not null unique check (coalesce(public.object_key_scope(storage_key), '') in ('master','derived','public')),
  type public.visual_asset_type not null,
  style_version text not null,
  content_hash public.sha256_hex not null,
  license_id uuid null references public.content_rights(id) on delete set null,
  alt_text_key text not null check (alt_text_key ~ '^[a-z0-9]+(?:[._][a-z0-9]+)*$'),
  focal_point jsonb null,
  dimensions jsonb not null,
  locale_neutral boolean not null default true,
  review_status public.review_status not null default 'draft',
  origin public.content_origin not null,
  mime_type text not null,
  byte_length bigint not null check (byte_length >= 0),
  dominant_colors text[] not null default '{}',
  variants jsonb not null default '[]'::jsonb,
  generation_brief jsonb null,
  prompt_template_id text null,
  source_file_asset_id uuid null references public.media_assets(id) on delete set null,
  replaced_by_asset_id uuid null references public.visual_assets(id) on delete set null,
  moderation_status text not null default 'unchecked' check (moderation_status in ('unchecked','passed','flagged')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index visual_assets_type_idx on public.visual_assets(type, review_status);
create index visual_assets_hash_idx on public.visual_assets(content_hash);
select public.attach_updated_at('public.visual_assets');

create table public.mascot_animations (
  id uuid primary key default gen_random_uuid(),
  state public.mascot_state null,
  animation public.mascot_animation null,
  visual_asset_id uuid not null references public.visual_assets(id) on delete cascade,
  /** Mandatory static fallback (reduce motion / mascot off). */
  static_visual_asset_id uuid not null references public.visual_assets(id) on delete restrict,
  format text not null check (format in ('lottie','rive','svg_css','sprite')),
  duration_ms integer null check (duration_ms is null or duration_ms >= 0),
  loop boolean not null default false,
  size_variant text not null default 'companion' check (size_variant in ('icon','companion','medium','large')),
  style_version text not null,
  review_status public.review_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (state is not null or animation is not null)
);
create index mascot_animations_state_idx on public.mascot_animations(state, size_variant);
select public.attach_updated_at('public.mascot_animations');

create table public.character_visual_variants (
  id uuid primary key default gen_random_uuid(),
  character_id uuid not null references public.characters(id) on delete cascade,
  expression public.character_expression null,
  body text not null default 'portrait' check (body in ('portrait','half','full')),
  clothing_variant text null,
  visual_asset_id uuid not null references public.visual_assets(id) on delete cascade,
  style_version text not null,
  review_status public.review_status not null default 'draft',
  cultural_review_note text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index character_visual_variants_character_idx on public.character_visual_variants(character_id, expression);
select public.attach_updated_at('public.character_visual_variants');

create table public.mission_visual_bindings (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references public.missions(id) on delete cascade,
  mission_step_id uuid null references public.mission_steps(id) on delete cascade,
  visual_asset_id uuid not null references public.visual_assets(id) on delete cascade,
  role text not null check (role in ('scene','context_object','story_panel','celebration','map')),
  sort_order integer not null default 0 check (sort_order >= 0),
  semantic_labels text[] not null default '{}',
  variety_specific boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index mission_visual_bindings_mission_idx on public.mission_visual_bindings(mission_id, sort_order);
select public.attach_updated_at('public.mission_visual_bindings');

create table public.audio_cover_art (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid null references public.audio_course_collections(id) on delete cascade,
  chapter_id uuid null references public.audio_chapters(id) on delete cascade,
  lesson_id uuid null references public.audio_lessons(id) on delete cascade,
  visual_asset_id uuid not null references public.visual_assets(id) on delete cascade,
  generated_from_template boolean not null default false,
  template_id text null,
  review_status public.review_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (num_nonnulls(collection_id, chapter_id, lesson_id) = 1)
);
select public.attach_updated_at('public.audio_cover_art');

-- Deferred FKs from earlier migrations
alter table public.lesson_courses add constraint lesson_courses_cover_fkey foreign key (cover_visual_asset_id) references public.visual_assets(id) on delete set null;
alter table public.chapters add constraint chapters_cover_fkey foreign key (cover_visual_asset_id) references public.visual_assets(id) on delete set null;
alter table public.chapters add constraint chapters_map_fkey foreign key (map_visual_asset_id) references public.visual_assets(id) on delete set null;
alter table public.characters add constraint characters_portrait_fkey foreign key (portrait_visual_asset_id) references public.visual_assets(id) on delete set null;
alter table public.audio_course_collections add constraint audio_course_collections_cover_fkey foreign key (cover_visual_asset_id) references public.visual_assets(id) on delete set null;
alter table public.audio_chapters add constraint audio_chapters_cover_fkey foreign key (cover_visual_asset_id) references public.visual_assets(id) on delete set null;
alter table public.audio_lessons add constraint audio_lessons_cover_fkey foreign key (cover_visual_asset_id) references public.visual_assets(id) on delete set null;
