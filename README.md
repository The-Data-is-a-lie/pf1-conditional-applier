# pf1-conditional-applier

A run-on-demand **FoundryVTT (pf1, v13) macro** that wires curated *conditionals* onto a
character's weapons — no dragging, no bulky palette import. Select a token (or pick a character
from a list), run the macro, and it scans the actor and attaches the relevant:

- **Path of War** maneuvers / damaging stances (actor items of type `pf1-pow.maneuver`)
- **Spheres of Power / Might** talents (actor items flagged `flags.pf1spheres.sphere`)
- **Spells** matched by name, all placed on the weapon:
  - **A** self-buffs (Bless, Divine Favor, True Strike) → `+attack`/`+damage` toggle
  - **B** touch-damage (Shocking Grasp, Scorching Ray) → toggle + the spell's own damage dice
  - **C** debuffs / area (Fireball, Hold Person) → toggle carrying the save + effect text

…to **every** weapon's attack action, then pops a **report of everything it couldn't match**
(the curation gap list).

## Use it

1. Open `apply-conditionals.macro.js`, copy its contents into a new **Script** macro in Foundry.
2. Select the token (or none → you'll get a character chooser).
3. Run the macro. Read the report. Delete the macro when done.

Data is fetched at runtime from this repo's `/data/*.json` (raw GitHub URLs) — no module install
needed. If you fork/rename the repo, update `DATA_BASE` at the top of the macro.

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

`build/` also keeps a copy of the LevelDB packer (`pack_pf1_leveldb.js`) and the old spell-item
compendium builder, in case a browsable class→level **reference pack** is wanted later.

## Related

Companion to the [Pathfinder 1E Randomized Character Generator](https://gitlab.com/pathfinder_1e_randomized_character_generator)
backend + the `pf1e_random_char_generator` Foundry module, whose generation-time
`addManeuverConditionals()` / `addSpellConditionals()` this macro reuses the shapes of.
