/**
 * Apply Conditionals — a run-on-demand Foundry (pf1, v13) macro.
 *
 * Scans the chosen actor and wires the relevant conditionals onto ALL its weapons' attack actions:
 *   • Path of War maneuvers/stances  (actor items of type "pf1-pow.maneuver")
 *   • Spheres of Power/Might talents  (actor items flagged flags.pf1spheres.sphere)
 *   • Spells                          (actor items of type "spell", matched by name)
 *       - A self-buffs (Bless, Divine Favor…)   -> +attack/+damage toggle
 *       - B touch-damage (Shocking Grasp…)       -> toggle + the spell's own damage dice
 *       - C debuffs/area (Fireball, Hold Person…)-> toggle carrying save + effect text
 * Then it pops a report of everything it could NOT match (the curation gap list).
 *
 * RE-RUN SAFE: every conditional this macro adds is tracked in a per-weapon flag
 * (flags["pf1-conditional-applier"].condIds). Each run first removes the ones IT added, then
 * re-scans and re-adds — so it picks up newly-learned maneuvers/talents/spells, drops ones you no
 * longer have, and NEVER touches conditionals you made by hand.
 *
 * USAGE: select a token (or none, to pick from a list), run this macro, delete it when done.
 * Data is fetched from the repo's raw files — no module install required.
 */
(async () => {
  const MOD_NS = "pf1-conditional-applier";
  const DATA_BASE =
    "https://raw.githubusercontent.com/The-Data-is-a-lie/pf1-conditional-applier/main/data/";
  // For a SELF-CONTAINED macro, build/bundle_macro.py replaces the next line with the full data
  // object (-> apply-conditionals.bundled.js). Left null here, the macro fetches from DATA_BASE.
  const EMBEDDED_DATA = null;
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
  const cap = s => { s = String(s || ""); return s ? s[0].toUpperCase() + s.slice(1) : ""; };
  const subInit = (s, init) => String(s == null ? "" : s).replaceAll("@INITMOD", `@abilities.${init}.mod`);

  function labelFormula(formula, srcName, init) {
    formula = subInit(formula, init);
    if (formula && !/\[.*\]/.test(formula)) formula += `[${String(srcName).replace(/[\[\]]/g, "").trim()}]`;
    return formula;
  }
  function mkMod(m, srcName, seed, idx, init) {
    const isAttack = m.target === "attack";
    return {
      _id: detId(`${seed}|m${idx}`, 8),
      formula: labelFormula(m.formula, srcName, init),
      target: m.target || "damage",
      subTarget: m.subTarget || (isAttack ? "allAttack" : "allDamage"),
      type: m.type || "untyped",
      damageType: Array.isArray(m.damageType) ? m.damageType : [],
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

  // --- load the frozen data bundle ---
  async function loadData() {
    if (EMBEDDED_DATA) return EMBEDDED_DATA;              // self-contained (bundled) build
    const files = ["spell_riders", "spell_changes", "maneuver_changes", "combat_talent_conditionals",
                   "magic_talent_conditionals", "spell_damage_index"];
    const out = {};
    await Promise.all(files.map(async f => {
      const res = await fetch(DATA_BASE + f + ".json", { cache: "no-store" });
      if (!res.ok) throw new Error(`${f}.json -> HTTP ${res.status} `
        + `(is the repo public? or use apply-conditionals.bundled.js, which needs no network)`);
      out[f] = await res.json();
    }));
    return out;
  }

  // --- build the weapon-independent conditional specs from what the actor knows ---
  function buildSpecs(actor, data, init) {
    const specs = [];                              // {name, default, rawMods, srcName}
    const gaps = { maneuvers: [], talents: [], spells: [] };

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
        name: rider ? `${nm}: ${subInit(rider, init)}` : nm,
        default: !!entry.default, rawMods: entry.modifiers || [], srcName: nm,
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
        specs.push({ name, default: false, rawMods, srcName: String(A.name).split(":")[0] });
      }
      if (BC) {
        const e = BC.e, bits = [], save = e.save || {};
        if (save.description || save.type) bits.push(String(save.description || `${cap(save.type)} save`));
        for (const r of (e.riders || [])) bits.push(String(r));
        const riderText = bits.filter(Boolean).join("; ");
        const rawMods = [];
        if (e.attack) for (const [formula, dtypes] of (dmg[it.name.toLowerCase()] || []))
          rawMods.push({ formula, target: "damage", subTarget: "allDamage", type: "untyped",
            damageType: Array.isArray(dtypes) ? dtypes : [], critical: "nonCrit" });
        specs.push({ name: riderText ? `${BC.name}: ${subInit(riderText, init)}` : BC.name,
          default: false, rawMods, srcName: BC.name });
      }
    }
    return { specs, gaps };
  }

  // --- apply the specs to every weapon, idempotently ---
  function applyToWeapons(actor, specs, init) {
    const weapons = actor.items.filter(i => i.type === "weapon" || i.type === "attack");
    const updates = [];
    let weaponsTouched = 0;
    for (const w of weapons) {
      const src = w.toObject();
      const actions = src.system?.actions || [];
      if (!actions.length) continue;
      const action = actions[0];
      if (!Array.isArray(action.conditionals)) action.conditionals = [];
      const prev = new Set((src.flags?.[MOD_NS]?.condIds) || []);
      action.conditionals = action.conditionals.filter(c => !(c && prev.has(c._id)));   // drop our old ones
      const seen = new Set(action.conditionals.map(c => c && c.name));                  // keep hand-made
      const newIds = [];
      for (const spec of specs) {
        if (seen.has(spec.name)) continue;
        seen.add(spec.name);
        const seed = `${w.id}|${spec.name}`;
        const cid = detId(seed, 8);
        action.conditionals.push({
          _id: cid, name: spec.name, default: !!spec.default,
          modifiers: (spec.rawMods || []).map((m, i) => mkMod(m, spec.srcName, seed, i, init)),
        });
        newIds.push(cid);
      }
      updates.push({ _id: w.id, "system.actions": actions, [`flags.${MOD_NS}.condIds`]: newIds });
      weaponsTouched++;
    }
    return { updates, weaponsTouched };
  }

  function report(actor, res, gaps, init) {
    const li = arr => arr.length ? `<ul style="margin:.25em 0 .75em 1em">${arr.map(x => `<li>${x}</li>`).join("")}</ul>` : `<p style="margin:.25em 0 .75em 1em"><em>none</em></p>`;
    const content = `
      <div style="max-height:60vh;overflow:auto">
        <p><strong>${actor.name}</strong> — applied <strong>${res.applied}</strong> conditional(s)
           to <strong>${res.weaponsTouched}</strong> weapon(s). Init ability: <code>${init}</code>.</p>
        <hr>
        <p><strong>No conditional found (curation gaps):</strong></p>
        <p style="margin:0"><strong>Spells (${gaps.spells.length})</strong></p>${li(gaps.spells)}
        <p style="margin:0"><strong>Maneuvers (${gaps.maneuvers.length})</strong></p>${li(gaps.maneuvers)}
        <p style="margin:0"><strong>Talents (${gaps.talents.length})</strong></p>${li(gaps.talents)}
      </div>`;
    new Dialog({ title: "Apply Conditionals — report", content,
      buttons: { ok: { label: "Close" } }, default: "ok" }).render(true);
    console.log(`[${MOD_NS}]`, { actor: actor.name, ...res, gaps });
  }

  // --- run ---
  try {
    const actor = await resolveActor();
    if (!actor) return;
    const data = await loadData();
    const init = initAttr(actor);
    const { specs, gaps } = buildSpecs(actor, data, init);
    const { updates, weaponsTouched } = applyToWeapons(actor, specs, init);
    if (!updates.length) { ui.notifications.warn(`${actor.name}: no weapons with an attack action to apply to.`); return; }
    await actor.updateEmbeddedDocuments("Item", updates);
    const applied = specs.length * weaponsTouched;
    ui.notifications.info(`Applied ${applied} conditional(s) across ${weaponsTouched} weapon(s) on ${actor.name}.`);
    report(actor, { applied, weaponsTouched }, gaps, init);
  } catch (err) {
    console.error(`[${MOD_NS}] error:`, err);
    ui.notifications.error(`Apply Conditionals failed: ${err.message}`);
  }
})();
