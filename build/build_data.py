"""Refresh the /data files the module loads at runtime.

Author-time only: the sources below live outside the module, but their frozen snapshots in ../data
are committed and ship in the zip, so nothing at runtime depends on them.

Copies the curated conditional dicts out of the backend + the live Foundry module into ../data,
and derives a SLIM spell-damage index from the module's 11 MB every_spell.json (Bucket-B touch
spells need their own dice as damage modifiers). Run whenever the source dicts change:

    C:\\Python310\\python.exe build/build_data.py

Sources (frozen snapshot -> ../data):
  backend  Backend/json/spells/spell_riders.json      (Bucket B/C: save + rider text)
  backend  Backend/json/spells/spell_changes.json     (Bucket A: self-buff toggles)
  backend  Backend/json/feats/feat_conditionals.json  (active-feat toggles)
  module   maneuver_changes.json  (damaging stances come through here too)
  module   combat_talent_conditionals.json / magic_talent_conditionals.json
  module   every_spell.json  ->  spell_damage_index.json  ({nameLower: [[formula,[types]],...]})
  backend  items/quality_effects.json  ->  weapon_quality_conditionals.json  ({quality: [cond,...]})
  backend  class_data/effects/class_feature_effects.json
             ->  class_feature_conditionals.json  ({section: {powerKey: [cond,...]}})
  backend  items/item_changes.json + item_changes_overrides.json
             ->  item_changes.json  ({itemNameLower: {changes, contextNotes}})
"""
import json
import shutil
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATA = HERE.parent / "data"
BACKEND = Path(r"C:\Users\Daniel\Documents\GitHub\Pathfinder_Char_Creator")
MODULE_CS = Path(
    r"C:\Users\Daniel\AppData\Local\FoundryVTT\Data\modules\pf1e_random_char_generator"
    r"\templates\character_sheet_folder")

# (source path, destination filename) — straight copies.
COPIES = [
    (BACKEND / "Backend" / "json" / "spells" / "spell_riders.json", "spell_riders.json"),
    (BACKEND / "Backend" / "json" / "spells" / "spell_changes.json", "spell_changes.json"),
    (BACKEND / "Backend" / "json" / "feats" / "feat_conditionals.json", "feat_conditionals.json"),
    # No stance_changes.json: buildSpecs() reads stances out of maneuver_changes (a stance with no
    # modifiers belongs on a buff, not a weapon), so copying it only bloated the shipped zip.
    (MODULE_CS / "maneuver_changes.json", "maneuver_changes.json"),
    (MODULE_CS / "combat_talent_conditionals.json", "combat_talent_conditionals.json"),
    (MODULE_CS / "magic_talent_conditionals.json", "magic_talent_conditionals.json"),
]
EVERY_SPELL = MODULE_CS / "every_spell.json"
DAMAGE_INDEX = DATA / "spell_damage_index.json"
QUALITY_EFFECTS = BACKEND / "Backend" / "json" / "items" / "quality_effects.json"
QUALITY_INDEX = DATA / "weapon_quality_conditionals.json"
CLASS_FEATURE_EFFECTS = (BACKEND / "Backend" / "json" / "class_data" / "effects"
                         / "class_feature_effects.json")
CLASS_FEATURE_INDEX = DATA / "class_feature_conditionals.json"
ITEM_CHANGES = BACKEND / "Backend" / "json" / "items" / "item_changes.json"
ITEM_CHANGES_OVERRIDES = BACKEND / "Backend" / "json" / "items" / "item_changes_overrides.json"
ITEM_INDEX = DATA / "item_changes.json"


def spell_damage_parts(src):
    """[(formula, [damageType,...]), ...] across a compendium spell's actions, deduped by formula.
    Handles pf1 v11 {formula, type:{values:[...]}}, plus older list / 'types' shapes. Port of
    build_pow_template_actor.py:_spell_damage_parts."""
    out, seen = [], set()
    for act in ((src.get("system") or {}).get("actions") or []):
        for part in ((act.get("damage") or {}).get("parts") or []):
            if isinstance(part, dict):
                formula = str(part.get("formula", "")).strip()
                t = part.get("type")
                if isinstance(t, dict):
                    types = list(t.get("values", []))
                elif isinstance(t, list):
                    types = list(t)
                else:
                    types = list(part.get("types", []) or [])
            elif isinstance(part, (list, tuple)) and part:
                formula = str(part[0]).strip()
                types = list(part[1]) if len(part) > 1 and isinstance(part[1], list) else []
            else:
                continue
            if formula and formula not in seen:
                seen.add(formula)
                # A typeless compendium part (e.g. detonate, poisonous cloud) would render the damage
                # type "undefined" on the sheet -- default to ["untyped"] so it always shows a chip.
                out.append([formula, types or ["untyped"]])
    return out


def build_damage_index():
    every = json.loads(EVERY_SPELL.read_text(encoding="utf-8"))
    index = {}
    for it in every:
        name = str(it.get("name", "")).strip().lower()
        if not name:
            continue
        parts = spell_damage_parts(it)
        if parts:
            index[name] = parts
    DAMAGE_INDEX.write_text(json.dumps(index, ensure_ascii=False, separators=(",", ":")),
                            encoding="utf-8")
    return len(index), EVERY_SPELL.stat().st_size, DAMAGE_INDEX.stat().st_size


def build_quality_index():
    """quality_effects.json weapon section -> {qualityName: [conditional, ...]}.

    Only the `conditionals` survive: the macro attaches them to the selected weapon's action, and
    the rules text (`description`) is the FoundryVTT module's job -- it renders under the weapon
    item, which the macro never touches. Armor/shield qualities are `changes`, not conditionals."""
    src = json.loads(QUALITY_EFFECTS.read_text(encoding="utf-8"))
    index = {}
    for name, entry in (src.get("weapon") or {}).items():
        conditionals = (entry or {}).get("conditionals") or []
        if conditionals:
            index[name] = conditionals
    QUALITY_INDEX.write_text(json.dumps(index, ensure_ascii=False, separators=(",", ":")),
                             encoding="utf-8")
    return len(index)


def build_class_feature_index():
    """class_feature_effects.json -> {section: {powerKey: [conditional, ...]}}.

    Sections are kept for provenance (the macro flattens them; the rogue/ninja/slayer duplicates are
    identical). Auto-drafted entries ("review": true) are unvetted and ship contextNotes only, so
    they are skipped -- same rule the backend applies when it builds
    class_feature_conditionals_dict."""
    src = json.loads(CLASS_FEATURE_EFFECTS.read_text(encoding="utf-8"))
    index = {}
    for section, pool in src.items():
        if not isinstance(pool, dict):
            continue                                   # "_readme"
        for key, entry in pool.items():
            if not isinstance(entry, dict) or entry.get("review"):
                continue
            conditionals = entry.get("conditionals") or []
            if conditionals:
                index.setdefault(section, {})[key] = conditionals
    CLASS_FEATURE_INDEX.write_text(json.dumps(index, ensure_ascii=False, separators=(",", ":")),
                                   encoding="utf-8")
    return sum(len(p) for p in index.values())


def build_item_index():
    """item_changes.json + item_changes_overrides.json -> {itemNameLower: {changes, contextNotes}}.

    The overrides are a FULL REPLACEMENT per item (the backend layers them the same way), and the
    keys are lowercased here so the module can look an actor's item up directly. Entries with
    neither a change nor a note are dropped -- there are plenty, and they only bloat the zip.

    Both halves ship: `contextNotes` targeting "attack" become weapon conditionals (the Items
    section), everything else overlays the equipment item itself."""
    src = json.loads(ITEM_CHANGES.read_text(encoding="utf-8"))
    src.update(json.loads(ITEM_CHANGES_OVERRIDES.read_text(encoding="utf-8")))
    index = {}
    for name, entry in src.items():
        if not isinstance(entry, dict):
            continue
        changes = entry.get("changes") or []
        notes = entry.get("contextNotes") or []
        if changes or notes:
            index[str(name).lower()] = {"changes": changes, "contextNotes": notes}
    ITEM_INDEX.write_text(json.dumps(index, ensure_ascii=False, separators=(",", ":")),
                          encoding="utf-8")
    attack = sum(1 for e in index.values()
                 for n in e["contextNotes"] if isinstance(n, dict) and n.get("target") == "attack")
    return len(index), attack


def main():
    DATA.mkdir(parents=True, exist_ok=True)
    for src, dst in COPIES:
        if not src.exists():
            raise SystemExit(f"source missing: {src}")
        shutil.copyfile(src, DATA / dst)
        print(f"  copied {dst:<38} ({(DATA / dst).stat().st_size:>8,} bytes)")
    n, raw, slim = build_damage_index()
    print(f"  built  spell_damage_index.json               ({slim:>8,} bytes; "
          f"{n} damaging spells from {raw:,}-byte every_spell.json)")
    nq = build_quality_index()
    print(f"  built  weapon_quality_conditionals.json      "
          f"({QUALITY_INDEX.stat().st_size:>8,} bytes; {nq} weapon qualities)")
    ncf = build_class_feature_index()
    print(f"  built  class_feature_conditionals.json       "
          f"({CLASS_FEATURE_INDEX.stat().st_size:>8,} bytes; {ncf} curated powers)")
    ni, na = build_item_index()
    print(f"  built  item_changes.json                     "
          f"({ITEM_INDEX.stat().st_size:>8,} bytes; {ni} items, {na} attack-note toggles)")
    print(f"data bundle refreshed -> {DATA}")


if __name__ == "__main__":
    main()
