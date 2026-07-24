Unreleased


- Initial release as a Foundry module. Previously a pasted script macro with a generated 1.2 MB data bundle; everything now ships inside the module and nothing is fetched from outside it.
- "Apply Conditionals" macro in the module's own compendium — drag it to the hotbar once; module updates change what it runs, so it never needs re-pasting.
- Per-weapon review dialog: pick a weapon (and action), see every conditional about to be added with an include checkbox, expand a row to edit its clauses or its per-roll default, then apply to that weapon or to every weapon and attack item at once.
- Sources scanned: active feats, weapon special abilities read off the weapon's description, curated class-feature toggles (rage powers, arcana, ki powers, rogue/ninja/slayer talents), Path of War maneuvers and damaging stances, Spheres of Power/Might talents, and spells (self-buffs, touch damage, and saves/area effects).
- Token substitution at attach time: combined spell caster level, spell level and casting mod, Spheres caster level and ability mods for non-Spheres actors, and maneuver initiating ability.
- Unchained class-level retarget: a curated `@classes.rogue.level` formula follows to `rogueUnchained` / `ninja` / `slayer` (and the barbarian, witch and monk equivalents) when that is where the actor's levels are; if nothing resolves, the conditional is reported as a curation gap rather than applied as a silent zero.
- Re-run safe: each run removes only the conditionals it previously added, tracked per weapon in `flags["pf1-conditional-applier"].condIds`, then re-scans — so it picks up newly-learned abilities, drops ones you no longer have, and never touches hand-authored conditionals.
- Per-weapon include/edit choices persist in an actor flag and are honoured on re-runs.
- Collapsible curation-gap list of everything that could not be matched.
- Public API on `game.modules.get("pf1-conditional-applier").api.apply()`.
