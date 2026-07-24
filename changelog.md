# Changelog

Entries are grouped under **Added**, **Changed** and **Fixed**. Each released version's section is
what appears on that version's GitHub release page and behind Foundry's release-notes link, so write
entries for the person using the module, not for the diff.

## Unreleased

## Version 1.0.0 (2026-07-24)

### Added

- Initial release as a Foundry module. Previously a pasted script macro with a generated 1.2 MB data bundle; everything now ships inside the module and nothing is fetched from outside it.
- Four ways to run it, all opening the same review dialog: a **Conditionals** button in the actor sheet's title bar, an **Apply Conditionals** button under the sheet's Settings tab in Utility Functions, the "Apply Conditionals" macro in the module's own compendium (drag it to the hotbar once — module updates change what it runs, so it never needs re-pasting), and a keybinding, which ships with no default key and is assigned under Configure Controls.
- Per-weapon review dialog: pick a weapon (and action), see every conditional about to be added with an include checkbox, expand a row to edit its clauses or its per-roll default, then apply to that weapon or to every weapon and attack item at once.
- Sources scanned: active feats, weapon special abilities read off the weapon's description, magic-item activation text that targets an attack, curated class-feature toggles (rage powers, arcana, ki powers, rogue/ninja/slayer talents), Path of War maneuvers and damaging stances, Spheres of Power/Might talents, and spells (self-buffs, touch damage, and saves/area effects).
- **Sync item effects**: overlays each magic item's curated passive `changes` and `contextNotes` onto the item document itself. Bonuses the item already automates are skipped rather than stacked, and anything you wrote by hand is left alone.
- Token substitution at attach time: combined spell caster level, spell level and casting mod, Spheres caster level and ability mods for non-Spheres actors, and maneuver initiating ability.
- Unchained class-level retarget: a curated `@classes.rogue.level` formula follows to `rogueUnchained` / `ninja` / `slayer` (and the barbarian, witch and monk equivalents) when that is where the actor's levels are; if nothing resolves, the conditional is reported as a curation gap rather than applied as a silent zero.
- Re-run safe: each run removes only the conditionals it previously added, tracked per weapon in `flags["pf1-conditional-applier"].condIds`, then re-scans — so it picks up newly-learned abilities, drops ones you no longer have, and never touches hand-authored conditionals.
- Per-weapon include/edit choices persist in an actor flag and are honoured on re-runs.
- Collapsible curation-gap list of everything that could not be matched.
- World settings to show or hide each sheet button — "Button in the sheet header" and "Button in Utility Functions", both on by default, GM-controlled for the whole table.
- Public API on `game.modules.get("pf1-conditional-applier").api.apply()`.
