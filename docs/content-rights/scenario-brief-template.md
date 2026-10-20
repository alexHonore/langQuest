# Scenario brief template for human contributors

_Spec §9.7 (requirement R-9.7-02): "Provide scenario brief rather than source-language sentence-by-sentence
translations; ask for natural spontaneous turns, multiple phrasings, misunderstandings, pauses, real emotions,
regional social conventions, and short teaching variants." Written 2026-10-20._

A scenario brief describes a **situation**, not sentences. The contributor, a native speaker of the exact variety,
improvises what people really say there. Nobody hands them a list of lines to translate. This document has three
parts:

- §1–2: the rules and how a brief maps onto the curriculum model;
- §3: the blank template;
- §4–5: one filled example each for two varieties, **both illustrative drafts that need native review**.

Recording and delivery follow `docs/content-rights/recording-spec.md`. Review follows
`docs/content-rights/native-review-process.md`.

## 1. Rules for every brief

1. **No source sentences to translate.** The brief gives scene facts, roles, goals (communicative intents) and a
   twist. It never contains target-language lines, and never contains source-language lines "to say in X".
   Translation-style prompts produce textbook calques. The curriculum models what a learner _means_, not a sentence
   (`packages/curriculum/src/intents.ts`: "An intent is *what the learner means*, never a sentence").
2. **The scene is language-neutral.** Write it the way the blueprint's `sceneFacts` and `twist` are written
   (`SceneVariantSchema`, `packages/curriculum/src/missions/blueprint.ts`): facts the people in the scene would know.
3. **Ask for variety, not one right answer.** For every learner goal, ask for several natural phrasings (polite and
   casual, regional, feminine and plural forms) and one or two that a local would find wrong or rude. The same
   requirement is enforced on AI drafts: the fixture prompts ask for 3–5 acceptable and 1–2 unacceptable phrasings per
   intent, and the diversity gate (`scoreDialogueDiversity`, `packages/curriculum/src/diversity/metric.ts`) flags
   one-correct-answer sets.
4. **Real conversation shape.** 4–8 turns. Vary who opens. Let the learner ask questions. Two turns in a row by the
   same person are fine. Include at least one misunderstanding that gets repaired. These are the same constraints the
   content-factory dialogue prompt imposes (`buildFixturePrompts().dialogues`, `scripts/src/lib/content-factory.ts`).
5. **Real emotions and pauses.** Ask for at least one take where someone is hurried, amused, embarrassed, tired or
   warmly insistent. Keep hesitations and pauses: the pipeline never removes silence (recording spec §2).
6. **Regional social conventions** are part of the content: greetings and blessings, how to thank someone who
   served you, tu/vous and tú/usted/vosotros, whether bargaining is expected, small talk before business. The
   contributor writes these as notes in the instruction language.
7. **Code-switching only where locals really do it**, following the variety's `codeSwitchNorms`
   (`packages/contracts/src/catalog.ts`; for example Darija has "frequent natural French code-switching; teach it,
   never as excuse for wrong Arabic"). A code-switched line is a variant, never a replacement for the target-variety
   line.
8. **Never another variety.** The contributor speaks only the target variety and region. The optional confusion
   check (§3, part I) records what a neighbouring variety from the `mustNotSubstitute` list would say instead, so that
   reviewers and the app's guards can tell them apart.
9. **No personal data, brands or copyrighted material.** No real people's names (character names are given in the
   brief), no songs or quotes, no music playing in the room.

## 2. How a brief maps onto the curriculum model

| Brief section | Curriculum or content-factory field | Source |
|---|---|---|
| Track, variety, regional option | `course_track_id`, `targetVarietyId`, `regionalOptions[].id` | `packages/contracts/src/catalog.ts` |
| Instruction language for notes | `sourceLanguage` (`en`, `fr`, `es`, `ru`, …) | CONVENTIONS §2.2 |
| Mission blueprint, situation, level, type | `MissionBlueprint.key`, `situation` (`SITUATION_TAG_VALUES`), `level`, `missionType` | `packages/curriculum/src/missions/blueprint.ts`, `packages/curriculum/src/skills.ts` |
| Roles | `learnerRole`, `characterRole`, casting hints `preferredAgeBands`, `preferredRoles` | blueprint |
| Scene and twist | `sceneVariants[].sceneFacts`, `twist` | blueprint |
| Goals | `objectives[].intentKeys` and `slots[]` (`slotId`, `intentKey`, `speaker`, `register`) | blueprint; intent registry `INTENTS` (129 keys) |
| Phrases to avoid | `rejectIntentKeys` (for example `bare_command`) and each intent's `socialRisk` | blueprint, `intents.ts` |
| Repair moves | `REPAIR_INTENT_KEYS`: `ask_repeat`, `repeat_utterance`, `ask_slow_down`, `say_not_understood`, `ask_meaning_of_word`, `explain_meaning`, `ask_how_to_say`, `confirm_understood`, `check_comprehension`, `ask_if_speaks_language`, `say_speak_little`, `correct_self`, `ask_clarification` | `packages/curriculum` |
| Turn labels | `act`: `normal`, `unexpected`, `misunderstanding`, `repair` or `refusal` (`DIALOGUE_TURN_ACTS`); `intentKey` or null; `register`: `formal`, `polite`, `neutral`, `casual`, `intimate` or `slang` (`REGISTER_VALUES`) | `packages/curriculum/src/diversity/metric.ts`, `packages/contracts/src/enums.ts` |
| Delivery shape | Dialogues `{ title, context, twist, turns: [{ speaker, targetText, forms, meaning, act, intentKey }] }`. Phrasings `{ intentKey, acceptablePhrasings: [{ targetText, meaning, register }], unacceptable: [{ targetText, reason }] }`. Confusion test `{ contrastVarietyId, pairs: [{ meaning, thisVariety, contrastVariety, note }] }`. | `FixtureDialoguesLlmSchema` and `FixtureIntentsLlmSchema` (which includes `confusionTest`) in `scripts/src/lib/content-factory.ts` |

Using the content factory's shapes means human material can be scored by the same diversity metric and reviewed
with the same per-item `reviewed: false` / `verdict: null` fields. **Gap:** there is no ingestion tool for
contributor deliveries yet. Today a content editor enters them through the Studio, or as a JSONL draft next to the
content-factory drafts (`native-review-process.md` §4 and §6).

## 3. The template

Copy everything below the line into a new file, one per scenario:
`briefs/<track-id>/<blueprint-key>-<scene-id>.md`. Fill every `‹…›` and keep the section letters.

---

```markdown
# Scenario brief ‹track-id› / ‹blueprint-key› / ‹scene-id›

Status: DRAFT brief (not reviewed) · Brief author: ‹name› · Date: ‹yyyy-mm-dd› · Brief version: ‹n›

## A. Identity
- Track: ‹course_track_id›   Variety: ‹variety id›   Regional option: ‹id or "none"›
- Language of these notes (instruction language): ‹en | fr | es | ru | …›
- Blueprint: ‹key› · situation ‹situation tag› · level ‹beginner | elementary | …› · type ‹situational | story | …›
- Contributor(s): ‹speaker display names / pseudonyms, as registered in `speakers`›
- Rights row: ‹content_rights id› (signed terms uploaded; voice_rights ‹none | playback_only | synthesis_permitted›)

## B. The scene (facts everyone in the scene knows; no dialogue)
- Where and when: ‹…›
- Who is there, and how they feel today: ‹…›
- What is normal here (prices, timing, etiquette): ‹…›
- Twist (something that makes the talk go off-script): ‹…›

## C. Roles
- Learner role: ‹language-neutral role, e.g. "customer at a café"›
- Character: ‹name given by us›, ‹role›, ‹age band›, from ‹city/region›, personality ‹3–6 words›

## D. What has to happen (goals, not sentences)
| Goal | Who | Intent key(s) | Required? |
|---|---|---|---|
| ‹greet› | learner | ‹greet_hello› | yes |
| … | … | … | … |
Things a local would find inappropriate here: ‹rejectIntentKeys / social risks›

## E. Please record (improvise; do not read anything)
1. **Three run-throughs** of the whole scene, 4–8 turns each, each one different:
   - one where the learner opens, one where the character opens;
   - one with the twist from B;
   - at least one where a turn is misunderstood and repaired (ask to repeat, slow down, clarify).
2. **One take with a real emotion** (‹hurried | amused | embarrassed | tired | insistent›). Say which one.
3. **Alternative phrasings** for each learner goal in D: 3–5 that a local would accept (polite and casual,
   regional, feminine/plural forms) and 1–2 a local would NOT accept, with the reason.
4. **Short teaching variants** (optional, separate takes): the key learner lines said slowly and clearly once.

## F. Conventions to explain (written notes, in the instruction language)
- ‹greeting / thanking / politeness conventions in this scene›
- ‹what is rude or awkward here, and why›
- ‹natural code-switching, if any, and when it is NOT natural›

## G. Do not
- Do not translate from the notes language; do not use textbook or formal register unless the scene is formal.
- No real names, brands, songs or quotes; no music or TV in the room.
- No words from ‹the varieties in mustNotSubstitute›; say "I would not say that here" instead.

## H. Delivery (see recording-spec.md)
- One mono WAV/FLAC per speaker per take + a mono mix; transcript JSON v1 with S1/S2 labels.
- For every turn: `speaker`, `targetText`, `forms` (native script + required transliteration), `meaning`
  (instruction language), `act` (normal | unexpected | misunderstanding | repair | refusal), `intentKey` or null,
  `register`, emotion (free text).
- Phrasings in the `acceptablePhrasings` / `unacceptable` shape; every item `reviewed: false`, `verdict: null`.

## I. Optional confusion check
- Contrast variety: ‹first id in mustNotSubstitute›. 5 meanings from this scene and how each variety says them,
  with a note on what differs. Only if the contributor is genuinely fluent in both; otherwise leave empty.

## J. Review (filled by the native reviewer, not the contributor)
- Reviewer: ‹name›  Date: ‹…›  Accent/region correct? ‹y/n›  Natural? ‹y/n›  Culturally appropriate? ‹y/n›
- Back-translation agrees with `meaning`? ‹y/n›  Recording quality per recording-spec §10? ‹y/n›
- Verdict per item recorded in the delivery file; coverage sign-off happens in the Studio coverage editor.
```

---

## 4. Filled example 1: Moroccan Arabic (`ary`), notes in French

> **ILLUSTRATIVE DRAFT. Needs Moroccan native review before any use.** It was written from the repo's
> blueprint `cafe_order_drink` (scene `quiet_inside`) and from the AI-authored, unreviewed draft chapter
> `packages/curriculum/src/content/arabic-moroccan.ts`. No native speaker has checked any part of it, including the
> conventions in F. The brief deliberately contains no Darija lines.

```markdown
# Scenario brief arabic-moroccan / cafe_order_drink / quiet_inside

Status: DRAFT brief (not reviewed) · Brief author: LangQuest content team · Date: 2026-10-20 · Brief version: 1

## A. Identité
- Parcours : arabic-moroccan   Variété : ary   Option régionale : casablanca
- Langue de ces notes : fr
- Blueprint : cafe_order_drink · situation cafe · niveau beginner · type situational
- Contributeur(s) : ‹pseudonymes enregistrés dans `speakers`›
- Droits : ‹id content_rights› (voice_rights playback_only)

## B. La scène
- Où et quand : un café de quartier à Casablanca, en milieu de matinée, salle intérieure calme.
- Qui est là : le serveur, Youssef, a le temps ce matin et bavarde volontiers ; le client est nouveau dans le quartier.
- Ce qui est normal ici : on salue avant de commander ; le prix d'un café est connu de tous ; on paie en partant.
- Rebondissement : la première boisson demandée n'est plus disponible ; Youssef propose autre chose.

## C. Rôles
- Rôle de l'apprenant : client d'un café.
- Personnage : Youssef, serveur, adulte, de Casablanca, « rapide, joyeux, aime plaisanter » (fiche `ary_youssef_cafe`).

## D. Ce qui doit se passer (objectifs, pas des phrases)
| Objectif | Qui | Intention(s) | Obligatoire ? |
|---|---|---|---|
| saluer | apprenant | greet_hello / greet_time_of_day | oui |
| commander une boisson | apprenant | request_drink | oui |
| proposer un choix | personnage | offer_options | oui |
| dire que ce n'est plus disponible | personnage | say_unavailable | oui (rebondissement) |
| demander autre chose | apprenant | ask_alternative / choose_option | oui |
| demander l'addition, payer | apprenant | ask_for_bill / pay | oui |
| remercier | apprenant | thank | oui |
À éviter : un ordre sec sans formule de politesse (bare_command).

## E. À enregistrer (en improvisant)
1. Trois versions de la scène, 4 à 8 tours chacune : une où le client parle en premier, une où Youssef engage la
   conversation, une avec le rebondissement ; au moins une où le client ne comprend pas une réponse rapide et demande
   de répéter ou de parler plus lentement.
2. Une prise avec une vraie émotion : Youssef taquin et amusé quand le client hésite.
3. Pour chaque objectif de l'apprenant : 3 à 5 façons naturelles de le dire (poli, familier, au féminin) et 1 à 2
   façons qu'un Casablancais trouverait bizarres ou impolies, avec la raison.
4. Variantes pédagogiques (facultatif) : les phrases clés de l'apprenant, une fois lentement.

## F. Conventions à expliquer (notes en français)
- Comment on remercie quelqu'un qui vous a servi (formules de bénédiction ou simple « merci »), et quand chacune
  convient.
- Quand passer au français au café est naturel, et quand cela sonnerait comme un refus de parler darija.
- Tutoiement ou vouvoiement envers un serveur à Casablanca.

## G. À ne pas faire
- Ne pas traduire depuis le français ; ne pas utiliser l'arabe standard (arb) ni l'égyptien (arz) ni le levantin.
- Pas de vrais noms, de marques, de musique ou de télévision dans la pièce.

## H. Livraison
- Selon recording-spec.md ; transcription en écriture arabe + arabizi (forms), sens en français.

## I. Contrôle de confusion (facultatif)
- Variété de contraste : arb. Cinq sens de la scène, comment on les dit en darija et en arabe standard, et ce qui
  change. Seulement si le contributeur maîtrise vraiment les deux.

## J. Relecture (réservé au relecteur natif)
- ‹à remplir›
```

What a delivered learner-goal row looks like (format illustration only). The text below is copied from the
unreviewed AI draft `ary_cafe_order_drink` in `packages/curriculum/src/content/arabic-moroccan.ts`; it is **not**
native-reviewed:

```json
{ "intentKey": "request_drink",
  "acceptablePhrasings": [
    { "targetText": "عافاك، بغيت واحد القهوة", "meaning": "S'il vous plaît, je voudrais un café.", "register": "polite" }
  ],
  "unacceptable": [],
  "reviewed": false, "verdict": null }
```

## 5. Filled example 2: Castilian Spanish (`es-ES`), notes in English

> **ILLUSTRATIVE DRAFT. Needs Castilian native review before any use.** It was written from the repo's blueprint
> `market_ask_price` (scene `fruit_stall`) and the AI-authored, unreviewed draft
> `packages/curriculum/src/content/spanish-spain.ts` (scene note: "prices are per kilo and bargaining is unusual").
> The conventions in F are hypotheses for the reviewer to confirm or correct.

```markdown
# Scenario brief spanish-spain / market_ask_price / fruit_stall

Status: DRAFT brief (not reviewed) · Brief author: LangQuest content team · Date: 2026-10-20 · Brief version: 1

## A. Identity
- Track: spanish-spain   Variety: es-ES   Regional option: none (speakers.region: Madrid)
- Language of these notes: en
- Blueprint: market_ask_price · situation market · level beginner · type situational
- Contributor(s): ‹registered pseudonyms›
- Rights row: ‹content_rights id› (voice_rights playback_only)

## B. The scene
- Where and when: a fruit stall in a covered neighbourhood market in Madrid, Saturday morning, a short queue.
- Who is there: Paco, the stallholder, loud and proud of his produce; a regular customer waiting behind the learner.
- What is normal here: prices are per kilo and shown on small signs; customers wait their turn; haggling over fruit
  is unusual.
- Twist: Paco adds something extra for free ("for you, a gift") and expects a friendly reaction.

## C. Roles
- Learner role: shopper at a market stall.
- Character: Paco, market vendor, adult, from Madrid, "loud, generous, proud of his produce".

## D. What has to happen (goals, not sentences)
| Goal | Who | Intent key(s) | Required? |
|---|---|---|---|
| greet | learner | greet_hello | yes |
| ask the price | learner | ask_price | yes |
| state the price | character | state_price | yes |
| react to the price | learner | say_too_expensive / offer_lower_price / ask_last_price | no |
| say how much you want | learner | specify_quantity | yes |
| decide | learner | agree_to_price / decline_purchase / say_just_looking | yes |
| react to the free extra | learner | thank / compliment | yes (twist) |
Inappropriate here: a bare command ("give me…") with no softener (bare_command); hard bargaining over fruit.

## E. Please record (improvise; do not read anything)
1. Three run-throughs, 4–8 turns each: one where the learner opens, one where Paco calls out first ("who's next?"),
   one with the twist; at least one where the learner misunderstands the price or the unit (per kilo vs per piece)
   and it gets cleared up.
2. One take with a real emotion: the learner slightly embarrassed after asking for a discount that is not customary;
   Paco amused, not offended.
3. For each learner goal: 3–5 natural phrasings (neutral, casual, with and without "por favor"; tú and usted where
   both occur) and 1–2 a Madrid stallholder would find odd or rude, with the reason.
4. Teaching variants (optional): the price question and the quantity line, once slowly.

## F. Conventions to explain (English notes)
- How the queue works at a market stall and how you signal it is your turn.
- Whether asking for a discount on fruit is acceptable, and how to joke about a price instead.
- tú vs usted with a stallholder of your parents' age; how "vale" is used.

## G. Do not
- Do not translate from English; no Latin American forms (es-419): Castilian vocabulary, vosotros and distinción only.
- No real names, brands, music or radio in the room.

## H. Delivery
- Per recording-spec.md; forms are Latin script only (no transliteration); meaning in English.

## I. Optional confusion check
- Contrast variety: es-419. Five meanings from this scene (e.g. "OK", "how much is it", "a kilo of…",
  "you (plural)") said the Castilian way and a common Latin American way, with what differs.

## J. Review (native reviewer only)
- ‹to fill›
```

## 6. Cross-references

- Recording, levels, file format, transcripts, consent fields: `docs/content-rights/recording-spec.md`.
- Review states and sign-off: `docs/content-rights/native-review-process.md` §2–5.
- AI drafts that follow the same rules: `scripts/src/lib/content-factory.ts` (`buildMissionPrompt`,
  `buildFixturePrompts`), with the diversity gate in `packages/curriculum/src/diversity/metric.ts`.
