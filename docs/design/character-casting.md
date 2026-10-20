# Character casting — rules for the LangQuest cast

Status: production rules (owner decision 2026-10-19: character style **C2 soft dimensional / clay**,
diverse cast, roles correlated with lesson content). Supersedes the "16 characters" appendix of
`docs/mascot-style-guide.md` for everything about the cast.

Source of truth: `packages/ui/src/art/characters/` (`roster/*.ts` for the cast, `situations.ts` for
the role ↔ lesson mapping, `portrait.ts` + `clay.ts` for the art). Static exports live under
`assets/characters/<id>/<expression>.svg` and are listed in `ART_MANIFEST` / `assets/art-manifest.json`.
Tests: `packages/ui/src/art/characters/characters.test.ts` enforces every rule marked **(tested)**.

## 1. What a character is

A character is a fictional native speaker the learner talks to. Each one has:

| Field                                     | Rule                                                                                                                                                                                                                                                                 |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                                      | `<variety>-<role>-<name>` slug, lowercase, hyphens only; **never renamed** (the database id is a UUID v5 of the slug — `stableCharacterUuid`). The 16 legacy ids keep their seeded UUIDs **(tested)**.                                                               |
| `name`, `nameNative`                      | Locally plausible, fictional, no real-person or franchise names. Non-Latin-script varieties always carry `nameNative` **(tested)**. Names are never baked into artwork.                                                                                              |
| `role`, `city`, `region`                  | A concrete everyday role in a real city. Roles must be able to _carry_ the character's situations (see §3).                                                                                                                                                          |
| `varietyId`, `trackIds`, `regionalOption` | One language variety per character, never substituted across varieties **(tested)**. `trackIds` are derived from the variety (Mandarin characters serve both Mandarin tracks). `regionalOption` must be a real option of one of the character's tracks **(tested)**. |
| `ageBand`                                 | `child` (6–11), `teen` (12–17), `adult`, `elder` (65+). Drives rig proportions (`look.stature`) and the legacy `look.age`.                                                                                                                                           |
| `genderPresentation`                      | `feminine` / `masculine` (how the character reads; nothing else is encoded).                                                                                                                                                                                         |
| `look`                                    | Palette enums only (skin tone `s1`–`s8`, hair, clothing, accessories). Contemporary clothing; no costumes, flags, logos, landmarks or text.                                                                                                                          |
| `skinFamily`                              | Derived from the skin tone: `light` (s1–s2), `medium` (s3–s4), `brown` (s5–s6), `deep` (s7–s8).                                                                                                                                                                      |
| `situations`, `intents`                   | ≥ 3 situation tags; `intents` are derived from them and must be real `@langquest/curriculum` intent keys **(tested)**.                                                                                                                                               |
| `voice`                                   | pitch / pace / warmth + regional option + notes. No provider voice id is ever claimed; every voice is synthetic and disclosed as such (`packages/db` seed).                                                                                                          |
| `personality`, `lifeContext`              | Two sentences a prompt pack can build on. Keep them everyday and non-stereotyped.                                                                                                                                                                                    |
| `altText`, `silhouetteNotes`              | Generated from the look unless hand-written; never rendered on the art.                                                                                                                                                                                              |
| Review                                    | `complete: false`, `reviewStatus: 'review_needed'` until a native cultural + dialect review signs the character off **(tested)**.                                                                                                                                    |

## 2. Diversity targets

Per **course track** (30 tracks, 97 characters, ≥ 3 per track) **(tested)**:

- at least one child or teen **and** at least one elder;
- both gender presentations;
- at least two skin-tone families.

Across the whole cast **(tested)**: all four age bands, both presentations, all four skin-tone
families, at least 25 children, children of both presentations.

How to meet the skin-tone target without stereotyping: cast the real diversity of the place (a
Nubian family in Cairo, a Cape-Verdean teen in Lisbon, a Somali-Danish student in Aalborg, a
sun-tanned baseball kid in Fukuoka, a Tatar grandmother in Kazan, a Black British child in
Manchester). Never attach a tone to a trope (the "exotic" vendor, the "foreign" worker). Every
character is a local.

Age bands are cast to _roles that exist_: children are schoolchildren, teens are students with a
part-time job or a sport, adults hold everyday jobs (café staff, tailor, nurse, bus driver,
pharmacist, teacher, shop assistant, guide, musician), elders are retired or still run a stall or
a café. Children never carry adult-only situations (office, tailor, taxi driver) **(tested)**.

## 3. Role ↔ lesson correlation

A lesson's communicative intents are produced by the character whose everyday life naturally
contains them. The bridge is the **situation catalogue** (`CHARACTER_SITUATIONS`): each tag maps to
curriculum intent keys and to the youngest age band that can carry it.

| Who                                  | Situation tags (examples)                                                                                             | Produces intents such as                                                                                               |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Child (6–11)                         | `ask_for_ice_cream`, `playground`, `school_day`, `family_stories`, `library_and_reading`                              | `request_food`, `choose_option`, `ask_price`, `pay`, `introduce_name`, `invite`, `describe_routine`, `ask_time`        |
| Teen                                 | `plans_with_friends`, `bus_and_transit`, `sports_talk`, `music_and_hobbies`, `delivery_and_errands`, `clothing_skirt` | `make_plan_time`, `ask_which_stop`, `buy_ticket`, `express_preference_between`, `ask_for_variant`                      |
| Adult – café / restaurant staff      | `order_drink`, `restaurant`, `work_and_routine`                                                                       | `request_drink`, `offer_options`, `confirm_order`, `ask_for_bill`, `ask_payment_method`                                |
| Adult – tailor                       | `tailor_suit`                                                                                                         | `ask_for_variant`, `make_reservation`, `make_plan_time`, `agree_to_price`, `compliment`                                |
| Adult – clothing shop / shopper      | `clothing_skirt`                                                                                                      | `ask_for_variant`, `express_preference_between`, `say_too_expensive`, `say_just_looking`                               |
| Adult – taxi / motorbike-taxi driver | `taxi_destination`, `ask_directions`, `city_tour`                                                                     | `hail_taxi`, `state_destination`, `ask_fare`, `ask_use_meter`, `say_stop_here`                                         |
| Adult – nurse / pharmacist           | `clinic_symptoms`, `pharmacy`                                                                                         | `describe_pain`, `ask_for_doctor_or_pharmacy`, `ask_recommendation`, `ask_opening_hours`                               |
| Adult – coworker                     | `office_meeting`                                                                                                      | `ask_opinion`, `disagree_politely`, `give_reason`, `suggest_other_time`                                                |
| Elder                                | `ask_directions`, `market_bargain`, `family_stories`, `new_neighbour`, `hosting_at_home`, `weather_small_talk`        | `give_direction_turn`, `say_it_is_far`, `offer_lower_price`, `ask_last_price`, `narrate_past_event`, `welcome_someone` |

Rules **(tested)**:

- every child carries `ask_for_ice_cream` and `playground`; every elder carries `family_stories`;
  at least 15 elders give directions;
- `tailor_suit` is adult/elder only; `taxi_destination` is carried by taxi-driver roles only;
- every variety has someone who can be asked the way (`ask_where_is`) and someone to greet
  (`greet_hello`);
- `charactersForIntent(varietyId, intentKey)` and `charactersForSituation(varietyId, tag)` never
  cross a variety boundary and return `[]` honestly when nobody fits (callers fall back to
  `charactersForVariety`).

The owner asked for explicit correlations (a kid asks for ice cream, an adult or elder asks
directions, a woman talks about a skirt, a man about a suit). They are present in every region but
not mechanically mirrored everywhere: Thérèse (Brazzaville, seamstress) carries `tailor_suit`,
Cem (Berlin, tailor) also carries `clothing_skirt`. Vary the pairing across tracks so no
gender ↔ topic rule hardens into a stereotype.

## 4. Art: the C2 clay recipe (what every portrait must satisfy)

- Warm key light upper-left: every material is a three-stop radial gradient (`fx 0.33 / fy 0.27`,
  stops 0 / 0.52 / 1) from `ClayContext.material()`; never reproduce the stops by hand.
- Cool rim light (`#EEF5FF`, 62 % light / 80 % dark) stroked along the lower-right edge and
  clipped to the shape; specular on forehead and nose; contact shadow under the chin.
- **No outlines**: hair / skin / clothing / disc separate by value. The only permitted lines are
  facial features (darker skin tone), tonal contact lines at ≤ 35 % and object strokes (glasses
  frames, headphone band).
- Expression = brows + eyes + mouth + head tilt (+ one hand), never colour. The 9 contract
  expressions render for every character and are pairwise distinct **(tested)**.
- Level of detail: at ≤ 48 px (`PORTRAIT_FLAT_MAX_SIZE`) the same silhouettes render as flat
  two-value fills (base value + one shadow value per material, dot eyes, stroke mouth), no
  gradients, no rim, < 6 KB, fewer than half the nodes **(tested)**. The component picks the level
  from `size`; `detail` overrides it.
- Dark theme: the disc ramp is deepened, the rim raised to 80 %, skin ramps unchanged.
- Gradient and clip ids are namespaced per character (and theme) so many portraits can share one
  DOM **(tested)**. No filters anywhere (react-native-svg parity) **(tested)**.
- Children: head scale 1.1, narrower shoulders, larger eyes; elders: smile lines, grey hair.

Rig vocabulary (extend in `types.ts` and draw in `portrait.ts`): hair styles incl. pigtails,
twists, cornrows, topknot, headscarf (uses the accent colour); clothing incl. scrubs, polo,
turtleneck, kurta, jersey, overalls; extras incl. beanie, kippah, bindi, headphones, stethoscope,
tie. Everything is contemporary everyday wear; a religious or cultural garment is allowed only
when it is everyday wear for that character and drawn without exaggeration.

## 5. Cultural review checklist (before `reviewStatus` can leave `review_needed`)

A native speaker of the variety (ideally from the character's city) checks:

1. **Name** — plausible for the age band and region today; spelling in the native script; no
   famous namesake; romanisation matches the track's conventions.
2. **Role and life context** — realistic for the city; no trope (the retired sailor is in Odesa
   because it is a port city, not because "elders are sailors"); jobs exist in that form locally.
3. **Clothing and accessories** — everyday wear for that person; nothing that reads as a costume,
   uniform-as-stereotype, flag or emblem; religious items only where that character would wear them
   daily, drawn plainly.
4. **Skin tone, hair and features** — the chosen tone/hair are plausible for _this_ person without
   implying anything about the population; no caricature (nose, lips, eyes are the same rig for all).
5. **Regional option and voice notes** — the dialect notes are correct (what is flagged in hints,
   what is never substituted); the regional option is the one a learner would expect.
6. **Situations** — the character would actually have these conversations; age-appropriate;
   nothing adult carried by a child; price/bargaining behaviour matches local norms.
7. **Alt text** — reads naturally, no sensitive attribute is named beyond what the picture shows.
8. **Language sample** — a native speaker reads one `greet_and_introduce` turn in the character's
   voice and signs it off; synthetic voice disclosure remains visible in the app.

Record the review in the character's `culturalReviewNote` (reviewer role, date, variety, outcome),
set `reviewStatus`, and only then plan reviewed `visual_assets` rows (`complete` stays `false`
until every expression has one).

## 6. Adding a character (checklist)

1. Pick the track(s) and check `charactersForTrack(trackId)` for the gap: which age band, gender
   presentation, skin family or situation is missing.
2. Add a `cast({...})` sheet to the regional file under `roster/`. Required: `id`, `name`,
   `role`, `city`, `region`, `varietyId`, `ageBand`, `gender`, `personality`, `lifeContext`,
   `voice`, `look` (skin, hair, hairColor, clothing, clothColor, clothAccent), `situations`.
3. Run `pnpm --filter @langquest/ui test` — the diversity, intent and rendering invariants run
   for the new entry automatically.
4. Run `pnpm --filter @langquest/ui export-art` (regenerates `assets/characters/**` and the
   manifest) and `pnpm --filter @langquest/db seed:characters-sql` (regenerates the character seed
   migration; `packages/db` tests fail on drift).
5. Schedule the cultural review (§5).

## 7. Provenance

All portraits are original parametric vector art generated by `portrait.ts`. No CC0 / Open Peeps /
unDraw / Open Doodles assets are used for any character; no competitor artwork was referenced. No
real-person likeness. Nothing in the exported SVGs contains text (`<title>` holds the accessible
label only).

## 8. Mission casting — who plays each lesson (curriculum ↔ roster)

Status: implemented 2026-10-19 (`packages/curriculum/src/missions/casting.ts`, `packages/db/src/seed/cast-roster.ts`,
`scripts/src/seed-curriculum.ts`). Tests: `packages/curriculum/src/missions/casting.test.ts`,
`scripts/src/seed-curriculum.test.ts` (plan + local-stack manifest), `packages/db/src/seed/cast-roster.test.ts`.

**Blueprint preferences.** Every `MissionBlueprint` (and every seed mission, as an override) carries three
additive fields:

| Field                        | Meaning                                                                                                   | Example (`ask_directions`)                                    |
| ---------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `preferredCharacterIntents`  | curriculum intents the interlocutor's everyday life produces (matched against the roster's `intents`)      | `give_direction_turn`, `say_it_is_far`, `ask_where_is` …      |
| `preferredAgeBands`          | age bands that fit the scene, most natural first                                                           | `['elder', 'adult']`                                          |
| `preferredRoles`             | lowercase role words matched on word boundaries against the character's role text (diacritics-insensitive) | `passer-by`, `retired`, `neighbour`, `guide`, `caretaker`     |

Owner correlations as encoded: `buy_ice_cream` (new chapter-1 blueprint) → child/teen (`schoolgirl`,
`schoolboy`, `pupil`…); `ask_directions` → elder/adult; `take_taxi` → adult taxi/driver roles;
`cafe_order_drink` / `restaurant_order_meal` → café / restaurant staff; `shop_for_clothes` → shop assistant,
tailor, seamstress; `talk_about_family` / `tell_a_story` → elders first. Chapter 1 of the default arc now has
seven missions (`buy_ice_cream` last); the Darija draft chapter ships it as `ary_buy_ice_cream`
(AI draft, `review_needed`) pinned to `ary-schoolgirl-salma` with `rosterCharacterId`.

**Resolver.** `castForMission(mission, roster, { varietyId, regionalOption?, alreadyCast?, pinnedCharacterId?,
allowFallback? })` ranks the roster deterministically (role word +3, intent coverage ×4, age band fit ±2,
regional option +0.5, −1 per reuse in the chapter, roster order as tie-break) and returns the best member
with `fit: 'pinned' | 'role' | 'intents'`. When nobody in the variety matches a role word or carries at least
half of the preferred intents, it returns `character: null, fit: 'none'` — the mission stays **uncast**
rather than getting a wrong character (honesty rules). `castChapter()` casts a chapter in mission order so
the cast varies. The resolver never crosses a variety boundary and never depends on `@langquest/ui`
(`CastMember` is structural; `@langquest/db/seed/cast-roster` projects `CHARACTER_ROSTER` into it).

**Database / manifest.** `seed-curriculum --apply` writes one seed-owned `dialogue_scenarios` row per cast
mission (deterministic id `curriculumUuid('dialogue_scenario', '<chapter>:<mission>:cast')`, `character_id` =
the roster character's seeded uuid, `expected_intent_ids` = the blueprint objectives, published with the
mission) and records `{ preferred, fit, character, reasons }` in `missions.narrative_segment.casting`.
`buildManifest()` reads `characterIds` per mission from those rows, so `GET /v1/courses/:track/manifest`
lists the cast per mission; `seed-curriculum` verifies it (`cast=n/n`). `seed-curriculum --dry-run --cast`
prints who plays what. Cast seed: migration `140_seed_cast_v2.sql` (97 characters, regenerated by
`pnpm --filter @langquest/db seed:characters-sql`; `130` stays frozen history with the same 16 ids).

**Current coverage (2026-10-19, all 30 tracks, 203 missions):** 117 cast / 86 uncast. Darija chapter 1:
café → Nadia (café staff), directions and neighbour → Youssef (elder), greeting → Nadia, ice cream → Salma
(child); `market_ask_price` and `take_taxi` are uncast because the `ary` roster has no vendor and no taxi
driver yet. Uncast per blueprint: café 23/30, neighbour 21/28, taxi 24/30, market 15/28, ice cream 1/27
(arabic-msa has no child). Adding the missing roles to `roster/*.ts` (café staff, taxi driver, market vendor
and a neighbour per variety) fills them without any code change: re-run `seed:characters-sql`, apply the
migration and `seed-curriculum --apply`.
