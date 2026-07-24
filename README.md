# PF1 Conditional Applier

A **FoundryVTT** module for the **Pathfinder 1e** system that wires curated *conditionals* onto a
character's weapons — the attack toggles for feats, weapon special abilities, magic items, class
features, Path of War maneuvers, Spheres talents and spells that are otherwise a long manual slog,
per weapon, per character.

Run it, review what it found in a per-weapon dialog, apply. Re-runnable: it only ever replaces what
it added. Everything it reads ships inside the module — it makes no network requests.

## Install

Foundry → **Add-on Modules** → **Install Module**, and paste the manifest URL:

```
https://raw.githubusercontent.com/The-Data-is-a-lie/pf1-conditional-applier/main/module.json
```

Then enable **PF1 Conditional Applier** in your world's module settings.

## Use it

Start it whichever way suits you — all four open the same review dialog:

- **Conditionals** in the actor sheet's title bar — acts on that character.
- **Apply Conditionals** at the bottom of the sheet's **Settings** tab, under Utility Functions —
  same.
- The **Apply Conditionals** macro in the module's compendium. Drag it onto your hotbar once: it's a
  one-liner that calls into the module, so updating the module updates what it runs — nothing to
  re-drag or re-paste. Uses your selected token, or asks which character.
- A **keybinding**, if you assign one. It ships with *no default key* so it can't collide with
  anything — set one under **Configure Controls**. Behaves like the macro.

The sheet buttons only appear on characters you own. From your own code or another macro:
`game.modules.get("pf1-conditional-applier").api.apply()`.

**Re-running is safe.** Each run first removes only the conditionals it added last time (tracked per
weapon in `flags["pf1-conditional-applier"].condIds`), then re-scans — so it picks up newly-learned
maneuvers, talents and spells, drops ones you no longer have, and never touches conditionals you
wrote by hand. Your include/edit choices persist per weapon and are honoured on later runs.

## What it finds

It scans the actor and gathers the relevant:

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

## The review dialog

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
action (Power Attack on a bow) arrive unchecked rather than hidden. A collapsible **curation-gap
list** (everything it couldn't match) sits at the bottom.

**Sync item effects** (the fourth button, shown when there is anything to do) is the one action that
does not touch a weapon: it overlays each magic item's curated passive `changes` and `contextNotes`
onto the item document itself. Bonuses the item already automates are skipped rather than stacked,
and anything you wrote by hand is left alone.

## Settings

Two world-scoped settings (so the GM decides for the whole table) control where the sheet button
appears. Both are on by default, and turning one off clears the button from open sheets immediately.

| Setting | Effect |
|---|---|
| **Button in the sheet header** | Show a **Conditionals** button in the actor sheet's title bar. |
| **Button in Utility Functions** | Show an **Apply Conditionals** button at the bottom of the sheet's Settings tab, under Utility Functions. |

## Related

Companion to the [Pathfinder 1E Randomized Character Generator](https://gitlab.com/pathfinder_1e_randomized_character_generator)
backend + the `pf1e_random_char_generator` Foundry module, whose generation-time
`addManeuverConditionals()` / `addSpellConditionals()` this module reuses the shapes of.

---

Developing this module? See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).
