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

## Related

Companion to the [Pathfinder 1E Randomized Character Generator](https://gitlab.com/pathfinder_1e_randomized_character_generator)
backend + the `pf1e_random_char_generator` Foundry module, whose generation-time
`addManeuverConditionals()` / `addSpellConditionals()` this module reuses the shapes of.

---

Developing this module? See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).
