/**
 * Drive the module's pure functions against a synthetic actor -- no Foundry, no dependencies.
 *
 *     npm test          (or: node build/verify_specs.mjs)
 *
 * scripts/apply-conditionals.js is a plain ES module that neither runs anything nor touches a
 * Foundry global at import time, so it imports straight into Node and the functions under test are
 * the exact ones Foundry loads.
 *
 * Covered: feat/class-feature/quality matching, the Unchained class-level retarget, melee-vs-ranged
 * include defaults, adopt-if-verbatim vs edited-row suppression, exclusion never deleting, section
 * order and dividers, per-item quality recomputation, and re-run idempotency.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSpecs, buildRows, applyToWeapon, weaponQualitySpecs, retargetClassLevel,
         nameCandidates, itemEffectUpdates } from "../scripts/apply-conditionals.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const MOD_NS = "pf1-conditional-applier";
const DATA_FILES = ["spell_riders", "spell_changes", "maneuver_changes", "combat_talent_conditionals",
                    "magic_talent_conditionals", "spell_damage_index", "feat_conditionals",
                    "weapon_quality_conditionals", "class_feature_conditionals", "item_changes"];

const data = Object.fromEntries(DATA_FILES.map(f =>
  [f, JSON.parse(fs.readFileSync(path.join(ROOT, "data", `${f}.json`), "utf8"))]));

// --- tiny assert harness -------------------------------------------------------------------------
let passed = 0, failed = 0;
const ok = (cond, label) => { if (cond) { passed++; } else { failed++; console.error(`  FAIL  ${label}`); } };
const eq = (got, want, label) =>
  ok(JSON.stringify(got) === JSON.stringify(want), `${label}\n          got:  ${JSON.stringify(got)}\n          want: ${JSON.stringify(want)}`);
const section = t => console.log(`\n${t}`);
const prefixOf = n => String(n).split(":")[0].trim();

// --- curated names, read from the data so the fixture can never drift from the source -------------
const FLAMING = data.weapon_quality_conditionals["Flaming"][0].name;
const KEEN = data.weapon_quality_conditionals["Keen"][0].name;
const POWER_ATTACK = data.feat_conditionals["Power Attack"].name;
const DEADLY_AIM = data.feat_conditionals["Deadly Aim"].name;
const CRIPPLING = data.class_feature_conditionals.rogue_talents["crippling strike"][0].name;
const BLEEDING = data.class_feature_conditionals.rogue_talents["bleeding attack"][0].name;   // carries @classes.rogue.level
const RECKLESS = data.class_feature_conditionals.rage_powers["reckless abandon"][0].name;

// --- synthetic actor -----------------------------------------------------------------------------
class Items extends Array { get(id) { return this.find(i => i.id === id); } }
const mkItem = o => ({
  id: o.id, type: o.type, name: o.name, flags: o.flags || {}, system: o.system || {},
  toObject() {
    return JSON.parse(JSON.stringify(
      { _id: this.id, name: this.name, type: this.type, system: this.system, flags: this.flags }));
  },
});
const mkAction = (name, actionType, conditionals = []) => ({
  _id: `act-${name}`, name, actionType, conditionals,
  damage: { parts: [{ formula: "2d6", type: { values: ["slashing"] } }] },
});
const desc = v => ({ description: { value: v } });

// Greatsword: generator markup for Flaming + Keen, and four conditionals already on the action --
// a pristine quality, a pristine feat toggle, an EDITED quality, and a hand-authored one.
const GREATSWORD_DESC =
  "<p>A big sword.</p><p><strong>Special abilities:</strong> Flaming, Keen</p>" +
  "<h3>Flaming</h3><p>rules text</p><h3>Keen</h3><p>rules text</p>";
const existingConds = () => [
  { _id: "pre-flam", name: FLAMING, default: true, modifiers: [{ _id: "m1", formula: "1d6[Flaming]", target: "damage", subTarget: "allDamage", type: "untyped", damageType: ["fire"], critical: "nonCrit" }] },
  { _id: "pre-pwra", name: POWER_ATTACK, default: false, modifiers: [] },
  { _id: "pre-keen", name: `${KEEN} — house ruled to x3`, default: true, modifiers: [] },
  { _id: "pre-hand", name: "My Custom Toggle: +1 luck", default: false, modifiers: [] },
];

const makeActor = ({ classTag = "rogueUnchained", swordDesc = GREATSWORD_DESC } = {}) => {
  const items = Items.from([
    mkItem({ id: "cls-1", type: "class", name: "Rogue (Unchained)", system: { tag: classTag, level: 8 } }),
    mkItem({ id: "ft-pa", type: "feat", name: "Power Attack", system: { subType: "feat" } }),
    mkItem({ id: "ft-da", type: "feat", name: "Deadly Aim", system: { subType: "feat" } }),
    mkItem({ id: "ft-cs", type: "feat", name: "(Rogue Talent 4) Crippling Strike", system: { subType: "classFeat" } }),
    mkItem({ id: "ft-ba", type: "feat", name: "(Rogue Talent 6) Bleeding Attack", system: { subType: "classFeat" } }),
    mkItem({ id: "ft-ra", type: "feat", name: "(Rage Power 4) Reckless Abandon", system: { subType: "classFeat" } }),
    mkItem({ id: "ft-div", type: "feat", name: "_______________Rogue Talents__________________", system: { subType: "classFeat" } }),
    mkItem({ id: "wpn-gs", type: "weapon", name: "+1 Flaming Keen Greatsword",
             system: { ...desc(swordDesc), actions: [mkAction("Attack", "mwak", existingConds())] } }),
    mkItem({ id: "atk-gs", type: "attack", name: "+1 Flaming Keen Greatsword",
             system: { ...desc("<p><strong>Special abilities:</strong> Flaming, Keen</p>"),
                       actions: [mkAction("Attack", "mwak")] } }),
    mkItem({ id: "wpn-bow", type: "weapon", name: "Longbow",
             system: { ...desc("<p>A plain bow.</p>"), actions: [mkAction("Attack", "rwak")] } }),
  ]);
  return { name: "Test Rogue", items, flags: {}, system: { abilities: { int: { total: 14 }, wis: { total: 10 }, cha: { total: 8 } } } };
};

const nameOf = c => c.name;
const condsOf = (upd, idx = 0) => upd["system.actions"][idx].conditionals.map(nameOf);
const applyBack = (actor, upd) => {                    // simulate the Foundry embedded-document write
  const it = actor.items.get(upd._id);
  it.system.actions = JSON.parse(JSON.stringify(upd["system.actions"]));
  it.flags[MOD_NS] = { ...(it.flags[MOD_NS] || {}), condIds: upd[`flags.${MOD_NS}.condIds`] };
};

// --- 1. specs ------------------------------------------------------------------------------------
section("specs: feats, class features, retargeting, gaps");
const actor = makeActor();
const { specs, gaps } = buildSpecs(actor, data, "int");
const featSpecs = specs.filter(s => s.section === "Feats");
const cfSpecs = specs.filter(s => s.section === "Class Features");

ok(featSpecs.some(s => s.name === POWER_ATTACK), "Power Attack is offered as a Feats row");
ok(featSpecs.some(s => s.name === DEADLY_AIM), "Deadly Aim is offered as a Feats row");
eq(featSpecs.find(s => s.name === POWER_ATTACK)?.weaponType, "melee", "Power Attack reads as melee");
eq(featSpecs.find(s => s.name === DEADLY_AIM)?.weaponType, "ranged", "Deadly Aim reads as ranged");
eq(cfSpecs.length, 2, "both resolvable rogue talents survive");
ok(cfSpecs.some(s => s.name === CRIPPLING), "a token-free talent passes through verbatim");
const bleed = cfSpecs.find(s => s.name.startsWith(prefixOf(BLEEDING)));
ok(bleed && bleed.name.includes("@classes.rogueUnchained.level"),
   "rogue -> rogueUnchained retarget applied to an Unchained Rogue");
ok(bleed && !bleed.name.includes("@classes.rogue.level"), "no canonical rogue token left behind");
ok(gaps.classFeatures.some(g => g.includes("Reckless Abandon")),
   "Reckless Abandon is gap-listed (no barbarian/skald class on this actor)");
ok(!specs.some(s => s.name.includes(RECKLESS.split(":")[0])), "gap-listed row is not applied");
eq(gaps.qualities, [], "no quality gaps when every detected quality is curated");

section("specs: quality detection is per item and description-only");
const qGs = weaponQualitySpecs(actor, "wpn-gs", data).map(s => s.name);
const qTwin = weaponQualitySpecs(actor, "atk-gs", data).map(s => s.name);
const qBow = weaponQualitySpecs(actor, "wpn-bow", data).map(s => s.name);
ok(qGs.includes(FLAMING) && qGs.includes(KEEN), "greatsword detects Flaming + Keen");
ok(qTwin.includes(FLAMING) && qTwin.includes(KEEN), "attack twin detects both from the abilities line");
eq(qBow, [], "bow with no markup detects nothing (no name-based false positives)");
const bowNamed = makeActor();
bowNamed.items.get("wpn-bow").name = "Aldori Dueling Sword";
eq(weaponQualitySpecs(bowNamed, "wpn-bow", data), [], "a quality word in the ITEM NAME never matches");

section("specs: uncurated quality is reported, not applied");
const zorbo = makeActor({ swordDesc: GREATSWORD_DESC + "<h3>Zorbo</h3><p>homebrew</p>" });
eq(buildSpecs(zorbo, data, "int").gaps.qualities, ["Zorbo"], "uncurated quality lands in the gap panel");
ok(!weaponQualitySpecs(zorbo, "wpn-gs", data).some(s => s.name === "Zorbo"), "…and produces no row");

section("specs: unresolvable class level when no sibling exists");
const noClass = makeActor({ classTag: "fighter" });
const nc = buildSpecs(noClass, data, "int");
const ncNames = nc.specs.filter(s => s.section === "Class Features").map(s => s.name);
eq(ncNames, [CRIPPLING], "only the token-free talent survives on a Fighter");
eq(nc.gaps.classFeatures.length, 2, "both token-bearing powers are gap-listed, not silently zeroed");
eq(retargetClassLevel("floor(@classes.rogue.level / 2)", new Set(["ninja"])),
   { text: "floor(@classes.ninja.level / 2)", ok: true }, "rogue -> ninja sibling retarget");
eq(retargetClassLevel("@classes.barbarian.level", new Set(["skald"])),
   { text: "@classes.skald.level", ok: true }, "barbarian -> skald sibling retarget");
eq(retargetClassLevel("@classes.rogue.level", new Set(["rogue"])),
   { text: "@classes.rogue.level", ok: true }, "canonical class is left alone");

// --- 2. rows -------------------------------------------------------------------------------------
section("rows: melee/ranged include defaults follow the action");
const rowsGs = buildRows(actor, specs, data, {}, "wpn-gs", 0);
const rowsBow = buildRows(actor, specs, data, {}, "wpn-bow", 0);
const inc = (rows, name) => rows.find(r => r.origName === name)?.include;
eq(inc(rowsGs, POWER_ATTACK), true, "Power Attack checked on a melee action");
eq(inc(rowsGs, DEADLY_AIM), false, "Deadly Aim unchecked on a melee action");
eq(inc(rowsBow, POWER_ATTACK), false, "Power Attack unchecked on a ranged action");
eq(inc(rowsBow, DEADLY_AIM), true, "Deadly Aim checked on a ranged action");
eq(inc(buildRows(actor, specs, data, { "wpn-gs": { [DEADLY_AIM]: { include: true } } }, "wpn-gs", 0), DEADLY_AIM),
   true, "a saved override beats the melee/ranged heuristic");
const qRows = rows => rows.filter(r => r.section === "Weapon Qualities").map(r => r.origName);
ok(qRows(rowsGs).includes(FLAMING), "greatsword rows include its own quality rows");
eq(qRows(rowsBow), [], "bow has no quality rows of its own");
// The greatsword's Flaming is still reachable on the bow via the opt-in copy section -- unchecked.
eq(rowsBow.find(r => r.origName === FLAMING)?.section, "On Other Attacks",
   "…it is only offered as an On Other Attacks copy");
eq(rowsBow.find(r => r.origName === FLAMING)?.include, false, "…and that copy arrives unchecked");

// --- 3. apply ------------------------------------------------------------------------------------
section("apply: adoption, suppression, dividers, order");
const upd = applyToWeapon(actor, "wpn-gs", 0, rowsGs, "int");
const names = condsOf(upd);
const ids = upd[`flags.${MOD_NS}.condIds`];
const idOf = n => upd["system.actions"][0].conditionals.find(c => c.name === n)?._id;

eq(names.filter(n => n === FLAMING).length, 1, "adopted Flaming appears exactly once");
eq(names.filter(n => n === POWER_ATTACK).length, 1, "adopted Power Attack appears exactly once");
ok(ids.includes(idOf(FLAMING)) && ids.includes(idOf(POWER_ATTACK)),
   "adopted rows are tracked in condIds (so they are now editable/removable)");
ok(names.includes(`${KEEN} — house ruled to x3`), "the edited Keen survives untouched");
ok(!names.includes(KEEN), "…and our pristine Keen row is suppressed as a near-duplicate");
ok(names.includes("My Custom Toggle: +1 luck"), "hand-authored conditional is untouched");
ok(!names.includes(DEADLY_AIM), "an unchecked row is not applied");

const dividerIdx = label => names.findIndex(n => n.includes(label));
ok(dividerIdx("OTHER (EXISTING)") === 0, "OTHER (EXISTING) heads the surviving conditionals");
const order = ["FEATS", "WEAPON QUALITIES", "CLASS FEATURES"].map(dividerIdx);
ok(order.every(i => i > 0), "all three new dividers are present");
ok(order[0] < order[1] && order[1] < order[2], "dividers appear in section order");
ok(dividerIdx("CLASS FEATURES") < names.length - 1, "class-feature rows follow their divider");

section("apply: an excluded row never deletes what the generator wrote");
const actorB = makeActor();
const rowsB = buildRows(actorB, specs, data, {}, "wpn-gs", 0).map(r =>
  r.origName === FLAMING ? { ...r, include: false } : r);
const namesB = condsOf(applyToWeapon(actorB, "wpn-gs", 0, rowsB, "int"));
eq(namesB.filter(n => n === FLAMING).length, 1, "the pre-existing Flaming is still there");
ok(namesB.indexOf(FLAMING) < namesB.findIndex(n => n.includes("WEAPON QUALITIES")) ||
   !namesB.some(n => n.includes("WEAPON QUALITIES")),
   "…left under OTHER (EXISTING), not re-emitted as ours");

section("apply: re-run is idempotent");
const actorC = makeActor();
const run = a => {
  const s = buildSpecs(a, data, "int").specs;
  const r = buildRows(a, s, data, {}, "wpn-gs", 0);
  const u = applyToWeapon(a, "wpn-gs", 0, r, "int");
  applyBack(a, u);
  return u;
};
const first = condsOf(run(actorC));
const second = condsOf(run(actorC));
eq(second, first, "a second run produces the identical conditional list");

section("apply: every weapon/attack item gets its own result");
const actorD = makeActor();
for (const id of ["wpn-gs", "atk-gs", "wpn-bow"]) {
  const s = buildSpecs(actorD, data, "int").specs;
  const u = applyToWeapon(actorD, id, 0, buildRows(actorD, s, data, {}, id, 0), "int");
  applyBack(actorD, u);
  const n = condsOf(u);
  if (id === "wpn-bow") {
    ok(!n.some(x => x === FLAMING || x === KEEN), "bow gets no quality rows");
    ok(n.includes(DEADLY_AIM), "bow gets Deadly Aim");
    ok(!n.includes(POWER_ATTACK), "bow does not get Power Attack");
  } else {
    ok(n.includes(FLAMING), `${id} gets Flaming`);
    ok(n.includes(POWER_ATTACK), `${id} gets Power Attack`);
  }
}

// --- 4. generated item names: labels, granted-feat chains, source tags, dividers ------------------
// The generator never names a feat item plainly. Every one carries a label ("(Feat 1) ", "Fighter
// 6: "), applyFeatTax() folds each GRANTED chain feat into the primary item's name behind " > ",
// and some parts keep a source tag. Before this, a plain lookup matched none of them: a real
// generated character produced ZERO feat rows out of 113 feat items.
section("names: labelled, chained and tagged feat items");
const CHARGING = data.feat_conditionals["Charging Hurler"].name;
const COLD_CELERITY = data.feat_conditionals["Cold Celerity"].name;
const PIRANHA = data.feat_conditionals["Piranha Strike"].name;

eq(nameCandidates("(Feat 1) Point-Blank Shot (EitR) > Charging Hurler"),
   ["Point-Blank Shot (EitR)", "Point-Blank Shot", "Charging Hurler"],
   "label dropped, chain split, source tag offered both ways");
eq(nameCandidates("Fighter 6: Enforcer"), ["Enforcer"], "bare 'Class N:' prefix dropped");
eq(nameCandidates("(Trainer 1): Endurance"), ["Endurance"], "labelled-with-colon prefix dropped");
eq(nameCandidates("Cleave"), ["Cleave"], "a plain name is returned unchanged");
eq(nameCandidates("_______________Rogue Talents__________________"), [], "divider items match nothing");

const chained = makeActor();
chained.items.push(
  mkItem({ id: "ft-chain", type: "feat",
           name: "(Feat 1) Point-Blank Shot (EitR) > Charging Hurler > Piranha Strike" }),
  // The SAME granted feat folded into a second item -- must not produce the row twice.
  mkItem({ id: "ft-chain2", type: "feat", name: "(Feat 3) Weapon Focus > Charging Hurler" }),
  mkItem({ id: "ft-colon", type: "feat", name: "Fighter 6: Cold Celerity" }),
);
const chainedFeats = buildSpecs(chained, data, "int").specs.filter(s => s.section === "Feats");
const chainedNames = chainedFeats.map(s => s.name);
ok(chainedNames.includes(CHARGING), "a feat granted mid-chain is found");
ok(chainedNames.includes(PIRANHA), "so is one at the end of the chain");
ok(chainedNames.includes(COLD_CELERITY), "so is one behind a 'Fighter 6:' prefix");
eq(chainedNames.filter(n => n === CHARGING).length, 1, "a doubly-granted feat yields exactly one row");
ok(chainedNames.includes(POWER_ATTACK), "plain-named feats still match");

// --- 5. magic items: attack toggles on the weapon, passive effects on the item --------------------
section("items: attack notes become toggles, passives overlay the item");
const attackNote = k => data.item_changes[k].contextNotes.find(n => n.target === "attack").text;
const ATT_TEXT = attackNote("amulet of hidden strength");    // attack note and nothing else
const BOTH_TEXT = attackNote("amulet of mighty fists +1");   // attack note AND a passive change

const withItems = makeActor();
withItems.items.push(
  mkItem({ id: "eq-att", type: "equipment", name: "Amulet of Hidden Strength" }),
  mkItem({ id: "eq-both", type: "equipment", name: "Amulet of Mighty Fists +1" }),
  mkItem({ id: "eq-nac", type: "equipment", name: "Amulet of Natural Armor +2" }),
  // Same curated target ("nac") already automated by the compendium item, plus a hand-authored
  // note: the overlay must add neither, and must never remove the hand-authored one.
  mkItem({ id: "eq-dup", type: "equipment", name: "Amulet of Natural Armor +2",
           system: { changes: [{ _id: "own1", formula: "2", target: "nac", type: "enh" }],
                     contextNotes: [{ target: "ac", text: "my own note" }] } }),
);
const itemSpecs = buildSpecs(withItems, data, "int").specs.filter(s => s.section === "Items");
eq(itemSpecs.map(s => s.name).sort(),
   [`(Amulet of Hidden Strength): ${ATT_TEXT}`, `(Amulet of Mighty Fists +1): ${BOTH_TEXT}`].sort(),
   "one '(Item): text' toggle per attack note, and none from items without one");
eq(itemSpecs[0].default, false, "item activations arrive default-off");
eq(itemSpecs[0].rawMods, [], "name-only rider: the [[ ]] rolls are already baked into the text");
// Read straight out of the source: the generator writes identical "(Item): text" rows at creation,
// so "Items" must be adoptable or every re-run would duplicate them.
const adoptLine = fs.readFileSync(path.join(ROOT, "scripts", "apply-conditionals.js"), "utf8")
  .match(/const ADOPT_SECTIONS = new Set\(\[([^\]]*)\]/)?.[1] || "";
ok(adoptLine.includes('"Items"'), "'Items' is adoptable, so the generator's own rows are not duplicated");

const updates = itemEffectUpdates(withItems, data);
const byId = Object.fromEntries(updates.map(u => [u._id, u]));
eq(Object.keys(byId).sort(), ["eq-both", "eq-nac"], "only items with something passive to add are updated");
eq(byId["eq-nac"]["system.changes"].map(c => c.target), ["nac"], "the curated change is added");
eq(byId["eq-nac"]["system.changes"][0].operator, "add", "pf1 ChangeModel defaults are filled in");
eq(byId["eq-both"]["system.changes"].map(c => c.target), ["damage"], "its passive change lands");
eq(byId["eq-both"]["system.contextNotes"], [],
   "the attack note stays OFF the item -- it became a weapon toggle instead");

// Re-run: apply the update back, then rebuild. Nothing duplicates, nothing hand-authored is lost.
for (const u of updates) {
  const it = withItems.items.get(u._id);
  it.system.changes = u["system.changes"];
  it.system.contextNotes = u["system.contextNotes"];
  it.flags[MOD_NS] = { changeIds: u[`flags.${MOD_NS}.changeIds`], noteTexts: u[`flags.${MOD_NS}.noteTexts`] };
}
const itemsRerun = itemEffectUpdates(withItems, data);
for (const u of itemsRerun) {
  const it = withItems.items.get(u._id);
  eq(u["system.changes"].length, it.system.changes.length, `${it.name}: re-run adds no change`);
  eq(u["system.contextNotes"].length, it.system.contextNotes.length, `${it.name}: re-run adds no note`);
}
ok(withItems.items.get("eq-dup").system.changes.length === 1,
   "an item whose target is already automated is left completely alone");
ok(withItems.items.get("eq-dup").system.contextNotes.some(n => n.text === "my own note"),
   "a hand-authored note survives");

// --- 6. the module ships every file it loads at runtime ------------------------------------------
// The old bundler could silently omit a data file; now the failure mode is a module.json that points
// at something the repo doesn't have, or a data file loadData() fetches that was never committed.
section("module: manifest and runtime files line up");
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "module.json"), "utf8"));
eq(manifest.id, MOD_NS, "module id matches the flag namespace the code writes");
for (const rel of [...(manifest.esmodules || []), ...(manifest.styles || [])]) {
  ok(fs.existsSync(path.join(ROOT, rel)), `manifest ${rel} exists`);
}
for (const p of manifest.packs || []) {
  ok(fs.existsSync(path.join(ROOT, p.path)), `pack ${p.path} is built`);
}
// loadData() is the single source of truth for what data/ must contain -- read the list out of the
// module itself rather than restating it, so the two can never drift.
const runtimeFiles = fs.readFileSync(path.join(ROOT, "scripts", "apply-conditionals.js"), "utf8")
  .match(/const DATA_FILES = \[([^\]]*)\]/s)?.[1].match(/"([^"]+)"/g)?.map(s => s.slice(1, -1)) || [];
eq(runtimeFiles.slice().sort(), DATA_FILES.slice().sort(), "loadData()'s file list matches this suite's");
for (const f of runtimeFiles) {
  ok(fs.existsSync(path.join(ROOT, "data", `${f}.json`)), `data/${f}.json ships`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
