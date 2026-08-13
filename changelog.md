# Changelog

Entries are grouped under **Added**, **Changed** and **Fixed**. Each released version's section is
what appears on that version's GitHub release page and behind Foundry's release-notes link, so write
entries for the person using the module, not for the diff.

## Unreleased

### Added

- 57 new feat conditionals (496 → 553), each verified against d20pfsrd, filling the families the style-feat expansion left open:
  - **Critical feats** — Critical Focus as a real +4 to critical confirmation rolls; Bleeding/Blinding/Deafening/Sickening/Staggering/Stunning/Tiring/Exhausting Critical, Critical Mastery and Critical Versatility as reminder rows carrying their save DCs.
  - **Teamwork feats** — Precise Strike (+1d6 while flanking with the ally), Gang Up, Paired Opportunists, Coordinated Charge, Coordinated Shot, Enfilading Fire, Distracting Charge, Target of Opportunity, Seize the Moment and Wounded Paw Gambit — each row names its ally requirement, and all arrive unchecked at roll time.
  - **Debuff-on-hit and ranged support** — Cornugon Smash, Dreadful Carnage, Shatter Defenses, Dazzling Display, Clustered Shots, Snap Shot, Improved Snap Shot, Point-Blank Master and Pinpoint Targeting.
  - **Mobility, mounted and unarmed** — Lunge, Cleave, Great Cleave, Cleaving Finish, Spring Attack, Mounted Combat, Unseat, Mounted Skirmisher, Wheeling Charge, Trick Riding, Stunning Fist (with its Fortitude DC) and Double Slice.
  - **Mythic feats** — fifteen combat-relevant mythic feats (Mythic Power Attack, Mythic Deadly Aim, Mythic Vital Strike, Mythic Improved Critical, Mythic Manyshot, and more), each modeling only the delta on top of its base feat's row so the two toggles stack correctly.
- **Compact header buttons**, a world setting (on by default): every window title-bar button collapses to just its icon, with the name shown on hover — so the close X stays visible at any sheet size, no matter how many modules add their own header buttons. Covers every classic-style window (character sheets, item sheets, journals, dialogs), not just this module's own button. Turn it off in module settings to get the labels back.

## Version 1.1.0 (2026-08-12)

### Added

- Feat coverage more than doubles, from 238 to 496 conditionals. Every PF1 style feat now has a row: all 88 style chains (Overwatch, Startoss, Jabbing, Kirin, Pummeling, Snake, Panther, and the rest — 242 feats, each verified against d20pfsrd), including the missing members of chains that were only partly covered before (Crane Wing, Janni Style, Mantis Style, Snapping Turtle Style, Djinni Style, and more).
- Vital Strike, Improved Vital Strike and Greater Vital Strike roll your weapon's own damage dice: a new `as-weapon-dice` placeholder is resolved against the weapon at apply time, the same way `as-weapon` damage types already are, and the extra dice correctly don't multiply on a crit.
- New core-feat rows: Point-Blank Shot and Arcane Strike with real modifiers; Precise Shot, Improved Precise Shot, Far Shot, Sap Adept, Sap Master, Deadly Stroke, Dirty Fighting, Spirited Charge, Ride-By Attack, Charge Through and Rhino Charge as reminder rows.
- Feats whose effect can't be expressed as an attack or damage modifier (AC, combat-maneuver, save-DC or action-economy effects, and multipliers like Spirited Charge) appear as reminder-only checkboxes — the row shows what the feat does at the moment you roll, without changing the numbers.

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
