"""Refresh the /data bundle the apply-conditionals macro fetches at runtime.

Copies the curated conditional dicts out of the backend + the live Foundry module into ../data,
and derives a SLIM spell-damage index from the module's 11 MB every_spell.json (Bucket-B touch
spells need their own dice as damage modifiers). Run whenever the source dicts change:

    C:\\Python310\\python.exe build/build_data.py

Sources (frozen snapshot -> ../data):
  backend  Backend/json/spells/spell_riders.json      (Bucket B/C: save + rider text)
  backend  Backend/json/spells/spell_changes.json     (Bucket A: self-buff toggles)
  module   maneuver_changes.json / stance_changes.json
  module   combat_talent_conditionals.json / magic_talent_conditionals.json
  module   every_spell.json  ->  spell_damage_index.json  ({nameLower: [[formula,[types]],...]})
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
    (MODULE_CS / "maneuver_changes.json", "maneuver_changes.json"),
    (MODULE_CS / "stance_changes.json", "stance_changes.json"),
    (MODULE_CS / "combat_talent_conditionals.json", "combat_talent_conditionals.json"),
    (MODULE_CS / "magic_talent_conditionals.json", "magic_talent_conditionals.json"),
]
EVERY_SPELL = MODULE_CS / "every_spell.json"
DAMAGE_INDEX = DATA / "spell_damage_index.json"


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
                out.append([formula, types])
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
    print(f"data bundle refreshed -> {DATA}")


if __name__ == "__main__":
    main()
