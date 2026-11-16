# Changelog

Entries are grouped under **Added**, **Changed** and **Fixed**. Each released version's section is
what appears on that version's GitHub release page and behind Foundry's release-notes link, so write
entries for the person using the module, not for the diff.

## Unreleased

## Version 1.4.0 (2026-11-16)

### Added

- **Every spell now has a conditional.** All 3,029 compendium spells are covered. Spells with an attack, damage or save get a full row (save DC, range, cost and effect, with caster-level scaling worked out for you), and attack spells roll their first damage dice automatically when Foundry's compendium has them. Every other spell (utility, defensive, healing…) gets a reminder row. A spell only shows as uncurated (†) now if it is a hand-made spell item.
- **Remove list.** ✕ on any row in the dialog takes that conditional off the whole character: the Conditionals item and every weapon it was applied to. It stays off on re-runs. Removed conditionals are listed at the bottom of the dialog and under Utility Functions on the sheet's Settings tab, each with a restore button. A new world setting, *Removed conditionals on the sheet*, hides the sheet list.
- **Spell switches**, remembered per player and per character:
  - **Only recommended spells** leaves out the reminder spells and keeps only spells with an attack, damage or save.
  - **Show full information** adds each spell's casting time, duration, area or targets, and school to its row.
- **Foldable sections.** ▾ on any section header (Feats, Path of War, Spells…) hides its rows to tidy the view. Folded rows are still applied. Your folded sections are remembered per player and per character.

### Changed

- **Full now means everything.** Uncurated (†) and passive rows sit in a *Not Recommended* section at the end of the list, on the Conditionals item only (never on a weapon), under a *NOT RECOMMENDED* divider at the bottom of each tab. Clear them with the section's All on/off, a row's checkbox, or ✕. This replaces the old *Curation gaps* list and the *UNCURATED* divider.
- Spell rows read `(Spell N) [Name]: …` and are ordered by spell level, then name, so the Spells tab reads like a spellbook. Choices saved for spell rows under the old names won't carry over.
- Attack spells roll only their first damage part. A secondary or alternative damage roll is described in the row text instead.
- Every section header shows how many rows it holds.

### Fixed

- Edits saved for a row whose name contains a dot (a formula like `@attributes.bab.total`, or "5 ft.") are no longer lost. Edits that were saved in the old, broken form are recovered the next time the dialog opens.
- Save spells no longer start with a stray save word ("Cone of Cold: half; …").
- Adding or removing a conditional on a weapon's Conditionals tab no longer jumps the action sheet back to the top.

## Version 1.3.0 (2026-11-15)

### Added

- **A "Conditionals" inventory item, kept up to date on every run.** The first time it runs on a character, the module creates a weapon called *Conditionals* in the inventory. Every later run brings it up to date. Each tab of its attack is one group: **Conditionals** (feats, class features, magic items), **Path of War** (sorted Boost → Stance → Strike → Counter, then by maneuver level), **SoP** (Spheres of Power and Might talents), **Counters** (every Counter maneuver and anything marked "(Counter)", copied from its own tab) and **Spells**. A tab only appears once it has something in it. If the character already has a hand-made *Conditionals* item, the module takes it over: every row you wrote yourself is kept, and where you already have a row for something (say "(Boost) Bronze Knuckle: …"), the module doesn't add a second one.
- **Bespoke / Full switch** in the dialog, remembered per character. Bespoke (the default) shows only curated conditionals, as before. Full also lists everything nobody has curated yet: feats, class features, talents, maneuvers and spells. Each appears as a text-only row marked **†** with its Benefit line, under an *UNCURATED* divider, on the Conditionals item and on weapons alike.
- **Trainers and professions are read.** Feats listed as headings inside a *Trainer: …* item's description (Street Style, Pummeling Style, …) and names listed in a *Profession Rank N: (Job) A, B, C* item's name are now found.
- Hand-written feat chains are understood: `Vital Strike<Improved<Greater` means Vital Strike, Improved Vital Strike and Greater Vital Strike, and `Cleave<Great<Finish<Improved` reads as Cleave, Great Cleave, Cleaving Finish and Improved Cleaving Finish. Spelling differences (`Blind Fight` / `Blind-Fight`, `&` / `and`) no longer stop a match.
- Path of War maneuvers stored as combat talents (`(Lvl 2 Maneuver) Bronze Knuckle - Boost`, `(Stance) Iron Hand Stance`) are recognised as maneuvers, whatever sphere they're filed under.
- New curated conditionals: the Barroom talents Interceding Crash, Surprise (with its attack bonus), Improvised Martial Arts, Focusing Break, Expanded Breaker and Bottle Rocket, plus the brawler's Awesome Blow and the snakebite striker's Snake Feint. Perfect Break, Brawler's Strike and Violent Ki are now recorded as passive abilities. They're no longer listed as curation gaps, and they show as reminder rows in Full mode.

### Changed

- Path of War and Spheres rows are named the way the table already writes them by hand: `(Boost) Name: …`, `(Strike) Name: …`, `(SoP) Name: …`. Include/edit choices you saved for those rows under the old names won't carry over.
- The dialog's selector now starts on the *Conditionals* item. Your real weapons follow underneath it, and **Apply** applies to whichever one is selected.

### Fixed

- A trait that shares its name with a class feature, such as the *Brawler* trait and the barbarian's Brawler rage power, no longer picks up the class feature's conditional.

## Version 1.2.0 (2026-08-13)

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
