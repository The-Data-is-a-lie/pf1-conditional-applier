/**
 * Apply Conditionals — the working half of the pf1-conditional-applier module.
 *
 * Scans the chosen actor and wires the relevant conditionals onto ALL its weapons' attack actions:
 *   • Active feats                    (actor items of type "feat", matched by name)
 *   • Weapon special abilities        (qualities read off the weapon's own description)
 *   • Class-feature toggles           (rage powers, arcana, ki powers, rogue/ninja/slayer talents)
 *   • Path of War maneuvers/stances  (actor items of type "pf1-pow.maneuver")
 *   • Spheres of Power/Might talents  (actor items flagged flags.pf1spheres.sphere)
 *   • Spells                          (actor items of type "spell", matched by name)
 *       - A self-buffs (Bless, Divine Favor…)   -> +attack/+damage toggle
 *       - B touch-damage (Shocking Grasp…)       -> toggle + the spell's own damage dice
 *       - C debuffs/area (Fireball, Hold Person…)-> toggle carrying save + effect text
 * Then it pops a report of everything it could NOT match (the curation gap list).
 *
 * RE-RUN SAFE: every conditional it adds is tracked in a per-weapon flag
 * (flags["pf1-conditional-applier"].condIds). Each run first removes the ones IT added, then
 * re-scans and re-adds — so it picks up newly-learned maneuvers/talents/spells, drops ones you no
 * longer have, and NEVER touches conditionals you made by hand.
 *
 * ENTRY POINT: apply() — bound to game.modules.get(MOD_NS).api by scripts/main.js and invoked by the
 * "Apply Conditionals" macro in the module's compendium. Select a token first (or none, to pick from
 * a list). Everything it reads ships inside the module; it never touches the network.
 *
 * The rest of the exports are the pure functions build/verify_specs.mjs drives against a synthetic
 * actor — importable in plain Node because nothing here runs, or touches a Foundry global, at import
 * time.
 */
const MOD_NS = "pf1-conditional-applier";
const ID_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

// --- deterministic Foundry-style id from a seed (stable across re-runs so ids dedupe cleanly) ---
function detId(seed, len = 16) {
  let h = 1469598103934665603n;                       // FNV-1a (64-bit)
  const prime = 1099511628211n, mask = (1n << 64n) - 1n;
  for (let i = 0; i < seed.length; i++) { h = ((h ^ BigInt(seed.charCodeAt(i))) * prime) & mask; }
  let out = "", x = h;
  while (out.length < len) {
    out += ID_ALPHABET[Number(x % 62n)];
    x /= 62n;
    if (x === 0n) { h = ((h ^ (h >> 13n)) * prime) & mask; x = h; }
  }
  return out.slice(0, len);
}

const norm = s => String(s).toLowerCase().replace(/['’`]/g, "").replace(/\s+/g, " ").trim();
const stripPrefix = n => String(n).replace(/^\((?:Strike|Boost|Counter|Stance)\)\s*/i, "").trim();
const stripSource = n => String(n).replace(/\s*[\(\[][^\)\]]*[\)\]]\s*$/, "").trim();  // "Foo (impale)" -> "Foo"
// "(Rage Power 4) Reckless Abandon" -> "Reckless Abandon": the generator labels every class-feature
// item with its bucket and the level it was gained at (updateClassFeatures -> mkFeature).
const stripLabel = n => String(n).replace(/^\([^)]*\)\s*/, "").trim();
// Curated class-feature key -- the backend's _cfe_key: drop a trailing (Su)/(Ex)/(Sp), then norm.
const cfKey = n => norm(String(n).replace(/\s*\((?:su|ex|sp)\)\s*$/i, ""));
// Every curated name hidden inside ONE generated feat/class-feature item name. A plain lookup finds
// none of them, because the generator:
//   * labels every item          -> "(Feat 1) X", "(Story Feat 15) X", "(Trainer 1): X", "Fighter 6: X"
//   * folds GRANTED chain feats into the primary item (applyFeatTax) with " > " separators, so one
//     item reads "(Feat 1) Point-Blank Shot (EitR) > Charging Hurler > ... > Bullseye Shot" and
//     stands for every feat in it -- all of which the character really has, hence safe to split
//   * tags some entries with their source book -> "Martial Training I (Sagitta Stellaris)"
//   * emits "______ Feats ______" divider items, which must match nothing.
function nameCandidates(raw) {
  let s = String(raw == null ? "" : raw).trim();
  if (!s || s.startsWith("_")) return [];                    // section divider
  s = s.replace(/^\([^)]*\)\s*:?\s*/, "");                   // "(Feat 1) " / "(Trainer 1): "
  s = s.replace(/^[A-Za-z][A-Za-z ]*\d*\s*:\s*/, "");        // "Fighter 6: " / "Profession Rank 5: "
  const out = [];
  for (const part of s.split(">")) {
    const p = part.trim();
    if (!p) continue;
    out.push(p);
    const bare = stripSource(p);                             // drop a trailing "(Sagitta Stellaris)"
    if (bare && bare !== p) out.push(bare);
  }
  return [...new Set(out)];
}
// The buff name = the text before the first ":" (conditional names are "Name: rider text").
const prefixOf = n => {
  const s = String(n == null ? "" : n);
  const i = s.indexOf(":");
  return (i >= 0 ? s.slice(0, i) : s).trim();
};
const cap = s => { s = String(s || ""); return s ? s[0].toUpperCase() + s.slice(1) : ""; };
// Curated class-feature formulas name the CANONICAL class (@classes.rogue.level,
// @classes.barbarian.level) because the shared talent pools are authored once -- but the power may
// sit on a sibling class, and pf1 tags Unchained variants separately ("Barbarian (Unchained)" ->
// "barbarianUnchained"), so an Unchained Rogue's Crippling Strike would silently evaluate to 0.
// Retarget the token to a sibling the actor actually has (the backend's _bucket_classes mapping,
// plus the Unchained tags it misses). ok=false -> no class on this actor can resolve it, and the
// caller drops the conditional into the curation-gap list instead of applying a silent zero.
const CLASS_SIBLINGS = {
  barbarian: ["barbarianUnchained", "skald"],
  rogue: ["rogueUnchained", "ninja", "slayer"],
  witch: ["shaman"],
  monk: ["monkUnchained"],
};
const classTags = actor => new Set([...actor.items]
  .filter(i => i.type === "class").map(i => i.system?.tag).filter(Boolean));
function retargetClassLevel(text, tags) {
  let ok = true;
  const out = String(text == null ? "" : text).replace(/@classes\.(\w+)\.level/g, (m, tag) => {
    if (tags.has(tag)) return m;
    const sib = (CLASS_SIBLINGS[tag] || []).find(s => tags.has(s));
    if (sib) return `@classes.${sib}.level`;
    ok = false;
    return m;
  });
  return { text: out, ok };
}
// Melee/ranged intent: read off a curated conditional NAME ("-1 melee attack", "ranged attack") and
// off a pf1 action type (mwak/msak/mcman vs rwak/rsak/rcman). A row whose intent contradicts the
// action it would attach to (Power Attack on a bow) is offered UNCHECKED -- never hidden, and a
// saved override always wins.
const specWeaponType = n => /\branged\b|\bthrown\b/i.test(n) ? "ranged"
                          : (/\bmelee\b/i.test(n) ? "melee" : null);
const actionWeaponType = a => {
  const t = String((a && a.actionType) || "");
  return /^r/.test(t) ? "ranged" : (/^m/.test(t) ? "melee" : null);
};
const subInit = (s, init) => String(s == null ? "" : s).replaceAll("@INITMOD", `@abilities.${init}.mod`);
// Combined pf1-spell caster level (homebrew): each casting class contributes its FULL class level
// (high/med) or level-3 for a 'low' caster, summed over the spellbooks and floored to 1. Mirrors the
// generator module's spellCLExpr(). Uses @classes.<tag>.level -- pf1 leaves @spells.<book>.cl.total
// at full class level even for a low caster (casterType only drives slots), so summing raw tokens
// would over-count a low caster by 3.
function spellCLExpr(actor) {
  const books = actor?.system?.attributes?.spells?.spellbooks || {};
  const terms = ["primary", "secondary", "tertiary"]
    .map(s => books[s]).filter(b => b && b.inUse && b.class)
    .map(b => {
      const lvl = `@classes.${b.class}.level`;
      return b.casterType === "low" ? `max(${lvl} - 3, 0)` : lvl;   // only a positive 'low' gets -3
    });
  return `max(${terms.join(" + ") || "0"}, 1)`;
}
// Enriched spell riders restate the save DC as `[[ 10 + @slvl + @castMod ]]` and scale off
// `@spells.primary.cl.total`. Substitute all three to concrete forms at attach time: @slvl -> spell
// level, @castMod -> casting mod, and the CL token -> the combined+low-3 expression above.
const subSpell = (s, spellItem, actor) => {
  const slot = spellItem?.system?.spellbook;
  const books = actor?.system?.attributes?.spells?.spellbooks || {};
  const ability = (books[slot] && books[slot].ability) || (books.primary && books.primary.ability) || "int";
  return String(s == null ? "" : s)
    .replaceAll("@spells.primary.cl.total", spellCLExpr(actor))
    .replaceAll("@slvl", String(spellItem?.system?.level ?? 0))
    .replaceAll("@castMod", `@abilities.${ability}.mod`);
};
// Spheres tokens only resolve when pf1spheres populates them (a real spheres class). For an actor
// with no native sphere CL (a dabbler, or a non-spheres actor), substitute them the way the
// generator module does: @spheres.cl.total -> a BAB-tier caster level (high=level, med=3/4, low=1/2,
// floored to 1) from the pf1 spellbooks, and @spheres.cam/@spheres.pam -> the casting/practitioner
// ability mod. A real spheres caster (native @spheres.cl.total > 0) keeps the native tokens.
function sphereCLExpr(actor) {
  const books = actor?.system?.attributes?.spells?.spellbooks || {};
  const terms = ["primary", "secondary", "tertiary"]
    .map(s => books[s]).filter(b => b && b.inUse && b.class)
    .map(b => {
      const lvl = `@classes.${b.class}.level`;
      if (b.casterType === "high") return lvl;
      if (b.casterType === "med") return `floor(3 * ${lvl} / 4)`;
      return `floor(${lvl} / 2)`;
    });
  return `max(${terms.join(" + ") || "0"}, 1)`;
}
function makeSubSph(actor) {
  if (Number(actor?.system?.spheres?.cl?.total) > 0) return s => String(s == null ? "" : s);  // native
  const ab = actor?.system?.abilities || {};
  const bestMental = () => { let b = "cha", bv = -Infinity;
    for (const s of ["int", "wis", "cha"]) { const v = ab[s]?.total ?? ab[s]?.value ?? 0; if (v > bv) { bv = v; b = s; } }
    return b; };
  const cam = actor?.flags?.pf1spheres?.castingAbility || bestMental();
  const pam = actor?.flags?.pf1spheres?.practitionerAbility || initAttr(actor);
  const clExpr = sphereCLExpr(actor);
  return s => String(s == null ? "" : s)
    .replaceAll("@spheres.cl.total", clExpr)
    .replaceAll("@spheres.cam", `@abilities.${cam}.mod`)
    .replaceAll("@spheres.pam", `@abilities.${pam}.mod`);
}

function labelFormula(formula, srcName, init) {
  formula = subInit(formula, init);
  if (formula && !/\[.*\]/.test(formula)) formula += `[${String(srcName).replace(/[\[\]]/g, "").trim()}]`;
  return formula;
}
// Base damage type(s) of the weapon a conditional is applied to (first damage part) -- handles pf1
// v11 {type:{values:[...]}} and the older {types:[...]}.
const weaponDamageTypes = (action) => {
  for (const p of ((action && action.system && action.system.damage && action.system.damage.parts)
                   || (action && action.damage && action.damage.parts) || [])) {
    const t = p && p.type;
    let vals = [];
    if (t && Array.isArray(t.values)) vals = t.values;
    else if (Array.isArray(p && p.types)) vals = p.types;
    else if (Array.isArray(t)) vals = t;
    vals = (vals || []).filter(Boolean);
    if (vals.length) return vals.slice();
  }
  return [];
};
// Resolve a DAMAGE modifier's damageType at attach time: ["as-weapon"] -> the weapon's own type(s)
// (bonus weapon dice show the real slashing/bludgeoning/piercing), untyped fallback; empty on a DICE
// instance -> ["untyped"] (an empty Set renders "undefined"). Curated elements / attack / flat left.
const dmgTypeOrUntyped = (dt, target, formula, weaponTypes) => {
  const arr = Array.isArray(dt) ? dt.slice() : [];
  if ((target || "damage") !== "damage") return arr;
  if (arr.length === 1 && arr[0] === "as-weapon")
    return (Array.isArray(weaponTypes) && weaponTypes.length) ? weaponTypes.slice() : ["untyped"];
  if (arr.length === 0 && /[\d)]d\d/.test(String(formula || ""))) return ["untyped"];
  return arr;
};
function mkMod(m, srcName, seed, idx, init, weaponTypes) {
  const isAttack = m.target === "attack";
  return {
    _id: detId(`${seed}|m${idx}`, 8),
    formula: labelFormula(m.formula, srcName, init),
    target: m.target || "damage",
    subTarget: m.subTarget || (isAttack ? "allAttack" : "allDamage"),
    type: m.type || "untyped",
    damageType: dmgTypeOrUntyped(m.damageType, m.target, m.formula, weaponTypes),
    critical: m.critical || "normal",
  };
}

// --- resolve the actor: single controlled token, else a chooser dialog ---
function chooseActorDialog(actors) {
  return new Promise(resolve => {
    const opts = actors.map(a => `<option value="${a.id}">${a.name} [${a.type}]</option>`).join("");
    new Dialog({
      title: "Apply Conditionals — choose character",
      content: `<p>No single token selected. Pick the actor to sync:</p>
                <select id="ac-sel" style="width:100%">${opts}</select>`,
      buttons: {
        ok: { icon: '<i class="fas fa-check"></i>', label: "Apply",
              callback: html => resolve(game.actors.get(html.find("#ac-sel").val())) },
        cancel: { icon: '<i class="fas fa-times"></i>', label: "Cancel", callback: () => resolve(null) },
      },
      default: "ok", close: () => resolve(null),
    }).render(true);
  });
}
async function resolveActor() {
  const controlled = canvas?.tokens?.controlled ?? [];
  if (controlled.length === 1 && controlled[0].actor) return controlled[0].actor;
  const owned = game.actors.filter(a => a.isOwner && (a.type === "character" || a.type === "npc"));
  if (!owned.length) { ui.notifications.error("No owned character/npc actors to apply to."); return null; }
  return chooseActorDialog(owned);
}

// --- initiating ability (int/wis/cha) for @INITMOD in maneuver riders ---
function initAttr(actor) {
  const cls = actor.items.find(i => i.type === "class"
    && ["int", "wis", "cha"].includes(i.system?.maneuverProgression?.initiatorAttr));
  if (cls) return cls.system.maneuverProgression.initiatorAttr;
  const ab = actor.system?.abilities || {};
  let best = null, bestV = -Infinity;
  for (const s of ["int", "wis", "cha"]) {
    const v = ab[s]?.total ?? ab[s]?.value ?? 0;
    if (v > bestV) { bestV = v; best = s; }
  }
  return best || "wis";
}

// --- load the frozen data bundle, from inside the module ---
// Foundry serves every installed module's own directory, so these are same-origin reads of files
// that shipped in the zip -- no network, no bundler, and data/ stays editable in place.
const DATA_FILES = ["spell_riders", "spell_changes", "maneuver_changes", "combat_talent_conditionals",
                    "magic_talent_conditionals", "spell_damage_index", "feat_conditionals",
                    "weapon_quality_conditionals", "class_feature_conditionals", "item_changes"];
async function loadData() {
  const out = {};
  await Promise.all(DATA_FILES.map(async f => {
    const res = await fetch(`modules/${MOD_NS}/data/${f}.json`);
    if (!res.ok) throw new Error(`data/${f}.json -> HTTP ${res.status} (module install incomplete?)`);
    out[f] = await res.json();
  }));
  return out;
}

// --- build the weapon-independent conditional specs from what the actor knows ---
function buildSpecs(actor, data, init) {
  const specs = [];                              // {name, default, rawMods, srcName, weaponType?}
  const gaps = { maneuvers: [], talents: [], spells: [], qualities: [], classFeatures: [] };
  const subSph = makeSubSph(actor);              // @spheres.* -> concrete forms for a dabbler (else no-op)

  // Active-feat toggles (Power Attack, Deadly Aim, Combat Expertise, ...) and class-feature toggles
  // (rage powers, magus arcana, ki powers, rogue/ninja/slayer talents) -- both live on `feat` items
  // (class features are feat/subType "classFeat"). The generator attaches the feat ones to its main
  // weapon only (addFeatConditionals) and never attaches the class-feature ones at all, so this is
  // the only path that puts either on the attack twin or a second weapon.
  const featTbl = {}; for (const [k, v] of Object.entries(data.feat_conditionals || {})) featTbl[norm(k)] = v;
  // Class-feature sections are flattened: the rogue/ninja/slayer duplicates are identical, and the
  // item name carries no bucket to key on beyond the label stripLabel() removes.
  const cfTbl = {}; for (const pool of Object.values(data.class_feature_conditionals || {}))
    for (const [k, v] of Object.entries(pool || {})) cfTbl[cfKey(k)] = v;
  const tags = classTags(actor);
  // A chain feat granted twice (two items folding in the same follower) must not produce the row
  // twice -- dedupe on the curated conditional name, which is what actually lands on the weapon.
  const seenNames = new Set();
  for (const it of actor.items) {
    if (it.type !== "feat") continue;
    const cands = nameCandidates(it.name);
    for (const cand of cands) {
      const fEntry = featTbl[norm(cand)];
      if (!fEntry || !fEntry.name || seenNames.has(fEntry.name)) continue;
      seenNames.add(fEntry.name);
      specs.push({ name: fEntry.name, default: !!fEntry.default, rawMods: fEntry.modifiers || [],
                   srcName: prefixOf(fEntry.name), section: "Feats",
                   weaponType: specWeaponType(fEntry.name) });
    }
    for (const cond of cands.flatMap(c => cfTbl[cfKey(c)] || [])) {
      const resolved = [retargetClassLevel(cond.name || it.name, tags)];
      const rawMods = (cond.modifiers || []).map(m => {
        const r = retargetClassLevel(m.formula, tags);
        resolved.push(r);
        return { ...m, formula: r.text };
      });
      if (resolved.some(r => !r.ok)) {            // no class on this actor resolves its level
        gaps.classFeatures.push(`${it.name}  (unresolved class level)`);
        continue;
      }
      if (seenNames.has(resolved[0].text)) continue;
      seenNames.add(resolved[0].text);
      specs.push({ name: resolved[0].text, default: !!cond.default, rawMods,
                   srcName: prefixOf(resolved[0].text), section: "Class Features",
                   weaponType: specWeaponType(resolved[0].text) });
    }
  }

  // Magic-item activations. A curated item's contextNotes targeting "attack" are activation text
  // (Swordmaster's Shirt, Battle Strider's Boots) -- pf1 would print them in full on EVERY attack
  // chat card if they rode the item, so they become default-off toggles here instead, exactly as the
  // generator's addItemAttackConditionals() does. Name-only riders: the [[ ]] inline rolls are
  // already baked in by the backend, so there is nothing to source-label and no modifiers to build.
  // The item's non-attack changes/notes are a different job -- see syncItemEffects().
  for (const it of actor.items) {
    for (const note of itemAttackNotes(it, data)) {
      const name = `(${it.name}): ${note}`;
      if (seenNames.has(name)) continue;
      seenNames.add(name);
      specs.push({ name, default: false, rawMods: [], srcName: it.name, section: "Items" });
    }
  }

  // Path of War maneuvers / damaging stances
  const manTbl = {}; for (const [k, v] of Object.entries(data.maneuver_changes || {})) manTbl[norm(k)] = v;
  for (const it of actor.items) {
    if (it.type !== "pf1-pow.maneuver") continue;
    const clean = stripPrefix(it.name);
    const entry = manTbl[norm(clean)];
    const isStance = /^\(Stance\)/i.test(it.name) || (it.system?.maneuverType || "").toLowerCase() === "stance";
    if (!entry) { gaps.maneuvers.push(clean); continue; }
    const rider = typeof entry.rider === "string" ? entry.rider.trim() : "";
    const hasMods = Array.isArray(entry.modifiers) && entry.modifiers.length;
    if (!rider && !hasMods) { gaps.maneuvers.push(clean); continue; }
    if (isStance && !hasMods) continue;          // pure-buff stance -> belongs on a buff, not a weapon
    specs.push({
      name: rider ? `${it.name}: ${subInit(rider, init)}` : it.name,
      default: isStance, rawMods: entry.modifiers || [], srcName: clean,
      section: "Path of War",
    });
  }

  // Spheres talents
  const talTbl = dict => { const o = {}; for (const [s, t] of Object.entries(dict || {})) {
    const k = norm(s); o[k] = o[k] || {}; for (const [tn, e] of Object.entries(t)) o[k][norm(tn)] = e; } return o; };
  const combatT = talTbl(data.combat_talent_conditionals), magicT = talTbl(data.magic_talent_conditionals);
  for (const it of actor.items) {
    const sph = it.flags?.pf1spheres?.sphere;
    if (!sph) continue;
    const sKey = norm(sph);
    const nm = it.name, nKey = norm(nm), nKey2 = norm(stripSource(nm));
    const entry = (combatT[sKey] || {})[nKey] || (magicT[sKey] || {})[nKey]
               || (combatT[sKey] || {})[nKey2] || (magicT[sKey] || {})[nKey2];
    if (!entry) { gaps.talents.push(nm); continue; }
    const rider = typeof entry.rider === "string" ? entry.rider.trim() : "";
    const hasMods = Array.isArray(entry.modifiers) && entry.modifiers.length;
    if (!rider && !hasMods) { gaps.talents.push(nm); continue; }
    specs.push({
      name: rider ? `${nm}: ${subInit(subSph(rider), init)}` : nm,
      default: !!entry.default,
      rawMods: (entry.modifiers || []).map(m => ({ ...m, formula: subSph(m.formula) })),
      srcName: nm, section: "Spheres of Power/Might",
    });
  }

  // Spells: A (spell_changes) and/or B/C (spell_riders)
  const chg = {}; for (const [k, v] of Object.entries(data.spell_changes || {})) chg[norm(k)] = { name: k, e: v };
  const rid = {}; for (const [k, v] of Object.entries(data.spell_riders || {})) rid[norm(k)] = { name: k, e: v };
  const dmg = data.spell_damage_index || {};
  for (const it of actor.items) {
    if (it.type !== "spell") continue;
    const key = norm(it.name);
    const slot = it.system?.spellbook;
    const cls = actor.system?.attributes?.spells?.spellbooks?.[slot]?.class || slot || "?";
    const A = chg[key], BC = rid[key];
    if (!A && !BC) { gaps.spells.push(`${it.name}  (${cls})`); continue; }
    if (A) {
      const e = A.e; let rawMods = []; const parts = [];
      if (Array.isArray(e.modifiers)) rawMods = e.modifiers;
      else if (Array.isArray(e.changes)) for (const ch of e.changes) {
        const onAtk = ch.target === "attack";
        const tl = (ch.type && ch.type !== "untyped") ? ` ${ch.type}` : "";
        parts.push(`+[[${ch.formula ?? "0"}]]${tl} ${onAtk ? "attack" : "damage"}`);
        rawMods.push({ formula: ch.formula ?? "0", target: onAtk ? "attack" : "damage",
          subTarget: onAtk ? "allAttack" : "allDamage", type: ch.type || "untyped", damageType: [], critical: "normal" });
      }
      let name = e.name || (parts.length ? `${A.name}: ${parts.join(" & ")}` : A.name);
      if (e.rider) name += `; ${e.rider}`;
      specs.push({ name: subSpell(name, it, actor), default: false,
        rawMods: rawMods.map(m => ({ ...m, formula: subSpell(m.formula, it, actor) })),
        srcName: String(A.name).split(":")[0], section: "Spells" });
    }
    if (BC) {
      const e = BC.e, save = e.save || {};
      const riders = (e.riders || []).map(String);
      // The enriched riders now carry a labeled `Save:` clause; only fall back to the raw save
      // description when no rider states the save, so we don't duplicate it.
      const ridersStateSave = riders.some(r => /\b(fortitude|reflex|will)\s+save\b/i.test(r));
      const bits = [];
      if (!ridersStateSave && (save.description || save.type)) bits.push(String(save.description || `${cap(save.type)} save`));
      for (const r of riders) bits.push(r);
      const riderText = bits.filter(Boolean).join("; ");
      const rawMods = [];
      if (e.attack) for (const [formula, dtypes] of (dmg[it.name.toLowerCase()] || []))
        rawMods.push({ formula: subSpell(formula, it, actor), target: "damage", subTarget: "allDamage", type: "untyped",
          damageType: Array.isArray(dtypes) ? dtypes : [], critical: "nonCrit" });
      specs.push({ name: subSpell(riderText ? `${BC.name}: ${subInit(riderText, init)}` : BC.name, it, actor),
        default: false, rawMods, srcName: BC.name, section: "Spells" });
    }
  }

  // Weapon special abilities are per-weapon (weaponQualitySpecs), but the gap panel is rendered
  // once, before a weapon is picked -- so collect the uncurated ones across every weapon/attack
  // item here. Empty today (all 197 scraped qualities are curated); it catches hand-typed markup
  // and anything the backend adds later.
  const qualTbl = qualityTable(data), qSeen = new Set();
  for (const it of actor.items) {
    if (!(it.type === "weapon" || it.type === "attack")) continue;
    for (const q of detectQualities(it)) {
      const k = norm(q);
      if (qualTbl[k] || qSeen.has(k)) continue;
      qSeen.add(k);
      gaps.qualities.push(q);
    }
  }
  return { specs, gaps };
}

// --- magic items: the backend's curated {changes, contextNotes} for one actor item ---
// data.item_changes is keyed by LOWERCASED item name (build_data.py already merged the overrides in),
// so this is a direct lookup. Items the generator renamed with an enhancement prefix ("+4 Trackless
// ... Stoneplate") deliberately miss: those are armor, whose qualities come from a different list.
const itemBuffFor = (it, data) => (data.item_changes || {})[String(it?.name || "").toLowerCase()] || null;
function itemAttackNotes(it, data) {
  const out = [];
  for (const n of (itemBuffFor(it, data)?.contextNotes || [])) {
    if (n && n.target === "attack" && n.text) out.push(String(n.text).trim());
  }
  return out;
}

// The item's PASSIVE half: always-on `changes` and situational `contextNotes` overlaid on the item
// itself. Port of the generator's applyBuffData() -- changes dedupe by `target` and notes by exact
// `text`, so a bonus the pf1 compendium item already automates never double-applies, and the pf1
// ChangeModel defaults the backend omits are filled in here.
//
// Re-run safe on the module's usual terms: what we added last time is listed in the item's
// flags[MOD_NS].changeIds / .noteTexts and stripped FIRST, so a curation change drops the stale row
// while anything hand-authored is left alone. Returns an update object, or null if it is a no-op.
function itemEffectUpdate(it, data) {
  const buff = itemBuffFor(it, data);
  if (!buff) return null;
  const priorIds = new Set(it.flags?.[MOD_NS]?.changeIds || []);
  const priorTexts = new Set(it.flags?.[MOD_NS]?.noteTexts || []);
  const changes = (it.system?.changes || []).filter(c => !priorIds.has(c?._id));
  const notes = (it.system?.contextNotes || []).filter(n => !priorTexts.has(n?.text));

  const haveTargets = new Set(changes.map(c => c?.target));
  const haveTexts = new Set(notes.map(n => n?.text));
  const newIds = [], newTexts = [];
  for (const ch of (buff.changes || [])) {
    if (!ch || haveTargets.has(ch.target)) continue;
    haveTargets.add(ch.target);
    // Deterministic id from item + target: a re-run regenerates the same one, so the strip above
    // finds it even if the flag was lost.
    const id = detId(`${it.id}|chg|${ch.target}`, 8);
    newIds.push(id);
    changes.push({ formula: "0", target: "", type: "untyped", operator: "add", priority: 0, value: 0,
                   ...ch, _id: id });
  }
  for (const n of (buff.contextNotes || [])) {
    // Attack notes became weapon conditionals in buildSpecs -- they must not also ride the item.
    if (!n || !n.text || n.target === "attack" || haveTexts.has(n.text)) continue;
    haveTexts.add(n.text);
    newTexts.push(n.text);
    notes.push(n);
  }
  if (!newIds.length && !newTexts.length && !priorIds.size && !priorTexts.size) return null;
  return { _id: it.id, "system.changes": changes, "system.contextNotes": notes,
           [`flags.${MOD_NS}.changeIds`]: newIds, [`flags.${MOD_NS}.noteTexts`]: newTexts };
}

// Every item on the actor that the curated data has something passive to say about.
function itemEffectUpdates(actor, data) {
  const out = [];
  for (const it of actor.items) {
    const upd = itemEffectUpdate(it, data);
    if (upd) out.push(upd);
  }
  return out;
}

// --- weapon special abilities (Flaming, Keen, ...) carried by ONE weapon/attack item ---
// Detection is description-only, from the two blocks the generator writes:
//   appendEnhancementsToDescription -> "<strong>Special abilities:</strong> Corrosive, Keen"
//     (on BOTH the inventory weapon and its rollable attack twin)
//   appendQualityDescription        -> "<h3>Corrosive</h3><p>rules text</p>" (weapon item only)
// Matching quality names inside the ITEM NAME is deliberately NOT done: "Aldori Dueling Sword",
// "Throwing Axe" and "Flying Blade" all collide with real qualities (13 of the 474 base weapons
// do), and it buys nothing -- the generator only stamps qualities into the name when the leftover
// enhancement budget reaches +1.
const detectQualities = item => {
  const desc = String(item?.system?.description?.value || "");
  const out = [];
  const line = desc.match(/<strong>\s*Special abilities:\s*<\/strong>([^<]*)/i);
  if (line) for (const part of line[1].split(",")) { const s = part.trim(); if (s) out.push(s); }
  for (const m of desc.matchAll(/<h3>([^<]+)<\/h3>/gi)) { const s = m[1].trim(); if (s) out.push(s); }
  return out;
};
const qualityTable = data => {
  const o = {};
  for (const [k, v] of Object.entries(data.weapon_quality_conditionals || {})) o[norm(k)] = { name: k, conds: v };
  return o;
};
function weaponQualitySpecs(actor, weaponId, data) {
  const it = actor.items.get(weaponId);
  if (!it) return [];
  const tbl = qualityTable(data), out = [], seen = new Set();
  for (const q of detectQualities(it)) {
    const k = norm(q);
    if (seen.has(k)) continue;
    seen.add(k);
    const hit = tbl[k];
    if (!hit) continue;                          // uncurated -> reported by the gap panel
    for (const cond of (hit.conds || [])) {
      const name = cond.name || hit.name;
      out.push({ name, default: cond.default !== false, rawMods: cond.modifiers || [],
                 srcName: prefixOf(name), section: "Weapon Qualities",
                 weaponType: specWeaponType(name) });
    }
  }
  return out;
}

// Conditionals that already live on the actor's OTHER, differently-named weapons/attacks, offered
// as an opt-in "On Other Attacks" section (default OFF) so you can copy any onto THIS weapon with
// its real modifiers. Excludes: this weapon's same-named twin; dividers / inert name-only entries;
// prefixes already offered by the built-in sections (base specs + this weapon's quality rows) or
// already on this weapon. Deduped by name prefix. Recomputed per selected weapon.
function otherAttackSpecs(actor, specs, weaponId, extraPrefixes) {
  const w = actor.items.get(weaponId);
  const baseP = new Set(specs.map(s => prefixOf(s.name)));
  for (const p of (extraPrefixes || [])) baseP.add(p);
  const ownP = new Set();
  for (const act of (w?.system?.actions || []))
    for (const c of (act.conditionals || [])) ownP.add(prefixOf(c && c.name));
  const out = [], seen = new Set();
  for (const it of actor.items) {
    if (!(it.type === "weapon" || it.type === "attack")) continue;
    if (it.id === weaponId || (w && it.name === w.name)) continue;    // skip self + same-named twin
    for (const act of (it.system?.actions || [])) {
      for (const c of (act.conditionals || [])) {
        if (!c) continue;
        const mods = c.modifiers || [];
        if (!mods.length && !String(c.name).includes(":")) continue;  // dividers / inert name-only
        const p = prefixOf(c.name);
        if (!p || seen.has(p) || baseP.has(p) || ownP.has(p)) continue;
        seen.add(p);
        out.push({ name: c.name, srcName: p, rawMods: mods, section: "On Other Attacks",
                   default: !!c.default, _defaultInclude: false });
      }
    }
  }
  return out.sort((a, b) => prefixOf(a.name).localeCompare(prefixOf(b.name)));
}

// Editable row state for ONE weapon+action: the actor-wide specs, that weapon's own quality rows,
// the "On Other Attacks" rows, and any saved overrides on top. A row is unchecked by default when
// its melee/ranged intent contradicts the action's; a saved override always wins over both.
function buildRows(actor, specs, data, overrides, weaponId, actionIdx) {
  const ov = overrides[weaponId] || {};
  const w = actor.items.get(weaponId);
  const actions = w?.system?.actions || [];
  const aType = actionWeaponType(actions[actionIdx] || actions[0]);
  const qSpecs = weaponQualitySpecs(actor, weaponId, data);
  const others = otherAttackSpecs(actor, specs, weaponId, qSpecs.map(s => prefixOf(s.name)));
  return specs.concat(qSpecs, others).map(s => {
    const o = ov[s.name] || {};
    const mismatch = !!(s.weaponType && aType && s.weaponType !== aType);
    const defInclude = s._defaultInclude !== undefined ? s._defaultInclude : !mismatch;
    return {
      origName: s.name, srcName: s.srcName, rawMods: s.rawMods, section: s.section,
      include: o.include !== undefined ? o.include : defInclude,
      def: o.default !== undefined ? o.default : !!s.default,
      name: o.name !== undefined ? o.name : s.name,
    };
  });
}

// Sections the module rebuilds from curated source data that the GENERATOR also writes (or, for
// class features, would write) verbatim onto its main weapon -- the only ones eligible for the
// adopt-if-verbatim / near-duplicate handling in applyToWeapon. "Items" belongs here because
// addItemAttackConditionals() writes the identical "(Item Name): text" rows at generation time.
const ADOPT_SECTIONS = new Set(["Feats", "Weapon Qualities", "Class Features", "Items"]);

// --- apply the chosen rows to ONE weapon's chosen action, idempotently ---
// Returns the embedded-document update object, or null if the weapon/action is unusable.
function applyToWeapon(actor, weaponId, actionIdx, rows, init) {
  const w = actor.items.get(weaponId);
  if (!w) return null;
  const src = w.toObject();
  const actions = src.system?.actions || [];
  const action = actions[actionIdx] || actions[0];
  if (!action) return null;
  const wpnTypes = weaponDamageTypes(action);   // resolves ["as-weapon"] modifiers to this weapon's type
  if (!Array.isArray(action.conditionals)) action.conditionals = [];
  const prev = new Set((src.flags?.[MOD_NS]?.condIds) || []);
  action.conditionals = action.conditionals.filter(c => !(c && prev.has(c._id)));   // drop our old ones

  // Adopt-if-verbatim. The generator writes its feat/quality toggles straight onto the main weapon
  // with no condIds flag, so they read as hand-made here. When an existing conditional's name is
  // byte-identical to the one we would generate from the curated data, it is provably unedited
  // generator output: drop it now so our row re-emits it in its proper section AND tracks it in
  // condIds, making it editable and removable from the dialog. A name you edited differs, so it
  // stays untouched (and blocks our near-duplicate row below). Only rows actually being applied
  // adopt -- an excluded row must never silently delete what the generator put there.
  const genNames = new Set(rows.filter(r => r.include && ADOPT_SECTIONS.has(r.section))
                               .map(r => r.origName));
  action.conditionals = action.conditionals.filter(c => !(c && genNames.has(c.name)));

  const seen = new Set(action.conditionals.map(c => c && c.name));                  // keep hand-made
  const keptPrefixes = new Set(action.conditionals.map(c => norm(prefixOf(c && c.name))));
  const newIds = [];

  // Inert section dividers (empty modifiers => an unchecked checkbox that does nothing) so the long
  // attack-dialog list reads as grouped: Other -> Feats -> Qualities -> Items -> Class Features ->
  // PoW -> Spheres -> Spells -> Other Attacks.
  const EXISTING_LABEL = "──────  OTHER (EXISTING)  ──────";
  const SECT_LABEL = {
    "Feats": "──────  FEATS  ──────",
    "Weapon Qualities": "──────  WEAPON QUALITIES  ──────",
    "Items": "──────  ITEMS  ──────",
    "Class Features": "──────  CLASS FEATURES  ──────",
    "Path of War": "──────  PATH OF WAR  ──────",
    "Spheres of Power/Might": "──────  SPHERES  ──────",
    "Spells": "──────  SPELLS  ──────",
    "On Other Attacks": "──────  FROM OTHER ATTACKS  ──────",
  };
  const RANK = { "Feats": 0, "Weapon Qualities": 1, "Items": 2, "Class Features": 3,
                 "Path of War": 4, "Spheres of Power/Might": 5, "Spells": 6, "On Other Attacks": 7 };
  const sep = (seed, name) => {
    const sid = detId(seed, 8);
    newIds.push(sid);
    return { _id: sid, name, default: false, modifiers: [] };
  };

  // A header above whatever the macro does NOT own: hand-authored conditionals, generator rows you
  // edited (so adoption skipped them), and families this macro doesn't curate. Only when some
  // survive, so a weapon whose conditionals were all adopted gets no empty header.
  if (action.conditionals.length) {
    action.conditionals.unshift(sep(`${weaponId}|__sep__|general`, EXISTING_LABEL));
  }

  // Enforce the section order (natural spec order already matches; this makes it robust).
  const ordered = rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => ((RANK[a.r.section] ?? 9) - (RANK[b.r.section] ?? 9)) || (a.i - b.i))
    .map(x => x.r);

  let curSection = null;
  for (const r of ordered) {
    if (!r.include || !r.name || seen.has(r.name)) continue;
    // An edited generator row survived adoption -- don't stack a near-duplicate next to it.
    if (ADOPT_SECTIONS.has(r.section) && keptPrefixes.has(norm(prefixOf(r.origName)))) continue;
    if (r.section && r.section !== curSection && SECT_LABEL[r.section]) {   // first row of a section
      curSection = r.section;
      action.conditionals.push(sep(`${weaponId}|__sep__|${r.section}`, SECT_LABEL[r.section]));
    }
    seen.add(r.name);
    const seed = `${weaponId}|${r.origName}`;                 // seed on the STABLE build-time name
    const cid = detId(seed, 8);
    action.conditionals.push({
      _id: cid, name: r.name, default: !!r.def,
      modifiers: (r.rawMods || []).map((m, i) => mkMod(m, r.srcName, seed, i, init, wpnTypes)),
    });
    newIds.push(cid);
  }
  return { _id: weaponId, "system.actions": actions, [`flags.${MOD_NS}.condIds`]: newIds };
}

// --- the per-weapon review/edit dialog (stays open; edits persist to an actor flag) ---
function openDialog(actor, specs, gaps, init, data) {
  const esc = s => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const weapons = actor.items.filter(i => i.type === "weapon" || i.type === "attack");
  if (!weapons.length) { ui.notifications.warn(`${actor.name}: no weapon/attack items to apply to.`); return; }
  // Persisted per-weapon overrides: { [weaponId]: { [origName]: {include, default, name} } }.
  // Read/write the RAW flags object rather than getFlag/setFlag: the write below is batched into the
  // same actor.update() as the rest, and the raw path is what the pre-module macro versions wrote —
  // MOD_NS is the module id, so flags saved back then are still read here unchanged.
  const overrides = foundry.utils.deepClone(actor.flags?.[MOD_NS]?.overrides || {});

  // Build the editable row state for the selected weapon+action.
  const rowsFor = (weaponId, actionIdx) => buildRows(actor, specs, data, overrides, weaponId, actionIdx);

  let curWeaponId = weapons[0].id, curActionIdx = 0, curRows = [];

  const rowHtml = (r, i) => {
    const mods = (r.rawMods || []).map(m => `${m.formula} → ${m.target}`).join(", ") || "—";
    const editable = String(r.name).split("; ").join(";\n");   // one clause per line for editing
    return `<details class="cond-row" data-i="${i}">
      <summary>
        <label><input type="checkbox" class="inc" ${r.include ? "checked" : ""}></label>
        <strong>${esc(String(r.name).split(":")[0].slice(0, 70))}</strong>
      </summary>
      <div class="cond-row-body">
        <label><input type="checkbox" class="def" ${r.def ? "checked" : ""}> on by default (per-roll)</label>
        <textarea class="txt" rows="4">${esc(editable)}</textarea>
        <div class="cond-row-mods">modifiers: ${esc(mods)}</div>
      </div>
    </details>`;
  };

  const weaponOpts = weapons.map(w => `<option value="${w.id}">${esc(w.name)} [${w.type}]</option>`).join("");
  // Magic-item passive effects. Not weapon-scoped -- they write to the equipment items themselves --
  // so they get their own button rather than riding the per-weapon apply.
  const itemUpdates = itemEffectUpdates(actor, data);
  const li = arr => arr.length ? `<ul>${arr.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : `<em>none</em>`;
  const gapCount = gaps.spells.length + gaps.maneuvers.length + gaps.talents.length
                 + gaps.qualities.length + gaps.classFeatures.length;
  // Layout lives in styles/apply-conditionals.css, scoped under .pf1ca. The one exception is
  // #action-wrap's inline display:none -- jQuery .show()/.hide() below toggle it, and an inline
  // value is what they expect to clear.
  const content = `
    <div class="pf1ca">
      <div class="pf1ca-toolbar">
        <label>Weapon: <select id="weapon-sel">${weaponOpts}</select></label>
        <span id="action-wrap" style="display:none"></span>
        <button type="button" id="toggle-all"><i class="fas fa-check-double"></i> All on/off</button>
        <button type="button" id="apply-weapon"><i class="fas fa-check"></i> Apply to this weapon</button>
        <button type="button" id="apply-all" title="Apply to every weapon and attack item, each with its own qualities and its own saved choices"><i class="fas fa-check-double"></i> Apply to all weapons</button>
        ${itemUpdates.length ? `<button type="button" id="sync-items" title="Overlay the curated bonuses and notes for these items onto the item documents themselves. Deduped against what each item already has; re-runnable."><i class="fas fa-ring"></i> Sync item effects (${itemUpdates.length})</button>` : ""}
      </div>
      <p class="pf1ca-hint">Uncheck to exclude a conditional; expand a row to edit its clauses or per-roll default. Edits persist per weapon and survive re-runs.</p>
      <div id="cond-rows"></div>
      <hr>
      <details class="pf1ca-gaps"><summary>Curation gaps (${gapCount})</summary>
        <div class="pf1ca-gaps-body">
          <strong>Spells (${gaps.spells.length})</strong>${li(gaps.spells)}
          <strong>Maneuvers (${gaps.maneuvers.length})</strong>${li(gaps.maneuvers)}
          <strong>Talents (${gaps.talents.length})</strong>${li(gaps.talents)}
          <strong>Weapon qualities (${gaps.qualities.length})</strong>${li(gaps.qualities)}
          <strong>Class features (${gaps.classFeatures.length})</strong>${li(gaps.classFeatures)}
        </div>
      </details>
    </div>`;

  new Dialog({
    title: `Apply Conditionals — ${actor.name} (init: ${init})`,
    content,
    buttons: { done: { icon: '<i class="fas fa-flag-checkered"></i>', label: "Done" } },
    default: "done",
    render: html => {
      const renderActionSel = () => {
        const w = actor.items.get(curWeaponId);
        const actions = w?.system?.actions || [];
        const wrap = html.find("#action-wrap");
        if (actions.length > 1) {
          const opts = actions.map((a, idx) => `<option value="${idx}" ${idx === curActionIdx ? "selected" : ""}>${esc(a.name || ("action " + idx))}</option>`).join("");
          wrap.html(`Action: <select id="action-sel">${opts}</select>`).show();
        } else { wrap.empty().hide(); }
      };
      const sectionHeader = name => `<div class="cond-section">
        <strong>${esc(name)}</strong>
        <button type="button" class="toggle-section" data-section="${esc(name)}">All on/off</button>
      </div>`;
      const renderRows = () => {
        curRows = rowsFor(curWeaponId, curActionIdx);
        if (!curRows.length) { html.find("#cond-rows").html("<p><em>Nothing to apply — actor has no matching spells/maneuvers/talents.</em></p>"); return; }
        let out = "", lastSection = null;
        curRows.forEach((r, i) => {
          const sec = r.section || "Other";
          if (sec !== lastSection) { out += sectionHeader(sec); lastSection = sec; }
          out += rowHtml(r, i);
        });
        html.find("#cond-rows").html(out);
      };
      const rowIdx = ev => +ev.target.closest(".cond-row").dataset.i;

      html.on("change", "#weapon-sel", ev => { curWeaponId = ev.target.value; curActionIdx = 0; renderActionSel(); renderRows(); });
      // Re-render on an action switch too: the melee/ranged default follows the action's type.
      html.on("change", "#action-sel", ev => { curActionIdx = +ev.target.value; renderRows(); });
      html.on("change", ".cond-row .inc", ev => { curRows[rowIdx(ev)].include = ev.target.checked; });
      html.on("change", ".cond-row .def", ev => { curRows[rowIdx(ev)].def = ev.target.checked; });
      html.on("input", ".cond-row .txt", ev => { curRows[rowIdx(ev)].name = ev.target.value.replace(/\s*\n+\s*/g, "; ").trim(); });
      const setInclude = (idxs) => {
        const newState = !idxs.every(i => curRows[i].include);
        for (const i of idxs) {
          curRows[i].include = newState;
          html.find(`.cond-row[data-i="${i}"] .inc`).prop("checked", newState);
        }
      };
      html.on("click", "#toggle-all", ev => { ev.preventDefault(); setInclude(curRows.map((_, i) => i)); });
      html.on("click", ".toggle-section", ev => {
        ev.preventDefault();
        const sec = ev.target.closest(".toggle-section").dataset.section;
        setInclude(curRows.map((r, i) => [r, i]).filter(([r]) => (r.section || "Other") === sec).map(([, i]) => i));
      });
      html.on("click", "#apply-weapon", async ev => {
        ev.preventDefault();
        const upd = applyToWeapon(actor, curWeaponId, curActionIdx, curRows, init);
        if (!upd) { ui.notifications.warn("Selected weapon has no attack action to apply to."); return; }
        overrides[curWeaponId] = {};
        for (const r of curRows) overrides[curWeaponId][r.origName] = { include: r.include, default: r.def, name: r.name };
        await actor.update({ [`flags.${MOD_NS}.overrides`]: overrides });
        await actor.updateEmbeddedDocuments("Item", [upd]);
        const n = curRows.filter(r => r.include).length;
        ui.notifications.info(`Applied ${n} conditional(s) to ${actor.items.get(curWeaponId)?.name}.`);
      });

      // The generator only ever wires its main weapon, so the rollable attack twin and any backup
      // weapon start empty. This applies to every weapon/attack item in one pass -- each with the
      // qualities detected on THAT item, its own action's melee/ranged defaults, and its own saved
      // choices (the selected weapon uses what is on screen, edits included).
      html.on("click", "#apply-all", async ev => {
        ev.preventDefault();
        const updates = [], summary = [];
        for (const w of weapons) {
          const idx = w.id === curWeaponId ? curActionIdx : 0;
          const rows = w.id === curWeaponId ? curRows : rowsFor(w.id, idx);
          const upd = applyToWeapon(actor, w.id, idx, rows, init);
          if (!upd) continue;                      // no attack action on this item
          overrides[w.id] = {};
          for (const r of rows) overrides[w.id][r.origName] = { include: r.include, default: r.def, name: r.name };
          updates.push(upd);
          summary.push(`${w.name}: ${rows.filter(r => r.include).length}`);
        }
        if (!updates.length) { ui.notifications.warn("No weapon/attack item has an attack action to apply to."); return; }
        await actor.update({ [`flags.${MOD_NS}.overrides`]: overrides });
        await actor.updateEmbeddedDocuments("Item", updates);
        ui.notifications.info(`Applied to ${updates.length} item(s) — ${summary.join("; ")}.`);
      });

      // Passive magic-item effects, written to the equipment items rather than to a weapon. Rebuilt
      // on click rather than reused from render time, so a second press after the first sees the
      // items as they now are (and is therefore a no-op instead of a duplicate).
      html.on("click", "#sync-items", async ev => {
        ev.preventDefault();
        const updates = itemEffectUpdates(actor, data);
        if (!updates.length) { ui.notifications.info("Item effects are already in sync."); return; }
        await actor.updateEmbeddedDocuments("Item", updates);
        const added = updates.reduce((n, u) => n + u[`flags.${MOD_NS}.changeIds`].length
                                              + u[`flags.${MOD_NS}.noteTexts`].length, 0);
        ui.notifications.info(`Synced ${added} effect(s) onto ${updates.length} item(s).`);
      });

      renderActionSel();
      renderRows();
    },
  }, { width: 600, resizable: true }).render(true);
}

// --- run: the module's single entry point (see scripts/main.js) ---
// actorArg lets a caller that already knows the actor (e.g. the character-sheet button) skip the
// chooser; passing nothing (macro, scene-control tool, keybinding) falls through to resolveActor().
export async function apply(actorArg = null) {
  try {
    const actor = actorArg ?? await resolveActor();
    if (!actor) return;
    const data = await loadData();
    const init = initAttr(actor);
    const { specs, gaps } = buildSpecs(actor, data, init);
    openDialog(actor, specs, gaps, init, data);
  } catch (err) {
    console.error(`[${MOD_NS}] error:`, err);
    ui.notifications.error(`Apply Conditionals failed: ${err.message}`);
  }
}

// The pure functions build/verify_specs.mjs drives directly.
export { buildSpecs, buildRows, applyToWeapon, weaponQualitySpecs, otherAttackSpecs, detectQualities,
         retargetClassLevel, classTags, nameCandidates, itemEffectUpdate, itemEffectUpdates };
