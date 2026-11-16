/**
 * Apply Conditionals — the working half of the pf1-conditional-applier module.
 *
 * Scans the chosen actor, writes every conditional it finds into a "Conditionals" inventory item
 * (one action per tab: Conditionals / Path of War / SoP / Counters / Spells), and offers the same rows
 * per weapon:
 *   • Active feats                    (feat items by name, incl. "A > B" and "A<Improved<Greater" chains)
 *   • Trainer / profession contents   (description headings, "Profession Rank N: (Job) A, B" name lists)
 *   • Weapon special abilities        (qualities read off the weapon's own description)
 *   • Class-feature toggles           (rage powers, arcana, ki powers, rogue/ninja/slayer talents)
 *   • Path of War maneuvers/stances  ("pf1-pow.maneuver" items, or combat talents named like maneuvers)
 *   • Spheres of Power/Might talents  (actor items flagged flags.pf1spheres.sphere)
 *   • Spells                          (actor items of type "spell", matched by name)
 *       - A self-buffs (Bless, Divine Favor…)   -> +attack/+damage toggle
 *       - B touch-damage (Shocking Grasp…)       -> toggle + the spell's own damage dice
 *       - C debuffs/area (Fireball, Hold Person…)-> toggle carrying save + effect text
 * Every name is looked up in every curated table (resolve). What nothing matches is the curation
 * gap list; in Full mode those also become text-only "Name†: rules line" rows.
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
// Lookup key: norm, plus the spellings hand-typed names drift between -- "Blind Fight" vs
// "Blind-Fight", "Step Up & Strike" vs "Step Up and Strike", "Catch Off Guard" vs "Catch Off-Guard",
// trailing punctuation. Every curated table is indexed under this key.
const nkey = s => norm(String(s == null ? "" : s).replace(/&/g, " and ").replace(/[-_‐–—]/g, " "))
  .replace(/[.,!?…]/g, "").replace(/\s+/g, " ").trim();
const stripSource = n => String(n).replace(/\s*[\(\[][^\)\]]*[\)\]]\s*$/, "").trim();  // "Foo (impale)" -> "Foo"
// Curated class-feature key -- the backend's _cfe_key: drop a trailing (Su)/(Ex)/(Sp), then nkey.
const cfKey = n => nkey(String(n).replace(/\s*\((?:su|ex|sp)\)\s*$/i, ""));
// Chain shorthand: "Vital Strike<Improved<Greater" means Improved / Greater VITAL STRIKE. A bare
// modifier word expands against the last full name in the chain, with that name's own modifier
// dropped first ("Improved Feint<Greater" -> Greater Feint, not Greater Improved Feint).
const MOD_WORDS = new Set(["improved", "greater", "great", "ultimate", "mythic", "superior", "lesser",
                           "advanced"]);
const stripMods = s => {
  const w = String(s).trim().split(/\s+/);
  while (w.length > 1 && MOD_WORDS.has(w[0].toLowerCase())) w.shift();
  return w.join(" ");
};
// A one-word follower that is not a modifier ("Cleave<Finish") is looked up among the known names
// that start or end with that word AND share a 4-letter stem with the chain's base ("Cleaving
// Finish" shares "clea" with Cleave). Only an unambiguous hit is used; anything else stays exactly
// as written ("Mobility", "Manyshot"), so it matches on its own or surfaces in the gap list.
function stemResolve(word, base, known) {
  const w = nkey(word);
  const stems = nkey(stripMods(base)).split(" ").filter(x => x.length >= 4).map(x => x.slice(0, 4));
  if (!stems.length) return null;
  const hits = new Set();
  for (const n of known.names) {
    const ws = nkey(n).split(" ");
    if (ws.length < 2 || (ws[0] !== w && ws[ws.length - 1] !== w)) continue;
    if (ws.some(x => x !== w && stems.includes(x.slice(0, 4)))) hits.add(n);
  }
  return hits.size === 1 ? [...hits][0] : null;
}
// Every name hidden inside ONE feat/class-feature item name. A plain lookup finds none of them,
// because item names are decorated:
//   * a label                    -> "(Feat 1) X", "(Level 5 Story) X", "(Trainer 1): X", "Fighter 6: X"
//   * granted chain feats folded into one item, by the generator (applyFeatTax) as
//     "(Feat 1) Point-Blank Shot (EitR) > Charging Hurler > ... > Bullseye Shot", and by hand as
//     "Vital Strike<Improved<Greater" -- every feat in the chain is one the character really has
//   * a source-book tag          -> "Martial Training I (Sagitta Stellaris)", "Combat Reflexes (Combat)"
//   * "______ Feats ______" divider items, which must match nothing.
// `known` (optional, from buildIndex) enables the shorthand expansion for one-word irregulars.
function nameCandidates(raw, known = null) {
  let s = String(raw == null ? "" : raw).trim();
  if (!s || s.startsWith("_")) return [];                    // section divider
  s = s.replace(/^\([^)]*\)\s*:?\s*/, "");                   // "(Feat 1) " / "(Trainer 1): "
  s = s.replace(/^[A-Za-z][A-Za-z ]*\d*\s*:\s*/, "");        // "Fighter 6: " / "Profession Rank 5: "
  const out = [];
  let base = null;
  for (const part of s.split(/\s*[<>]\s*/)) {
    const p = part.trim();
    if (!p) continue;
    const bare = stripSource(p);                             // drop a trailing "(Sagitta Stellaris)"
    const oneWord = !!bare && !/\s/.test(bare);
    let full = null;
    if (base && oneWord && MOD_WORDS.has(bare.toLowerCase())) full = `${cap(bare.toLowerCase())} ${stripMods(base)}`;
    // Stem first even when the word is itself some name: in "Cleave<Great<Finish" the follower is
    // Cleaving Finish, not the unrelated Spheres talent called "Finish".
    else if (base && oneWord && known) full = stemResolve(bare, base, known);
    if (full) { out.push(full); base = full; continue; }
    out.push(p);
    if (bare && bare !== p) out.push(bare);
    base = bare || p;
  }
  return [...new Set(out)];
}

// --- item descriptions: headings, Benefit lines ---
// Trainer items carry their feats only as headings inside the description, and chain items describe
// each feat of the chain under its own heading. A heading is a short line with no closing
// punctuation that a Prerequisite/Benefit line follows within three lines -- which is what keeps
// "10 Barroom Talents" (a plain note) out.
const RULE_LINE = /^(prerequisites?|benefits?|normal|special)\b/i;
const BENEFIT_PREFIX = /^benefits?\s*(?:\(s\))?\s*:?\s*/i;
function htmlLines(html) {
  return String(html == null ? "" : html)
    .replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1").replace(/@UUID\[[^\]]*\]/g, "")
    .replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|h[1-6]|tr|td)>/gi, "\n").replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&(#0?39|rsquo|lsquo);/g, "'")
    .replace(/&(quot|ldquo|rdquo);/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&[a-z#0-9]+;/gi, " ")
    .split("\n").map(l => l.replace(/\s+/g, " ").trim()).filter(Boolean);
}
// Trim to a readable conditional label; [[ ]] / @ would be evaluated by pf1, so they are flattened.
function clip(s, n = 200) {
  s = String(s || "").replace(/\[\[|\]\]/g, "").replace(/@/g, "").replace(/\s+/g, " ").trim();
  if (s.length <= n) return s;
  const cut = s.slice(0, n);
  return cut.slice(0, Math.max(cut.lastIndexOf(" "), n - 30)).replace(/[,;:\s]+$/, "") + "…";
}
function descEntries(html) {
  const lines = htmlLines(html), out = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.length > 60 || l.split(" ").length > 7 || /[.:;!?,]$/.test(l) || RULE_LINE.test(l)) continue;
    if (!lines.slice(i + 1, i + 4).some(n => /^(prerequisites?|benefits?)\b/i.test(n))) continue;
    const ben = lines.slice(i + 1, i + 6).find(n => /^benefits?\b/i.test(n));
    const name = stripSource(l);
    if (name) out.push({ name, text: clip(ben ? ben.replace(BENEFIT_PREFIX, "") : lines[i + 1]) });
  }
  return out;
}
// One line of rules text for an item: its Benefit line, else its first prose line (a sentence, not
// a sub-heading like "Fleet Charge (Ex)").
function benefitOf(html) {
  const ls = htmlLines(html);
  const b = ls.find(l => /^benefits?\b/i.test(l));
  if (b) return clip(b.replace(BENEFIT_PREFIX, ""));
  const prose = l => !/^level\s*:/i.test(l) && !RULE_LINE.test(l);
  return clip(ls.find(l => prose(l) && (l.length > 40 || /[.!?]$/.test(l))) || ls.find(prose) || "");
}
// Feat-type tags that are not part of the name: "Combat Reflexes (Combat)" -> "Combat Reflexes".
// Other parentheses stay ("Unarmed Strike (BRA)", "Field Instruction (Exemplar)" say which one).
const stripFeatTag = n => String(n).replace(/\s*\((?:combat|style|teamwork|critical|general|human|ki|metamagic|story|grit|panache|performance|mythic)(?:\s*,[^)]*)?\)\s*$/i, "").trim();

// --- maneuver markers in item names ---
// The table stores Path of War maneuvers as combatTalent items named "(Lvl 2 Maneuver) Bronze
// Knuckle - Boost" or "(Stance) Iron Hand Stance" (filed under whatever sphere pf1spheres defaulted
// to), and counter talents as "Disarming Jab (Counter)". Read those markers off, return the clean name.
const MTYPES = ["Boost", "Stance", "Strike", "Counter"];
const MRANK = { Boost: 0, Stance: 1, Strike: 2, Counter: 3 };
function parseMarkedName(raw) {
  let s = String(raw == null ? "" : raw).trim();
  const hints = {};
  const lab = s.match(/^\(([^)]*)\)\s*:?\s*/);
  if (lab) {
    const L = lab[1].trim();
    const t = MTYPES.find(x => x.toLowerCase() === L.toLowerCase());
    if (t) { hints.maneuver = true; hints.mType = t; }
    if (/\bmaneuver\b/i.test(L)) {
      hints.maneuver = true;
      const lv = L.match(/\b(?:lvl|level)\.?\s*(\d+)/i);
      if (lv) hints.level = +lv[1];
    }
    if (/\bcounter\b/i.test(L)) hints.counter = true;          // "(Counter)", "(Mythic Counter)"
    s = s.slice(lab[0].length);
  }
  const suf = s.match(/\s+-\s+(Boost|Stance|Strike|Counter)\s*$/i);
  if (suf) { hints.maneuver = true; hints.mType = cap(suf[1].toLowerCase()); s = s.slice(0, suf.index); }
  const ctr = s.match(/\s*\(counter\)\s*$/i);
  if (ctr) { hints.counter = true; s = s.slice(0, ctr.index); }
  if (hints.mType === "Counter") hints.counter = true;
  return { name: s.trim(), hints };
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
// First damage part's formula of the action a conditional is applied to -- the weapon's base dice.
// Resolves "as-weapon-dice" formula placeholders (Vital Strike chain: extra rolls of THIS weapon's
// dice). Same part-walk as weaponDamageTypes; empty when the action has no damage parts.
const weaponBaseDice = (action) => {
  for (const p of ((action && action.system && action.system.damage && action.system.damage.parts)
                   || (action && action.damage && action.damage.parts) || [])) {
    const f = p && (p.formula != null ? p.formula : p[0]);
    if (f) return String(f);
  }
  return "";
};
function mkMod(m, srcName, seed, idx, init, weaponTypes, weaponDice) {
  const isAttack = m.target === "attack";
  let formula = String(m.formula == null ? "" : m.formula);
  if (formula.includes("as-weapon-dice"))
    formula = formula.replaceAll("as-weapon-dice", weaponDice ? `(${weaponDice})` : "0");
  return {
    _id: detId(`${seed}|m${idx}`, 8),
    formula: labelFormula(formula, srcName, init),
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
                    "weapon_quality_conditionals", "class_feature_conditionals", "item_changes",
                    "maneuver_index", "local_conditionals"];
async function loadData() {
  const out = {};
  await Promise.all(DATA_FILES.map(async f => {
    const res = await fetch(`modules/${MOD_NS}/data/${f}.json`);
    if (!res.ok) throw new Error(`data/${f}.json -> HTTP ${res.status} (module install incomplete?)`);
    out[f] = await res.json();
  }));
  return out;
}

// --- one lookup over every curated table ---
// Names reach us from many places (feat items, chains, trainer/profession text, combat talents that
// are really maneuvers), so a name is looked up in ALL tables; the item's own markers only break
// ties (resolve). Built per run -- cheap next to the fetch, and keeps the module stateless.
function buildIndex(data) {
  const feats = new Map(), cfs = new Map(), mans = new Map(), tals = new Map(), meta = new Map();
  const passive = new Map(), spheres = new Set();
  const local = data.local_conditionals || {};
  for (const [k, v] of Object.entries(data.feat_conditionals || {})) feats.set(nkey(k), { key: k, entry: v });
  // Class-feature sections are flattened: the rogue/ninja/slayer duplicates are identical, and the
  // item name carries no bucket to key on beyond the label nameCandidates() removes.
  for (const pool of [...Object.values(data.class_feature_conditionals || {}), local.classFeatures || {}])
    for (const [k, v] of Object.entries(pool || {})) cfs.set(cfKey(k), { key: k, conds: v });
  for (const [k, v] of Object.entries(data.maneuver_changes || {})) mans.set(nkey(k), { key: k, entry: v });
  for (const [family, tbl] of [["combat", data.combat_talent_conditionals], ["magic", data.magic_talent_conditionals]])
    for (const [sphere, talents] of Object.entries(tbl || {})) {
      spheres.add(nkey(sphere));
      for (const [tn, e] of Object.entries(talents || {})) {
        const k = nkey(tn);
        if (!tals.has(k)) tals.set(k, []);
        tals.get(k).push({ key: tn, sphere, family, entry: e });
      }
    }
  const disciplines = new Set();
  for (const [k, v] of Object.entries(data.maneuver_index || {})) {
    meta.set(nkey(v?.name || k), v);
    if (v?.discipline) disciplines.add(nkey(v.discipline));
  }
  for (const [k, v] of Object.entries(local.passive || {})) passive.set(nkey(k), { key: k, why: String(v || "") });
  const names = [...[...feats.values()].map(x => x.key), ...[...mans.values()].map(x => x.key),
                 ...[...tals.values()].flat().map(x => x.key), ...[...meta.values()].map(m => m.name)];
  const all = new Set([...feats.keys(), ...cfs.keys(), ...mans.keys(), ...tals.keys(), ...meta.keys(), ...passive.keys()]);
  return { feats, cfs, mans, tals, meta, passive, spheres, disciplines, known: { names, has: k => all.has(k) } };
}
// A maneuver marker means maneuver first, a sphere flag means that sphere's talent first, otherwise
// feat -> class feature -> maneuver -> talent. Only 7 of ~2,250 curated names live in two tables.
function resolve(name, hints, idx) {
  const tryKey = (k, kc) => {
    const tal = () => {
      const l = idx.tals.get(k);
      if (!l) return null;
      const want = hints.sphere ? nkey(hints.sphere) : null;
      return { kind: "talent", ...((want && l.find(x => nkey(x.sphere) === want)) || l[0]) };
    };
    const man = () => idx.mans.has(k) ? { kind: "maneuver", ...idx.mans.get(k) } : null;
    const feat = () => idx.feats.has(k) ? { kind: "feat", ...idx.feats.get(k) } : null;
    const cf = () => idx.cfs.has(kc) ? { kind: "classFeature", ...idx.cfs.get(kc) } : null;
    // A trait only ever matches a feat row: "(Trait) Brawler" is not the barbarian rage power; and a
    // talent/maneuver is never a class feature that happens to share its name ("Haymaker").
    const order = hints.trait ? [feat]
      : hints.maneuver ? [man, tal, feat] : (hints.sphere || hints.talent) ? [tal, man, feat] : [feat, cf, man, tal];
    for (const f of order) { const r = f(); if (r) return r; }
    return null;
  };
  const r = tryKey(nkey(name), cfKey(name));
  if (r) return r;
  const bare = stripSource(name);
  return bare && bare !== name ? tryKey(nkey(bare), cfKey(bare)) : null;
}

// Trainer / profession items are containers: what they grant is listed in their name
// ("Profession Rank 5: (Pit Fighter) Duelist Sphere, Debilitating Injuries") or under headings in
// their description ("Trainer: Style Training" -> Street Style, Pummeling Style, ...).
const isContainer = n => /^trainer\b/i.test(n) || /^\([^)]*\btrainer\b[^)]*\)/i.test(n) || /^profession\s+rank\b/i.test(n);
// Uncurated feat-ish items that are bookkeeping, not abilities -- never offered as Full-mode rows.
const NOT_AN_ABILITY = /\b(pool|hp|total|accounting)\b|\(null\)|^(mythic feats|mythic qualities|path abilities)$/i;

// Every (name, hints, item, text) the actor carries, from every place a name can hide.
function collectSources(actor, idx) {
  const out = [];
  for (const it of actor.items) {
    const html = it.system?.description?.value;
    if (it.type === "pf1-pow.maneuver") {
      const { name, hints } = parseMarkedName(it.name);
      hints.maneuver = true;
      const t = String(it.system?.maneuverType || "");
      if (!hints.mType && t) hints.mType = cap(t.toLowerCase());
      if (hints.mType === "Counter") hints.counter = true;
      if (hints.level == null && Number.isFinite(Number(it.system?.level))) hints.level = Number(it.system.level);
      out.push({ name, hints, item: it, text: benefitOf(html), origin: "item" });
      continue;
    }
    if (it.type !== "feat" || String(it.name || "").trim().startsWith("_")) continue;   // + dividers
    const sph = it.flags?.pf1spheres?.sphere;
    const sub = it.system?.subType;
    if (sph || sub === "combatTalent" || sub === "magicTalent") {
      const { name, hints } = parseMarkedName(it.name);
      if (sph && !hints.maneuver) hints.sphere = sph;
      if (!hints.maneuver) hints.talent = true;
      out.push({ name, hints, item: it, text: benefitOf(html), origin: "item" });
      continue;
    }
    if (isContainer(it.name)) {
      const lab = it.name.match(/^\([^)]*\)\s*:?\s*/);
      let list = lab ? it.name.slice(lab[0].length)
                     : (/^profession/i.test(it.name) ? it.name.replace(/^[^:]*:\s*/, "") : "");
      list = list.replace(/^\([^)]*\)\s*/, "");                 // "(Pit Fighter) "
      for (const part of list.split(/\s*,\s*/))
        for (const n of nameCandidates(part, idx.known)) {
          if (!n || /\bsphere$/i.test(n) || idx.spheres.has(nkey(n))) continue;   // a sphere, not a talent
          out.push({ name: n, hints: {}, item: it, text: "", origin: "container" });
        }
      for (const e of descEntries(html)) out.push({ name: e.name, hints: {}, item: it, text: e.text, origin: "container" });
      continue;
    }
    const heads = new Map(descEntries(html).map(e => [nkey(e.name), e.text]));
    nameCandidates(it.name, idx.known).forEach((n, i) => out.push({
      name: n, hints: sub === "trait" ? { trait: true } : {}, item: it, origin: i === 0 ? "item" : "chain",
      text: heads.get(nkey(stripSource(n))) ?? heads.get(nkey(n)) ?? (i === 0 ? benefitOf(html) : ""),
    }));
  }
  return out;
}

// Section order on a weapon (and the order specs come back in).
const RANK = { "Feats": 0, "Weapon Qualities": 1, "Items": 2, "Class Features": 3, "Path of War": 4,
               "Spheres of Power/Might": 5, "Spells": 6, "Uncurated": 7, "On Other Attacks": 8 };

// --- build the weapon-independent conditional specs from what the actor knows ---
// A spec: {name, default, rawMods, srcName, section, tab, curated, passive?, buffOnly?, counter?,
// weaponType?, mType?, level?}. curated:false = a gap or a passive ability -- only offered in Full
// mode, as a text-only "Name†: rules line" row. `tab` is its action on the Conditionals item.
function buildSpecs(actor, data, init) {
  const specs = [];
  const gaps = { maneuvers: [], talents: [], spells: [], qualities: [], classFeatures: [], feats: [] };
  const subSph = makeSubSph(actor);              // @spheres.* -> concrete forms for a dabbler (else no-op)
  const idx = buildIndex(data);
  const tags = classTags(actor);
  // Dedupe on the conditional name, which is what actually lands on the weapon: a chain feat granted
  // twice, a talent listed by a trainer AND owned as an item. A repeat can still mark it a counter.
  const byName = new Map();
  const push = s => {
    const prev = byName.get(s.name);
    if (prev) { prev.counter = prev.counter || !!s.counter; return; }
    s.ord = specs.length;
    byName.set(s.name, s);
    specs.push(s);
  };
  const gapSeen = new Set();
  const gapPush = (list, label) => { if (!list.includes(label)) list.push(label); };

  // Active-feat toggles (Power Attack, Deadly Aim, Combat Expertise, ...) and class-feature toggles
  // (rage powers, magus arcana, ki powers, rogue/ninja/slayer talents). The generator attaches the
  // feat ones to its main weapon only (addFeatConditionals) and never attaches the class-feature
  // ones at all, so this is the only path that puts either on the attack twin or a second weapon.
  const emitFeat = (src, r) => {
    const e = r.entry;
    if (!e || !e.name) return;
    push({ name: e.name, default: !!e.default, rawMods: e.modifiers || [], srcName: prefixOf(e.name),
           section: "Feats", tab: "Conditionals", curated: true, counter: !!src.hints.counter,
           weaponType: specWeaponType(e.name) });
  };
  const emitClassFeature = (src, r) => {
    for (const cond of (r.conds || [])) {
      const resolved = [retargetClassLevel(cond.name || src.name, tags)];
      const rawMods = (cond.modifiers || []).map(m => {
        const rr = retargetClassLevel(m.formula, tags);
        resolved.push(rr);
        return { ...m, formula: rr.text };
      });
      if (resolved.some(x => !x.ok)) {            // no class on this actor resolves its level
        gapPush(gaps.classFeatures, `${src.item.name}  (unresolved class level)`);
        continue;
      }
      push({ name: resolved[0].text, default: !!cond.default, rawMods, srcName: prefixOf(resolved[0].text),
             section: "Class Features", tab: "Conditionals", curated: true, counter: !!src.hints.counter,
             weaponType: specWeaponType(resolved[0].text) });
    }
  };
  // Path of War: named "(Type) Name: rider". A stance with no modifiers is a pure buff -- it belongs
  // on a buff, not an attack, so it rides the Conditionals item as a reminder but never a weapon.
  const maneuverMeta = (src, key) => {
    const m = idx.meta.get(nkey(key)) || idx.meta.get(nkey(src.name)) || {};
    const mType = src.hints.mType || m.type || null;
    return { mType, level: src.hints.level ?? m.level ?? null, text: m.text || "" };
  };
  const emitManeuver = (src, r) => {
    const e = r.entry || {};
    const rider = typeof e.rider === "string" ? e.rider.trim() : "";
    const hasMods = Array.isArray(e.modifiers) && e.modifiers.length;
    if (!rider && !hasMods) return false;
    const { mType, level } = maneuverMeta(src, r.key);
    const label = `(${mType || "Maneuver"}) ${src.name}`;
    const isStance = mType === "Stance";
    push({ name: rider ? `${label}: ${subInit(rider, init)}` : label, default: isStance && !!hasMods,
           rawMods: e.modifiers || [], srcName: src.name, section: "Path of War", tab: "Path of War",
           curated: true, buffOnly: isStance && !hasMods, counter: !!src.hints.counter || mType === "Counter",
           mType, level });
    return true;
  };
  // Spheres of Power/Might talents, "(SoP) Name: rider" for both families.
  const emitTalent = (src, r) => {
    const e = r.entry || {};
    const rider = typeof e.rider === "string" ? e.rider.trim() : "";
    const hasMods = Array.isArray(e.modifiers) && e.modifiers.length;
    if (!rider && !hasMods) return false;
    const label = `(SoP) ${src.name}`;
    push({ name: rider ? `${label}: ${subInit(subSph(rider), init)}` : label, default: !!e.default,
           rawMods: (e.modifiers || []).map(m => ({ ...m, formula: subSph(m.formula) })),
           srcName: src.name, section: "Spheres of Power/Might", tab: "SoP", curated: true,
           counter: !!src.hints.counter });
    return true;
  };
  // A name nothing curated covers (or a known passive). Full mode only, text only, marked †.
  const emitGap = (src, passive) => {
    const k = nkey(stripSource(src.name));
    if (!k || gapSeen.has(k)) return;
    if (!passive && (idx.disciplines.has(k) || idx.spheres.has(k))) return;    // a discipline/sphere, not an ability
    const meta = idx.meta.get(k);
    const kind = src.hints.maneuver || meta ? "maneuver"
               : (src.hints.talent || src.hints.sphere) ? "talent" : "feat";
    if (!passive && (NOT_AN_ABILITY.test(src.name)
                     || (src.origin !== "container" && NOT_AN_ABILITY.test(src.item.name)))) return;
    if (kind === "feat" && !passive) {
      if (["trait", "misc", "template", "racial"].includes(src.item.system?.subType)) return;
      if (src.origin === "item" && !src.text && src.item.type === "feat"
          && !/[<>]/.test(src.item.name)) return;             // an empty, chainless bookkeeping item
    }
    gapSeen.add(k);
    // A maneuver's own item text is usually its stat header ("Discipline: ...; Level: 1"), so the
    // discipline book's first sentence reads better.
    const text = passive ? passive.why
      : (kind === "maneuver" && meta?.text ? clip(meta.text) : (src.text || (meta && clip(meta.text)) || ""));
    const mark = passive ? " (passive)" : "†";
    const tail = text ? `: ${text}` : "";
    if (kind === "maneuver") {
      const { mType, level } = maneuverMeta(src, src.name);
      if (!passive) gapPush(gaps.maneuvers, src.name);
      push({ name: `(${mType || "Maneuver"}) ${src.name}${mark}${tail}`, default: false, rawMods: [],
             srcName: src.name, section: "Path of War", tab: "Path of War", curated: false, passive: !!passive,
             counter: !!src.hints.counter || mType === "Counter", mType, level });
    } else if (kind === "talent") {
      if (!passive) gapPush(gaps.talents, src.name);
      push({ name: `(SoP) ${src.name}${mark}${tail}`, default: false, rawMods: [], srcName: src.name,
             section: "Spheres of Power/Might", tab: "SoP", curated: false, passive: !!passive,
             counter: !!src.hints.counter });
    } else {
      const shown = stripFeatTag(src.name);
      if (!passive) gapPush(gaps.feats, shown);
      push({ name: `${shown}${mark}${tail}`, default: false, rawMods: [], srcName: shown,
             section: "Uncurated", tab: "Conditionals", curated: false, passive: !!passive,
             counter: !!src.hints.counter });
    }
  };

  // Resolve everything first, so a name resolved through ANY of its spellings ("Point-Blank Shot
  // (EitR)" vs "Point-Blank Shot") or ANY source is never also reported as a gap.
  const sources = collectSources(actor, idx);
  // A name a chain or trainer lists that the actor ALSO owns as a talent/maneuver item ("Haymaker",
  // "Defensive Slice") is that talent/maneuver -- borrow the item's hints, so it neither resolves to
  // an unrelated class feature of the same name nor lands among the uncurated feats.
  const hintByKey = new Map();
  for (const s of sources) {
    const k = nkey(stripSource(s.name));
    if ((s.hints.talent || s.hints.maneuver) && !hintByKey.has(k)) hintByKey.set(k, s.hints);
  }
  for (const s of sources) {
    if (s.hints.talent || s.hints.maneuver || s.hints.trait) continue;
    const h = hintByKey.get(nkey(stripSource(s.name)));
    if (h) s.hints = { ...h, ...s.hints };
  }
  const resolvedKeys = new Set(), pending = [];
  for (const src of sources) {
    const k = nkey(stripSource(src.name));
    const pas = idx.passive.get(k) || idx.passive.get(nkey(src.name));
    if (pas) { pending.push({ src, passive: pas }); resolvedKeys.add(k); continue; }
    const r = resolve(src.name, src.hints, idx);
    let ok = !!r;
    if (r?.kind === "feat") emitFeat(src, r);
    else if (r?.kind === "classFeature") emitClassFeature(src, r);
    else if (r?.kind === "maneuver") ok = emitManeuver(src, r);
    else if (r?.kind === "talent") ok = emitTalent(src, r);
    if (ok) resolvedKeys.add(k);
    else pending.push({ src });
  }
  for (const { src, passive } of pending) {
    if (!passive && resolvedKeys.has(nkey(stripSource(src.name)))) continue;
    emitGap(src, passive);
  }

  // Magic-item activations. A curated item's contextNotes targeting "attack" are activation text
  // (Swordmaster's Shirt, Battle Strider's Boots) -- pf1 would print them in full on EVERY attack
  // chat card if they rode the item, so they become default-off toggles here instead, exactly as the
  // generator's addItemAttackConditionals() does. Name-only riders: the [[ ]] inline rolls are
  // already baked in by the backend, so there is nothing to source-label and no modifiers to build.
  // The item's non-attack changes/notes are a different job -- see syncItemEffects().
  for (const it of actor.items) {
    for (const note of itemAttackNotes(it, data)) {
      push({ name: `(${it.name}): ${note}`, default: false, rawMods: [], srcName: it.name,
             section: "Items", tab: "Conditionals", curated: true });
    }
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
    if (!A && !BC) {
      gaps.spells.push(`${it.name}  (${cls})`);
      const text = benefitOf(it.system?.description?.value);
      push({ name: `${it.name}†${text ? `: ${text}` : ""}`, default: false, rawMods: [], srcName: it.name,
             section: "Spells", tab: "Spells", curated: false });
      continue;
    }
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
      push({ name: subSpell(name, it, actor), default: false,
        rawMods: rawMods.map(m => ({ ...m, formula: subSpell(m.formula, it, actor) })),
        srcName: String(A.name).split(":")[0], section: "Spells", tab: "Spells", curated: true });
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
      push({ name: subSpell(riderText ? `${BC.name}: ${subInit(riderText, init)}` : BC.name, it, actor),
        default: false, rawMods, srcName: BC.name, section: "Spells", tab: "Spells", curated: true });
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

  // Section order, curated before uncurated, and Path of War Boost -> Stance -> Strike -> Counter by
  // level then name. Everything else keeps the order it was found in (the actor's item order).
  const mr = s => MRANK[s.mType] ?? 4;
  specs.sort((a, b) => ((RANK[a.section] ?? 9) - (RANK[b.section] ?? 9))
    || ((a.curated === false) - (b.curated === false))
    || (a.section === "Path of War"
        ? (mr(a) - mr(b)) || ((a.level ?? 99) - (b.level ?? 99)) || String(a.srcName).localeCompare(String(b.srcName))
        : 0)
    || (a.ord - b.ord));
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
    if (!(it.type === "weapon" || it.type === "attack") || isConditionalsItem(it)) continue;
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

// Bespoke shows curated rows only; Full adds the gaps and passives (the "Name†: rules line" rows).
const actorMode = actor => (actor?.flags?.[MOD_NS]?.mode === "full" ? "full" : "bespoke");
const inMode = (s, mode) => mode === "full" || s.curated !== false;

// Editable row state for ONE weapon+action: the actor-wide specs, that weapon's own quality rows,
// the "On Other Attacks" rows, and any saved overrides on top. A row is unchecked by default when
// its melee/ranged intent contradicts the action's; a saved override always wins over both.
// Buff-only stances never reach a weapon (they ride the Conditionals item as reminders).
function buildRows(actor, specs, data, overrides, weaponId, actionIdx, mode = "bespoke") {
  const ov = overrides[weaponId] || {};
  const w = actor.items.get(weaponId);
  const actions = w?.system?.actions || [];
  const aType = actionWeaponType(actions[actionIdx] || actions[0]);
  const base = specs.filter(s => !s.buffOnly && inMode(s, mode));
  const qSpecs = weaponQualitySpecs(actor, weaponId, data);
  const others = otherAttackSpecs(actor, specs, weaponId, qSpecs.map(s => prefixOf(s.name)));
  return base.concat(qSpecs, others).map(s => {
    const o = ov[s.name] || {};
    const mismatch = !!(s.weaponType && aType && s.weaponType !== aType);
    const defInclude = s._defaultInclude !== undefined ? s._defaultInclude : !mismatch;
    return {
      origName: s.name, srcName: s.srcName, rawMods: s.rawMods, section: s.section,
      curated: s.curated !== false,
      include: o.include !== undefined ? o.include : defInclude,
      def: o.default !== undefined ? o.default : !!s.default,
      name: o.name !== undefined ? o.name : s.name,
    };
  });
}

// Sections the module rebuilds from curated source data that the GENERATOR also writes (or, for
// class features, would write) verbatim onto its main weapon -- the only ones eligible for the
// adopt-if-verbatim handling in applyRowsToAction. "Items" belongs here because
// addItemAttackConditionals() writes the identical "(Item Name): text" rows at generation time.
const ADOPT_SECTIONS = new Set(["Feats", "Weapon Qualities", "Class Features", "Items"]);

// Inert section dividers (empty modifiers => an unchecked checkbox that does nothing) so the long
// attack-dialog list reads as grouped: Other -> Feats -> Qualities -> Items -> Class Features ->
// PoW -> Spheres -> Spells -> Uncurated -> Other Attacks.
const EXISTING_LABEL = "──────  OTHER (EXISTING)  ──────";
const UNCURATED_LABEL = "──────  UNCURATED  ──────";
const SECT_LABEL = {
  "Feats": "──────  FEATS  ──────",
  "Weapon Qualities": "──────  WEAPON QUALITIES  ──────",
  "Items": "──────  ITEMS  ──────",
  "Class Features": "──────  CLASS FEATURES  ──────",
  "Path of War": "──────  PATH OF WAR  ──────",
  "Spheres of Power/Might": "──────  SPHERES  ──────",
  "Spells": "──────  SPELLS  ──────",
  "Uncurated": UNCURATED_LABEL,
  "On Other Attacks": "──────  FROM OTHER ATTACKS  ──────",
};

// --- write the chosen rows into ONE action's conditionals, idempotently (mutates `action`) ---
// Shared by the weapons and the Conditionals item. Returns the ids this run owns, which the caller
// stores so the next run can strip exactly those and nothing hand-made.
//   layout "weapon": an OTHER (EXISTING) header over what survives, a divider per section, rows in
//                    section order.
//   layout "item":   rows in the order given (one tab of the Conditionals item), no header, and a
//                    single UNCURATED divider before the first uncurated row.
function applyRowsToAction(action, rows, { seedBase, init, prevIds, layout = "weapon" }) {
  const wpnTypes = weaponDamageTypes(action);   // resolves ["as-weapon"] modifiers to this weapon's type
  const wpnDice = weaponBaseDice(action);       // resolves "as-weapon-dice" formulas to this weapon's dice
  if (!Array.isArray(action.conditionals)) action.conditionals = [];
  action.conditionals = action.conditionals.filter(c => !(c && prevIds.has(c._id)));   // drop our old ones

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
  // Compared without the uncurated/passive marks, so "(SoP) Sweep†" defers to your "(SoP) Sweep: ...".
  const rowKey = n => nkey(prefixOf(n).replace(/†|\s*\(passive\)\s*$/g, ""));
  const keptPrefixes = new Set(action.conditionals.map(c => rowKey(c && c.name)));
  const newIds = [];
  const sep = (seed, name) => {
    const sid = detId(seed, 8);
    newIds.push(sid);
    return { _id: sid, name, default: false, modifiers: [] };
  };

  // A header above whatever the macro does NOT own: hand-authored conditionals, generator rows you
  // edited (so adoption skipped them), and families this macro doesn't curate. Only when some
  // survive, so a weapon whose conditionals were all adopted gets no empty header.
  if (layout === "weapon" && action.conditionals.length) {
    action.conditionals.unshift(sep(`${seedBase}|__sep__|general`, EXISTING_LABEL));
  }

  // Enforce the section order on a weapon (natural spec order already matches; this makes it robust).
  const ordered = layout === "weapon"
    ? rows.map((r, i) => ({ r, i }))
        .sort((a, b) => ((RANK[a.r.section] ?? 9) - (RANK[b.r.section] ?? 9)) || (a.i - b.i))
        .map(x => x.r)
    : rows;

  let curSection = null, uncuratedShown = false;
  for (const r of ordered) {
    if (!r.include || !r.name || seen.has(r.name)) continue;
    // A row you already have by hand (or an edited generator row that survived adoption) under the
    // same "Name" before the colon -- e.g. "(Boost) Bronze Knuckle: <your wording>" -- wins; don't
    // stack a near-duplicate next to it.
    if (keptPrefixes.has(rowKey(r.origName)) || keptPrefixes.has(rowKey(r.name))) continue;
    if (layout === "weapon") {
      if (r.section && r.section !== curSection && SECT_LABEL[r.section]) {   // first row of a section
        curSection = r.section;
        action.conditionals.push(sep(`${seedBase}|__sep__|${r.section}`, SECT_LABEL[r.section]));
      }
    } else if (r.curated === false && !uncuratedShown) {
      uncuratedShown = true;
      action.conditionals.push(sep(`${seedBase}|__sep__|uncurated`, UNCURATED_LABEL));
    }
    seen.add(r.name);
    const seed = `${seedBase}|${r.origName}`;                 // seed on the STABLE build-time name
    const cid = detId(seed, 8);
    action.conditionals.push({
      _id: cid, name: r.name, default: !!r.def,
      modifiers: (r.rawMods || []).map((m, i) => mkMod(m, r.srcName, seed, i, init, wpnTypes, wpnDice)),
    });
    newIds.push(cid);
  }
  return newIds;
}

// --- apply the chosen rows to ONE weapon's chosen action, idempotently ---
// Returns the embedded-document update object, or null if the weapon/action is unusable.
function applyToWeapon(actor, weaponId, actionIdx, rows, init) {
  const w = actor.items.get(weaponId);
  if (!w) return null;
  const src = w.toObject();
  const actions = src.system?.actions || [];
  const action = actions[actionIdx] || actions[0];
  if (!action) return null;
  const prevIds = new Set((src.flags?.[MOD_NS]?.condIds) || []);
  const newIds = applyRowsToAction(action, rows, { seedBase: weaponId, init, prevIds, layout: "weapon" });
  return { _id: weaponId, "system.actions": actions, [`flags.${MOD_NS}.condIds`]: newIds };
}

// --- the "Conditionals" inventory item: every conditional the actor has, one action per tab ---
// Modelled on the hand-built one the table already uses: a weapon whose actions are tabs
// (Conditionals / Path of War / SoP / Counters / Spells), each a mwak dealing a flat 1 so it can be
// rolled for its riders. Counters holds copies of every counter (PoW Counter maneuvers and anything
// marked "(Counter)") on top of their own tab. A tab is only created once it has rows; an existing
// item (found by our flag, else by the exact name) is adopted -- its hand-made rows are kept and win
// over ours, same rules as on a weapon.
const COND_ITEM_NAME = "Conditionals";
const COND_KEY = "__conditionals__";            // its key in the overrides flag (id-independent)
const COND_TABS = ["Conditionals", "Path of War", "SoP", "Counters", "Spells"];
const isConditionalsItem = it => !!it && (it.flags?.[MOD_NS]?.conditionalsItem === true
  || (it.name === COND_ITEM_NAME && (it.type === "weapon" || it.type === "attack")));
const findConditionalsItem = actor =>
  actor.items.find(it => it.flags?.[MOD_NS]?.conditionalsItem === true)
  || actor.items.find(it => it.name === COND_ITEM_NAME && (it.type === "weapon" || it.type === "attack"))
  || null;
const newCondAction = tab => ({
  _id: detId(`${COND_KEY}|action|${tab}`, 16), name: tab, actionType: "mwak",
  activation: { type: "nonaction", cost: 1, unchained: { type: "nonaction", cost: 1 } },
  damage: { parts: [{ formula: "1", types: ["slashing", "piercing", "bludgeoning"] }] },
  ability: { attack: "str", damage: "str", critRange: 20, critMult: 2 },
  conditionals: [],
});
const newConditionalsItem = () => ({
  name: COND_ITEM_NAME, type: "weapon", img: "icons/svg/book.svg",
  system: { subType: "simple", weaponSubtype: "light", quantity: 1, weight: { value: 0 }, price: 0,
            equipped: true, carried: true, identified: true, proficient: true, actions: [] },
  flags: { [MOD_NS]: { conditionalsItem: true } },
});

// Editable row state for the Conditionals item (every tab at once), saved overrides on top.
function conditionalsItemRows(specs, overrides, mode = "bespoke") {
  const ov = overrides[COND_KEY] || {};
  return specs.filter(s => s.tab && inMode(s, mode)).map(s => {
    const o = ov[s.name] || {};
    return {
      origName: s.name, srcName: s.srcName, rawMods: s.rawMods, section: s.section, tab: s.tab,
      counter: !!s.counter, curated: s.curated !== false,
      include: o.include !== undefined ? o.include : true,
      def: o.default !== undefined ? o.default : !!s.default,
      name: o.name !== undefined ? o.name : s.name,
    };
  });
}

// Pure: returns {create: itemData} for a new item or {update: {...}} for an existing one.
// `rows` defaults to conditionalsItemRows(specs, overrides, mode); the dialog passes its live edits.
function conditionalsItemUpdate(actor, specs, overrides, mode, init, rows = null) {
  const existing = findConditionalsItem(actor);
  const src = existing ? existing.toObject() : newConditionalsItem();
  src.system = src.system || {};
  const actions = (src.system.actions = Array.isArray(src.system.actions) ? src.system.actions : []);
  const prevBy = existing?.flags?.[MOD_NS]?.condIdsByAction || {};
  const all = rows || conditionalsItemRows(specs, overrides, mode);
  const idsBy = {};
  for (const tab of COND_TABS) {
    // Curated first (a stable partition keeps the spec order inside each half).
    const tabRows = all.filter(r => (tab === "Counters" ? r.counter : r.tab === tab))
      .map((r, i) => ({ r, i })).sort((a, b) => ((a.r.curated === false) - (b.r.curated === false)) || (a.i - b.i))
      .map(x => x.r);
    let action = actions.find(a => a && a.name === tab);
    if (!action) {
      if (!tabRows.some(r => r.include)) continue;
      action = newCondAction(tab);
      actions.push(action);
    }
    idsBy[tab] = applyRowsToAction(action, tabRows, {
      seedBase: `${COND_KEY}|${tab}`, init, prevIds: new Set(prevBy[tab] || []), layout: "item" });
  }
  if (!existing) {
    src.flags = { ...(src.flags || {}), [MOD_NS]: { conditionalsItem: true, condIdsByAction: idsBy } };
    return { create: src };
  }
  return { update: { _id: existing.id, "system.actions": actions,
                     [`flags.${MOD_NS}.conditionalsItem`]: true,
                     [`flags.${MOD_NS}.condIdsByAction`]: idsBy } };
}

// Write it. The only Foundry-touching half; everything above is pure.
async function pushConditionalsItem(actor, specs, overrides, mode, init, rows = null) {
  const r = conditionalsItemUpdate(actor, specs, overrides, mode, init, rows);
  if (r.create) await actor.createEmbeddedDocuments("Item", [r.create]);
  else await actor.updateEmbeddedDocuments("Item", [r.update]);
  return r;
}

// --- the review/edit dialog (stays open; edits persist to an actor flag) ---
// The selector's first entry is the Conditionals item itself (every tab at once); the rest are the
// actor's real weapons/attacks. The Bespoke/Full switch is remembered per actor and re-pushes the
// Conditionals item straight away.
function openDialog(actor, specs, gaps, init, data, startMode = "bespoke") {
  const esc = s => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const weapons = actor.items.filter(i => (i.type === "weapon" || i.type === "attack") && !isConditionalsItem(i));
  // Persisted overrides: { [weaponId | COND_KEY]: { [origName]: {include, default, name} } }.
  // Read/write the RAW flags object rather than getFlag/setFlag: the write below is batched into the
  // same actor.update() as the rest, and the raw path is what the pre-module macro versions wrote —
  // MOD_NS is the module id, so flags saved back then are still read here unchanged.
  const overrides = foundry.utils.deepClone(actor.flags?.[MOD_NS]?.overrides || {});
  let mode = startMode;

  // Build the editable row state for the current selection.
  const tabRank = r => { const i = COND_TABS.indexOf(r.tab); return i < 0 ? 99 : i; };
  const rowsFor = (id, actionIdx) => id === COND_KEY
    ? conditionalsItemRows(specs, overrides, mode).map((r, i) => ({ r, i }))
        .sort((a, b) => (tabRank(a.r) - tabRank(b.r)) || (a.i - b.i)).map(x => x.r)
    : buildRows(actor, specs, data, overrides, id, actionIdx, mode);
  // Merge rather than replace: rows hidden by the current mode keep their saved choices.
  const remember = (id, rows) => {
    overrides[id] = { ...(overrides[id] || {}) };
    for (const r of rows) overrides[id][r.origName] = { include: r.include, default: r.def, name: r.name };
  };

  let curWeaponId = COND_KEY, curActionIdx = 0, curRows = [];
  const groupOf = r => (curWeaponId === COND_KEY ? r.tab : r.section) || "Other";

  const rowHtml = (r, i) => {
    const mods = (r.rawMods || []).map(m => `${m.formula} → ${m.target}`).join(", ") || "—";
    const editable = String(r.name).split("; ").join(";\n");   // one clause per line for editing
    const also = curWeaponId === COND_KEY && r.counter ? ` <em>(+ Counters)</em>` : "";
    return `<details class="cond-row" data-i="${i}">
      <summary>
        <label><input type="checkbox" class="inc" ${r.include ? "checked" : ""}></label>
        <strong>${esc(String(r.name).split(":")[0].slice(0, 70))}</strong>${also}
      </summary>
      <div class="cond-row-body">
        <label><input type="checkbox" class="def" ${r.def ? "checked" : ""}> on by default (per-roll)</label>
        <textarea class="txt" rows="4">${esc(editable)}</textarea>
        <div class="cond-row-mods">modifiers: ${esc(mods)}</div>
      </div>
    </details>`;
  };

  const weaponOpts = `<option value="${COND_KEY}">★ ${esc(COND_ITEM_NAME)} item (all tabs)</option>`
    + weapons.map(w => `<option value="${w.id}">${esc(w.name)} [${w.type}]</option>`).join("");
  // Magic-item passive effects. Not weapon-scoped -- they write to the equipment items themselves --
  // so they get their own button rather than riding the per-weapon apply.
  const itemUpdates = itemEffectUpdates(actor, data);
  const li = arr => arr.length ? `<ul>${arr.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : `<em>none</em>`;
  const gapCount = gaps.spells.length + gaps.maneuvers.length + gaps.talents.length
                 + gaps.qualities.length + gaps.classFeatures.length + gaps.feats.length;
  // Layout lives in styles/apply-conditionals.css, scoped under .pf1ca. The one exception is
  // #action-wrap's inline display:none -- jQuery .show()/.hide() below toggle it, and an inline
  // value is what they expect to clear.
  const content = `
    <div class="pf1ca">
      <div class="pf1ca-toolbar">
        <label>Apply to: <select id="weapon-sel">${weaponOpts}</select></label>
        <span id="action-wrap" style="display:none"></span>
        <label class="pf1ca-mode" title="Bespoke: curated conditionals only. Full: also every uncurated or passive feat, talent, maneuver and spell, as text-only rows marked †."><input type="checkbox" id="mode-full" ${mode === "full" ? "checked" : ""}> Full</label>
      </div>
      <div class="pf1ca-toolbar">
        <button type="button" id="toggle-all"><i class="fas fa-check-double"></i> All on/off</button>
        <button type="button" id="apply-weapon"><i class="fas fa-check"></i> Apply</button>
        ${weapons.length ? `<button type="button" id="apply-all" title="Apply to every weapon and attack item, each with its own qualities and its own saved choices"><i class="fas fa-check-double"></i> Apply to all weapons</button>` : ""}
        <button type="button" id="push-cond" title="Rewrite the ${esc(COND_ITEM_NAME)} item from your saved choices (and any edits on screen when it is selected)."><i class="fas fa-book"></i> Update ${esc(COND_ITEM_NAME)} item</button>
        ${itemUpdates.length ? `<button type="button" id="sync-items" title="Overlay the curated bonuses and notes for these items onto the item documents themselves. Deduped against what each item already has; re-runnable."><i class="fas fa-ring"></i> Sync item effects (${itemUpdates.length})</button>` : ""}
      </div>
      <p class="pf1ca-hint">The ${esc(COND_ITEM_NAME)} item is kept up to date on every run. Uncheck to exclude a conditional; expand a row to edit its clauses or per-roll default. Edits persist per item and survive re-runs. † = not curated (text only).</p>
      <div id="cond-rows"></div>
      <hr>
      <details class="pf1ca-gaps"><summary>Curation gaps (${gapCount})</summary>
        <div class="pf1ca-gaps-body">
          <strong>Feats &amp; class features (${gaps.feats.length})</strong>${li(gaps.feats)}
          <strong>Spells (${gaps.spells.length})</strong>${li(gaps.spells)}
          <strong>Maneuvers (${gaps.maneuvers.length})</strong>${li(gaps.maneuvers)}
          <strong>Talents (${gaps.talents.length})</strong>${li(gaps.talents)}
          <strong>Weapon qualities (${gaps.qualities.length})</strong>${li(gaps.qualities)}
          <strong>Class features, unresolved level (${gaps.classFeatures.length})</strong>${li(gaps.classFeatures)}
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
        const w = curWeaponId === COND_KEY ? null : actor.items.get(curWeaponId);
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
        if (!curRows.length) { html.find("#cond-rows").html("<p><em>Nothing to apply — actor has no matching feats, spells, maneuvers or talents.</em></p>"); return; }
        let out = "", lastSection = null;
        curRows.forEach((r, i) => {
          const sec = groupOf(r);
          if (sec !== lastSection) { out += sectionHeader(sec); lastSection = sec; }
          out += rowHtml(r, i);
        });
        html.find("#cond-rows").html(out);
      };
      const rowIdx = ev => +ev.target.closest(".cond-row").dataset.i;
      // Push the Conditionals item: the on-screen rows when it is the selection, else saved choices.
      const pushCond = async () => {
        const live = curWeaponId === COND_KEY ? curRows : null;
        if (live) remember(COND_KEY, live);
        await actor.update({ [`flags.${MOD_NS}.overrides`]: overrides });
        const r = await pushConditionalsItem(actor, specs, overrides, mode, init, live);
        const n = (live || conditionalsItemRows(specs, overrides, mode)).filter(x => x.include).length;
        ui.notifications.info(`${r.create ? "Created" : "Updated"} the ${COND_ITEM_NAME} item (${n} conditional(s), ${mode}).`);
      };

      html.on("change", "#weapon-sel", ev => { curWeaponId = ev.target.value; curActionIdx = 0; renderActionSel(); renderRows(); });
      // Re-render on an action switch too: the melee/ranged default follows the action's type.
      html.on("change", "#action-sel", ev => { curActionIdx = +ev.target.value; renderRows(); });
      html.on("change", "#mode-full", async ev => {
        mode = ev.target.checked ? "full" : "bespoke";
        await actor.update({ [`flags.${MOD_NS}.mode`]: mode });
        renderRows();
        await pushConditionalsItem(actor, specs, overrides, mode, init);
        ui.notifications.info(`${actor.name}: ${mode === "full" ? "Full" : "Bespoke"} mode — ${COND_ITEM_NAME} item updated.`);
      });
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
        setInclude(curRows.map((r, i) => [r, i]).filter(([r]) => groupOf(r) === sec).map(([, i]) => i));
      });
      html.on("click", "#push-cond", async ev => { ev.preventDefault(); await pushCond(); });
      html.on("click", "#apply-weapon", async ev => {
        ev.preventDefault();
        if (curWeaponId === COND_KEY) { await pushCond(); return; }
        const upd = applyToWeapon(actor, curWeaponId, curActionIdx, curRows, init);
        if (!upd) { ui.notifications.warn("Selected weapon has no attack action to apply to."); return; }
        remember(curWeaponId, curRows);
        await actor.update({ [`flags.${MOD_NS}.overrides`]: overrides });
        await actor.updateEmbeddedDocuments("Item", [upd]);
        const n = curRows.filter(r => r.include).length;
        ui.notifications.info(`Applied ${n} conditional(s) to ${actor.items.get(curWeaponId)?.name}.`);
      });

      // The generator only ever wires its main weapon, so the rollable attack twin and any backup
      // weapon start empty. This applies to every weapon/attack item in one pass -- each with the
      // qualities detected on THAT item, its own action's melee/ranged defaults, and its own saved
      // choices (the selected weapon uses what is on screen, edits included). The Conditionals item
      // is not a weapon here; it has its own button.
      html.on("click", "#apply-all", async ev => {
        ev.preventDefault();
        const updates = [], summary = [];
        for (const w of weapons) {
          const idx = w.id === curWeaponId ? curActionIdx : 0;
          const rows = w.id === curWeaponId ? curRows : rowsFor(w.id, idx);
          const upd = applyToWeapon(actor, w.id, idx, rows, init);
          if (!upd) continue;                      // no attack action on this item
          remember(w.id, rows);
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
  }, { width: 640, resizable: true }).render(true);
}

// --- run: the module's single entry point (see scripts/main.js) ---
// actorArg lets a caller that already knows the actor (e.g. the character-sheet button) skip the
// chooser; passing nothing (macro, scene-control tool, keybinding) falls through to resolveActor().
// Every run brings the Conditionals item up to date first (creating it if missing), then opens the
// dialog for review.
export async function apply(actorArg = null) {
  try {
    const actor = actorArg ?? await resolveActor();
    if (!actor) return;
    const data = await loadData();
    const init = initAttr(actor);
    const mode = actorMode(actor);
    const { specs, gaps } = buildSpecs(actor, data, init);
    const r = await pushConditionalsItem(actor, specs, actor.flags?.[MOD_NS]?.overrides || {}, mode, init);
    if (r.create) ui.notifications.info(`${actor.name}: created a "${COND_ITEM_NAME}" item in the inventory.`);
    openDialog(actor, specs, gaps, init, data, mode);
  } catch (err) {
    console.error(`[${MOD_NS}] error:`, err);
    ui.notifications.error(`Apply Conditionals failed: ${err.message}`);
  }
}

// The pure functions build/verify_specs.mjs drives directly.
export { buildSpecs, buildRows, applyToWeapon, weaponQualitySpecs, otherAttackSpecs, detectQualities,
         retargetClassLevel, classTags, nameCandidates, itemEffectUpdate, itemEffectUpdates,
         conditionalsItemRows, conditionalsItemUpdate, descEntries, parseMarkedName, buildIndex, COND_KEY };
