# LangQuest · art-direction explorations

Owner review set for the visual identity of LangQuest: five mascots, four character art styles and four UI
directions, each a genuinely different declination rather than a palette swap of the current baseline
(the orbit-creature with a teal body and orange ribbon tail documented in `docs/mascot-style-guide.md`).

**Open `index.html` in a browser** (from this folder, so relative paths resolve). It shows every option with its
model sheet or style sheet, states / expressions, dark variants, light + dark phone mockups, a comparison matrix
and three suggested combinations.

## How to approve

Reply with one code of each kind, for example **`M3 + C2 + U4`**.

- **M1–M5** mascot
- **C1–C4** character art style (applies to all 30 course casts and their scenes)
- **U1–U4** UI direction (tokens, components, motion plan)

Notes such as "M2 but with smaller fins" or "U3 with U2's dark mode" are welcome; the next step is to turn the
approved trio into a production style guide (replacing `docs/mascot-style-guide.md` and §10.2A/B of
`docs/MASTER_SPEC.md`), regenerate `packages/ui/src/art/*` from the approved generators, and re-run the mascot
pipeline (`scripts/mascot/*`) for all 17 contract states plus Rive/Lottie exports. Nothing in this folder is
wired into the app; it only exists for this decision.

## The options at a glance

| Code | Name | One line |
| --- | --- | --- |
| **M1** | Ollo — refined orbit-creature | The baseline silhouette kept exactly, everything inside it rebuilt (two line weights, filled twisted ribbon tail, iris-ring eyes, 5 brows, 8 mouths, 10 arm gestures, hover shadow). Lowest risk, least distinct. |
| **M2** | Glim — lantern-spirit | Translucent shell with rim, cap and loop; a warm light drop whose level is the mood; petal fin-ears for listening; a spark trailing lower-left; no limbs. Strongest in dark mode; fins need a silhouette pass so they never read as wings. |
| **M3** | Melo — chubby chameleon | Pear body, eyes on turrets that swivel independently, saffron crest, spiral tail used as a gesture limb, body hue drifts per course family. Richest motion kit; some reptile / frog risk. |
| **M4** | Nimbo — cloud-blob traveller | Grounded cloud on stubby legs with a knitted cranberry scarf as the tail; emotion is weather (puffs, one raindrop, sun peek, speech-puffs). Charming and universal; cute clouds are a crowded genre. |
| **M5** | Plio — folded-paper guide | Six-sided indigo paper pod, cream face window, visor flap as the brow, tangerine paper-plane dart that points at the next action. Most distinct silhouette, cheapest geometry, coolest temperament. |
| **C1** | Cut paper, warm light | Geometric flat, no outlines, one flat shade per material, solid eyes with one highlight. Cheapest and most scalable; risks looking generic. |
| **C2** | Soft dimensional | Clay / plush figures with warm key light, cool rim light, specular and contact shadows, no outlines. Premium and tactile; heaviest to render, weakest at 24 px. |
| **C3** | Ink & Fill ("Carnet") | Variable-width ink ribbons, misregistered flat fills, one hard shadow, warm paper. Most original and adult; heaviest files, needs icon regeneration. |
| **C4** | Bold Minimal | Poster cut-outs: two-tone faces, ink-only features, one bold hair silhouette, one gradient per figure (the backing disc). Most legible at small sizes; can go corporate. |
| **U1** | Warm Editorial | Cream paper, deep teal as the only actionable colour, coral for warmth, serif display lines, soft ink-tinted elevation. Refined baseline, superb contrast, calm. |
| **U2** | Night Market | Dark-first indigo canvas, three blurred lantern accents behind glass cards, glow rationed to the speech state and the one primary action. Most striking; blur cost and a weaker light theme. |
| **U3** | Paper & Ink | Warm paper, one ink, one cobalt accent, hand-drawn underlines, stamps, tape and a pen-circled mic; real night-paper dark mode. Cannot be mistaken for a competitor; deliberately little motion. |
| **U4** | Soft Clay | Pastel clay tiles with inner highlight / shadow edges, spring presses, pastel roles (peach = speak, mint = progress, lilac = review, butter = mascot, sky = audio), one deep coral for the mic. Cozy and game-ish; inset shadows need custom RN work. |

The gallery's matrix scores each option 1–5 on originality, legibility at 24 px, production cost for 30 courses,
cultural safety and animation potential, with a one-line reason per row. The three suggested combinations are
**A · the journal (M5 + C3 + U3)**, **B · the warm evolution (M1 + C1 + U1)** and
**C · the night market (M2 + C4 + U2)**.

## Folder map

```
design/explorations/
├── index.html                 the review gallery (self-contained HTML, inline CSS, system fonts)
├── README.md                  this file
├── mascots/
│   └── M1 … M5/               README.md · model-sheet.svg · icon-24.svg · dark-variant.svg · palette.svg · states/{neutral,welcome,listening,speaking,thinking,celebrate,try_again,offline}.svg
│                              (M1, M3 also ship their Node generator; everything is regenerable)
├── characters/
│   └── C1 … C4/               README.md · style-sheet.svg · scene-cafe.svg (640×360) · portraits/{nadia,kenji,lucia}-{neutral,greeting,talking,listening}.svg (256×256)
│                              (C1, C3 ship a Python generator; C4 a Node generator and a preview grid)
└── ui/
    └── U1 … U4/               README.md · tokens.html · home / lesson / conversation .html (+ -dark variants, 390×844); U4 adds conversation-reconnecting(-dark).html
                               (U1, U3 ship build.py)
```

Each option's README carries the full concept, personality, strengths, risks, scaling rules, Rive / Lottie
animation ideas (mascots), pairing notes with the mascots and a 30-course production estimate (characters), or
accessibility notes and the motion plan (UI).

## How the gallery embeds the mockups

The mockup pages wrap their 390×844 phone in a padded stage (a caption, a side sheet with the "after you speak"
card, a second reduced phone for the reconnecting state, a speech-state gallery). A literal 390 px iframe crops
the phone, so the gallery uses a 500×960 stage scaled to 44 %, which contains the primary phone on every page of
all four directions (verified by rendering each page headlessly). Secondary content is cropped in the thumbnail;
the **open** link under each phone shows the whole page.

## Rules and checks

- Everything drawn for the mascots and characters is original vector work generated in code. No owls or birds,
  no resemblance to any existing mascot or brand, no flags, no national or ethnic caricature, no real-person
  likeness, contemporary clothing only, no baked-in text in artwork (only `<title>` for assistive tech; labels
  appear only on model / style / palette sheets, in system fonts).
- No CC0 or third-party assets (Open Peeps, Open Doodles, unDraw) were used in any folder, including as
  decoration in the UI mockups; the mockups inline the repository's current baseline assets as placeholders.
- Every SVG validates as standalone XML with `xmlns` and `viewBox`, has no external references and is under
  200 KB. Every HTML file is self-contained with system fonts only. Every path referenced from `index.html`
  was verified to exist when the gallery was built.
- Open points to settle after approval: trademark search on the chosen working name; silhouette pass on M2's
  fins if M2 is chosen; native cultural review of mockup copy (the Darija, Cantonese and Spanish lines are
  plausible placeholders, not reviewed content).
