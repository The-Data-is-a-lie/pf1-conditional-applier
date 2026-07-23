# pf1-conditional-applier

A run-on-demand **FoundryVTT (pf1, v13) macro** that wires curated *conditionals* onto a
character's weapons — no dragging, no bulky palette import. Select a token (or pick a character
from a list), run the macro, and it scans the actor and gathers the relevant:

- **Feats** — active-feat toggles (Power Attack, Deadly Aim, Combat Expertise) matched by name
- **Weapon special abilities** — Flaming, Keen, … read off the selected weapon's own description
- **Class features** — rage powers, magus arcana, ki powers, rogue/ninja/slayer talents
- **Path of War** maneuvers / damaging stances (actor items of type `pf1-pow.maneuver`)
- **Spheres of Power / Might** talents (actor items flagged `flags.pf1spheres.sphere`)
- **Spells** matched by name:
  - **A** self-buffs (Bless, Divine Favor, True Strike) → `+attack`/`+damage` toggle
  - **B** touch-damage (Shocking Grasp, Scorching Ray) → toggle + the spell's own damage dice
  - **C** debuffs / area (Fireball, Hold Person) → toggle carrying the save + effect text

Each conditional's rider spells out the **six details** — damage, save DC/type, range, aux effects,
activation, and cost — as labeled `Cost:`/`Activation:`/`Range:`/`Save:`/`Effect:` clauses.

### Per-weapon review pop-up

Instead of blindly applying to every weapon, the macro opens a **dialog**:

1. **Pick a weapon** (and, when it has more than one action, which action).
2. See the **full list of conditionals** about to be added — each with an **include** checkbox
   (checked by default; uncheck to skip it) and an expandable row to **edit its clauses** or its
   per-roll default.
3. **Apply to this weapon.** The dialog stays open, so switch the weapon dropdown and repeat — or
   **Apply to all weapons** to do every weapon and attack item in one pass, each with the qualities
   detected on *that* item and its own saved choices.

The generator only ever wires its main weapon, so the rollable attack twin and any backup weapon
start empty — this is what fills them in. Rows whose melee/ranged wording contradicts the selected
action (Power Attack on a bow) arrive unchecked rather than hidden.

Your toggles and edits **persist per weapon** (in a `flags["pf1-conditional-applier"].overrides`
actor flag), so a later re-run honors them. A collapsible **curation-gap list** (everything it
couldn't match) sits at the bottom of the dialog.

## Use it

**Recommended — the loader macro (paste once, auto-updates):**

1. Copy `src/load-latest.macro.js` into a new **Script** macro in Foundry, once.
2. Select the token (or none → you'll get a character chooser) and run it.

The loader fetches the bundle from the FoundryVTT user Data dir, which
`C:\Python310\python.exe build/bundle_macro.py` writes on **every** build (alongside the repo copy) —
so a data refresh or macro edit takes effect on the next run with nothing to re-paste. The deploy
path is `<Foundry user data>/Data/pf1-conditional-applier/apply-conditionals.bundled.js`; override it
with the `PF1CA_DEPLOY` environment variable, and the bundler simply notes and skips it when the
folder doesn't exist. That folder is a plain deploy target — not a git checkout.

**Or paste the bundle directly** — `apply-conditionals.bundled.js` is self-contained (data embedded,
no network). Same steps, but you re-paste it every time it is rebuilt.

Either way: no module install, no GitHub access needed. Delete the macro when done.

### Source vs bundle

- `src/load-latest.macro.js` — the paste-once loader that runs whatever the bundler last deployed.
- `apply-conditionals.bundled.js` — **the generated, self-contained macro** (data inlined); written to
  the repo root and to the Foundry deploy path on every build.
- `src/apply-conditionals.macro.js` — the editable source. It can also fetch `/data/*.json` from raw
  GitHub instead of embedding, but that needs the repo **public** (`DATA_BASE` at the top of the
  file). Edit logic here, then re-run the bundler.

## Re-run safety

Every conditional the macro adds is tracked in a per-weapon flag
(`flags["pf1-conditional-applier"].condIds`). Each run first **removes the ones it previously
added**, then re-scans and re-adds — so it:

- **picks up** newly-learned maneuvers / talents / spells,
- **drops** ones you no longer have,
- **never touches** conditionals you authored by hand.

So it's a safe, repeatable *sync* button.

## Data (`/data`)

Frozen snapshots the macro reads. Refresh with `C:\Python310\python.exe build/build_data.py`
(pulls from the backend repo + the live Foundry module and rebuilds the slim damage index):

| File | Source | Purpose |
|---|---|---|
| `spell_riders.json` | backend `Backend/json/spells/` | Bucket B/C: save + rider text |
| `spell_changes.json` | backend `Backend/json/spells/` | Bucket A: self-buff toggles |
| `maneuver_changes.json` | Foundry module | PoW maneuver modifiers + riders |
| `combat_talent_conditionals.json` | Foundry module | Spheres of Might talents |
| `magic_talent_conditionals.json` | Foundry module | Spheres of Power talents |
| `spell_damage_index.json` | derived from module `every_spell.json` | `{nameLower: [[formula,[types]],…]}` for Bucket B dice |
| `feat_conditionals.json` | backend `Backend/json/feats/` | Active-feat toggles (54) |
| `weapon_quality_conditionals.json` | derived from backend `items/quality_effects.json` | Weapon special abilities (197), conditionals only |
| `class_feature_conditionals.json` | derived from backend `class_data/effects/` | Curated class-feature toggles (17); `"review": true` drafts skipped |

## Checks

`node build/verify_specs.mjs` drives the macro's pure functions against a synthetic actor — no
Foundry, no dependencies. It covers matching, the Unchained class-level retarget, melee/ranged
defaults, adopt-if-verbatim, section order and re-run idempotency. Run it after editing the macro.

`build/` also keeps a copy of the LevelDB packer (`pack_pf1_leveldb.js`) and the old spell-item
compendium builder, in case a browsable class→level **reference pack** is wanted later.

## Related

Companion to the [Pathfinder 1E Randomized Character Generator](https://gitlab.com/pathfinder_1e_randomized_character_generator)
backend + the `pf1e_random_char_generator` Foundry module, whose generation-time
`addManeuverConditionals()` / `addSpellConditionals()` this macro reuses the shapes of.
