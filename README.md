# pf1-conditional-applier

A **FoundryVTT (pf1, v13) module** that wires curated *conditionals* onto a character's weapons — no
dragging, no bulky palette import. Select a token (or pick a character from a list), run the module's
macro, and it scans the actor and gathers the relevant:

- **Feats** — active-feat toggles (Power Attack, Deadly Aim, Combat Expertise) matched by name,
  including feats folded into a generated character's chain names (`… > Charging Hurler > …`)
- **Weapon special abilities** — Flaming, Keen, … read off the selected weapon's own description
- **Magic items** — activation text that targets an attack becomes a `(Item Name): …` toggle
- **Class features** — rage powers, magus arcana, ki powers, rogue/ninja/slayer talents
- **Path of War** maneuvers / damaging stances (actor items of type `pf1-pow.maneuver`)
- **Spheres of Power / Might** talents (actor items flagged `flags.pf1spheres.sphere`)
- **Spells** matched by name:
  - **A** self-buffs (Bless, Divine Favor, True Strike) → `+attack`/`+damage` toggle
  - **B** touch-damage (Shocking Grasp, Scorching Ray) → toggle + the spell's own damage dice
  - **C** debuffs / area (Fireball, Hold Person) → toggle carrying the save + effect text

Each conditional's rider spells out the **six details** — damage, save DC/type, range, aux effects,
activation, and cost — as labeled `Cost:`/`Activation:`/`Range:`/`Save:`/`Effect:` clauses.

Everything it reads ships inside the module: it makes no network requests.

### Per-weapon review pop-up

Instead of blindly applying to every weapon, it opens a **dialog**:

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

**Sync item effects** (the fourth button, shown when there is anything to do) is the one action that
does not touch a weapon: it overlays each magic item's curated passive `changes` and `contextNotes`
onto the item document itself. Bonuses the item already automates are skipped rather than stacked,
and anything you wrote by hand is left alone.

## Install

Foundry → **Add-on Modules** → **Install Module**, and paste the manifest URL:

```
https://raw.githubusercontent.com/The-Data-is-a-lie/pf1-conditional-applier/main/module.json
```

Then enable **PF1 Conditional Applier** in your world's module settings.

## Use it

1. Open the **Compendium Packs** sidebar → **Conditional Applier** → drag **Apply Conditionals**
   onto your hotbar. Do this once: the macro is a one-liner that calls into the module, so updating
   the module updates what it runs — nothing to re-drag or re-paste.
2. Select the token you want to sync (or select nothing and pick the character from a list).
3. Click the macro, review, apply.

From your own code or another macro: `game.modules.get("pf1-conditional-applier").api.apply()`.

## Re-run safety

Every conditional the module adds is tracked in a per-weapon flag
(`flags["pf1-conditional-applier"].condIds`). Each run first **removes the ones it previously
added**, then re-scans and re-adds — so it:

- **picks up** newly-learned maneuvers / talents / spells,
- **drops** ones you no longer have,
- **never touches** conditionals you authored by hand.

So it's a safe, repeatable *sync* button.

## Data (`/data`)

Frozen snapshots the module fetches from its own directory at run time. Refresh with
`C:\Python310\python.exe build/build_data.py` (pulls from the backend repo + the live Foundry
module and rebuilds the slim damage index) — an author-time step; the committed snapshots are what
ship:

| File | Source | Purpose |
|---|---|---|
| `spell_riders.json` | backend `Backend/json/spells/` | Bucket B/C: save + rider text |
| `spell_changes.json` | backend `Backend/json/spells/` | Bucket A: self-buff toggles |
| `maneuver_changes.json` | Foundry module | PoW maneuver modifiers + riders |
| `combat_talent_conditionals.json` | Foundry module | Spheres of Might talents |
| `magic_talent_conditionals.json` | Foundry module | Spheres of Power talents |
| `spell_damage_index.json` | derived from module `every_spell.json` | `{nameLower: [[formula,[types]],…]}` for Bucket B dice |
| `feat_conditionals.json` | backend `Backend/json/feats/` | Active-feat toggles (238) |
| `weapon_quality_conditionals.json` | derived from backend `items/quality_effects.json` | Weapon special abilities (197), conditionals only |
| `class_feature_conditionals.json` | derived from backend `class_data/effects/` | Curated class-feature toggles (297); `"review": true` drafts skipped |
| `item_changes.json` | backend `items/item_changes.json` + its overrides | Magic items (883): `contextNotes` targeting *attack* become weapon toggles, the rest overlays the item |

`DATA_FILES` in `scripts/apply-conditionals.js` is the source of truth for what must be present;
`npm test` fails if the manifest, that list, and `data/` ever drift apart.

## Development

| Command | What it does |
|---|---|
| `npm test` | Drives the module's pure functions against a synthetic actor — no Foundry, no dependencies. Covers matching, the Unchained class-level retarget, melee/ranged defaults, adopt-if-verbatim, section order, re-run idempotency, and that `module.json` only points at files that exist. Run it after editing `scripts/apply-conditionals.js`. |
| `npm run data` | Rebuilds `data/` from the backend repo and the live generator module. |
| `npm run pack:macros` | Recompiles `packs/macros` from `build/macro-pack-source.json`. **Close Foundry first** — it holds a LevelDB lock on every pack it has open. |
| `./release.ps1 -Version X.Y.Z -DryRun` | Local rehearsal of a release: bumps the manifest, rolls the changelog, builds and validates the zip, touches nothing remote. Drop `-DryRun` to tag, push, cut a GitHub release and submit to the Foundry registry. |

`build/` also keeps a copy of the LevelDB item packer (`pack_pf1_leveldb.js`) and the old spell-item
compendium builder, in case a browsable class→level **reference pack** is wanted later. Nothing in
`build/` ships in the zip.

## Related

Companion to the [Pathfinder 1E Randomized Character Generator](https://gitlab.com/pathfinder_1e_randomized_character_generator)
backend + the `pf1e_random_char_generator` Foundry module, whose generation-time
`addManeuverConditionals()` / `addSpellConditionals()` this module reuses the shapes of.
