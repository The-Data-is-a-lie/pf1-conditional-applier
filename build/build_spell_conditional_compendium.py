"""Build the SOURCE documents for the "Spell Conditionals" FoundryVTT compendium pack.

For every spell in the curated Backend/json/spells/spell_riders.json (Buckets B damaging-touch + C
offensive save/area/debuff), this clones the canonical pf1 spell Item from the module's
every_spell.json compendium export and bakes on the curated save block + rider conditionals -- the
exact transform the live module's addSpellRiders() applies at generation time, but frozen into a
draggable compendium item so a GM can pull a fully-riddered spell straight onto any actor.

Output is a JSON array of pf1 Item documents (each with a stable `_id`), consumed by the Node packer
Backend/scripts/_compendium/pack_pf1_leveldb.js, which compiles it into a LevelDB pack under the
module's packs/ directory.

Bucket A (attack/damage buffs in spell_changes.json) is intentionally excluded: those modify the
wielder's WEAPON, not the spell's own roll, so they can't live on a spell item's action.

Usage:
    python Backend/scripts/build_spell_conditional_compendium.py [--out PATH]
"""
import argparse
import hashlib
import json
import string
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
RIDERS = REPO / "Backend" / "json" / "spells" / "spell_riders.json"
EVERY_SPELL = Path(
    r"C:\Users\Daniel\AppData\Local\FoundryVTT\Data\modules\pf1e_random_char_generator"
    r"\templates\character_sheet_folder\every_spell.json")
DEFAULT_OUT = REPO / "Backend" / "scripts" / "_compendium" / "spell_conditionals_items.json"

SAVE_ID = {"fortitude": "fort", "reflex": "ref", "will": "will"}
_B62 = string.ascii_uppercase + string.ascii_lowercase + string.digits  # Foundry id alphabet
# Canonical top-level keys of a pf1 Item document in a compendium (matches the system's own packs).
# every_spell.json items also carry stray top-level `actions`/`scriptCalls`/`links` harvest artifacts
# (pf1 reads them from `system.*`); drop them so the pack mirrors a hand-authored item exactly.
_ITEM_KEYS = ("_id", "name", "type", "img", "system", "effects",
              "folder", "sort", "ownership", "flags", "_stats")


def _fvtt_id(seed, length=16):
    """Deterministic Foundry-style id ([A-Za-z0-9]) from `seed` -- stable across rebuilds so the pack
    diffs cleanly instead of churning random ids every run."""
    h = int.from_bytes(hashlib.sha256(seed.encode("utf-8")).digest(), "big")
    out = []
    while h and len(out) < length:
        h, r = divmod(h, 62)
        out.append(_B62[r])
    return "".join(out).ljust(length, "0")[:length]


def _attach(item, entry):
    """Port of the module's addSpellRiders(): add the formal save (only when the compendium action
    lacks one) and the rider strings as default-on text conditionals, to every action on the item."""
    save = entry.get("save")
    riders = entry.get("riders") or []
    for action in (item.get("system", {}).get("actions") or []):
        if save and not (action.get("save") and action["save"].get("type")):
            action["save"] = {
                "type": SAVE_ID.get(str(save.get("type", "")).lower(), ""),
                "dc": save.get("dc", "") or "",
                "description": save.get("description", "") or "",
                "harmless": bool(save.get("harmless")),
            }
        if riders:
            conds = action.get("conditionals")
            if not isinstance(conds, list):
                conds = []
            seen = {c.get("name") for c in conds if isinstance(c, dict)}
            for rider in riders:
                name = str(rider)
                if not name or name in seen:
                    continue
                seen.add(name)
                conds.append({
                    "_id": _fvtt_id(item["name"] + "|" + name, 8),
                    "name": name,
                    "default": True,
                    "modifiers": [],
                })
            action["conditionals"] = conds


def build(out_path):
    riders = json.loads(RIDERS.read_text(encoding="utf-8"))
    if not EVERY_SPELL.exists():
        raise SystemExit(f"every_spell.json not found at {EVERY_SPELL}")
    every = json.loads(EVERY_SPELL.read_text(encoding="utf-8"))
    by_lower = {str(s.get("name", "")).lower(): s for s in every}

    docs, missing = [], []
    for i, (name, entry) in enumerate(sorted(riders.items())):
        src = by_lower.get(name.lower())
        if src is None:
            missing.append(name)
            continue
        item = json.loads(json.dumps(src))          # deep clone the canonical spell item
        _attach(item, entry)
        item["_id"] = _fvtt_id(name)
        item["name"] = src.get("name", name)         # canonical compendium casing
        item.setdefault("effects", [])
        item["folder"] = None
        item["sort"] = (i + 1) * 100
        item.setdefault("flags", {})
        item["flags"]["pf1e_random_char_generator"] = {"source": "spell_riders"}
        item.setdefault("ownership", {"default": 0})
        item = {k: item[k] for k in _ITEM_KEYS if k in item}   # canonical shape only
        docs.append(item)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(docs, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"curated rider spells:   {len(riders)}")
    print(f"  built item documents: {len(docs)}")
    print(f"  missing in compendium: {len(missing)}"
          + (f" -> {missing}" if missing else ""))
    print(f"wrote {len(docs)} items -> {out_path}")


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = ap.parse_args()
    build(args.out)


if __name__ == "__main__":
    main()
