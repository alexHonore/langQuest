-- ---------------------------------------------------------------------------
-- 090: enrollment script_mode is a property of the TARGET track (§2.3, §10.1)
--
-- * An omitted script_mode is filled from course_tracks.default_script_mode
--   ('both' for Darija, Cantonese, Hebrew…), never a blanket 'native'.
-- * An explicit script_mode must be one of the track's script_mode_options.
--
-- The column keeps `not null` but loses its hard-coded 'native' default so the
-- trigger can tell "omitted" (NULL at BEFORE INSERT time) from an explicit value.
-- The repository (`@langquest/db` enrollments.create) resolves the same default
-- from the catalog; this trigger is the invariant for every other writer.
-- ---------------------------------------------------------------------------

alter table public.user_course_enrollments alter column script_mode drop default;

create or replace function public.resolve_enrollment_script_mode()
returns trigger language plpgsql as $$
declare
  v_default public.script_mode;
  v_options text[];
begin
  select default_script_mode, script_mode_options into v_default, v_options
    from public.course_tracks where id = new.course_track_id;
  if v_default is null then
    -- Unknown track: let the foreign key produce the canonical error.
    return new;
  end if;
  if tg_op = 'INSERT' and new.script_mode is null then
    new.script_mode := v_default;
  end if;
  if new.script_mode is null or not (new.script_mode = any(v_options)) then
    raise exception 'script_mode % is not supported by course track % (allowed: %)', coalesce(new.script_mode, 'NULL'), new.course_track_id, array_to_string(v_options, ', ')
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists resolve_enrollment_script_mode on public.user_course_enrollments;
create trigger resolve_enrollment_script_mode
  before insert or update of script_mode, course_track_id on public.user_course_enrollments
  for each row execute function public.resolve_enrollment_script_mode();

comment on function public.resolve_enrollment_script_mode() is
  'Fills an omitted user_course_enrollments.script_mode from course_tracks.default_script_mode and rejects values outside script_mode_options.';
