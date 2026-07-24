# Development

Author-time notes for the module itself. **Most of this only works on the author's machine:**
`npm run data` reads the backend repo and the generator module from hardcoded absolute paths
(`build/build_data.py`), and `./release.ps1` needs a `FOUNDRY_PACKAGE_TOKEN` in `.env` plus push
rights on the repo. `npm test` is the exception — it is self-contained and runs anywhere.

Nothing in this file, or in `build/`, ships in the zip.

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

## Commands

| Command | What it does |
|---|---|
| `npm test` | Drives the module's pure functions against a synthetic actor — no Foundry, no dependencies. Covers matching, the Unchained class-level retarget, melee/ranged defaults, adopt-if-verbatim, section order, re-run idempotency, and that `module.json` only points at files that exist. Run it after editing `scripts/apply-conditionals.js`. |
| `npm run data` | Rebuilds `data/` from the backend repo and the live generator module. |
| `npm run pack:macros` | Recompiles `packs/macros` from `build/macro-pack-source.json`. **Close Foundry first** — it holds a LevelDB lock on every pack it has open. |
| `./release.ps1 -Version X.Y.Z -DryRun` | Local rehearsal of a release: bumps the manifest, rolls the changelog, builds and validates the zip, touches nothing remote. Drop `-DryRun` to tag, push, cut a GitHub release and submit to the Foundry registry. |

## Releasing

`release.ps1` stages the zip from an explicit allowlist — `module.json`, `scripts/`, `styles/`,
`data/`, `packs/`, and the three doc files — so a new file elsewhere in the tree can never ship by
accident, and a shipped file that goes missing fails the build. It then asserts every runtime file
is present in the archive before going near the network.

The zip is published as a GitHub release asset, which is what `module.json`'s `download` points at.
`downloads/` is gitignored and never committed, so the repo does not grow by the size of the zip on
every release.
