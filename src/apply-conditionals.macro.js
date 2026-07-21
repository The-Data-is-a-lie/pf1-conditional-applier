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
    const subSph = makeSubSph(actor);              // @spheres.* -> concrete forms for a dabbler (else no-op)

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
    return { specs, gaps };
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
    if (!Array.isArray(action.conditionals)) action.conditionals = [];
    const prev = new Set((src.flags?.[MOD_NS]?.condIds) || []);
    action.conditionals = action.conditionals.filter(c => !(c && prev.has(c._id)));   // drop our old ones
    const seen = new Set(action.conditionals.map(c => c && c.name));                  // keep hand-made
    const newIds = [];

    // Inert section dividers (empty modifiers => an unchecked checkbox that does nothing) so the
    // long attack-dialog list reads as grouped: General -> Path of War -> Spheres -> Spells.
    const GENERAL_LABEL = "──────  GENERAL (FEATS & ITEMS)  ──────";
    const SECT_LABEL = {
      "Path of War": "──────  PATH OF WAR  ──────",
      "Spheres of Power/Might": "──────  SPHERES  ──────",
      "Spells": "──────  SPELLS  ──────",
    };
    const RANK = { "Path of War": 0, "Spheres of Power/Might": 1, "Spells": 2 };
    const sep = (seed, name) => {
      const sid = detId(seed, 8);
      newIds.push(sid);
      return { _id: sid, name, default: false, modifiers: [] };
    };

    // A "General" header above the feat/item conditionals already on the weapon (kept above, not in
    // `rows`). Only when some remain, so a weapon with no feat/item conditionals gets no empty header.
    if (action.conditionals.length) {
      action.conditionals.unshift(sep(`${weaponId}|__sep__|general`, GENERAL_LABEL));
    }

    // Enforce the section order (natural spec order already matches; this makes it robust).
    const ordered = rows
      .map((r, i) => ({ r, i }))
      .sort((a, b) => ((RANK[a.r.section] ?? 9) - (RANK[b.r.section] ?? 9)) || (a.i - b.i))
      .map(x => x.r);

    let curSection = null;
    for (const r of ordered) {
      if (!r.include || !r.name || seen.has(r.name)) continue;
      if (r.section && r.section !== curSection && SECT_LABEL[r.section]) {   // first row of a section
        curSection = r.section;
        action.conditionals.push(sep(`${weaponId}|__sep__|${r.section}`, SECT_LABEL[r.section]));
      }
      seen.add(r.name);
      const seed = `${weaponId}|${r.origName}`;                 // seed on the STABLE build-time name
      const cid = detId(seed, 8);
      action.conditionals.push({
        _id: cid, name: r.name, default: !!r.def,
        modifiers: (r.rawMods || []).map((m, i) => mkMod(m, r.srcName, seed, i, init)),
      });
      newIds.push(cid);
    }
    return { _id: weaponId, "system.actions": actions, [`flags.${MOD_NS}.condIds`]: newIds };
  }

  // --- the per-weapon review/edit dialog (stays open; edits persist to an actor flag) ---
  function openDialog(actor, specs, gaps, init) {
    const esc = s => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const weapons = actor.items.filter(i => i.type === "weapon" || i.type === "attack");
    if (!weapons.length) { ui.notifications.warn(`${actor.name}: no weapon/attack items to apply to.`); return; }
    // Persisted per-weapon overrides: { [weaponId]: { [origName]: {include, default, name} } }.
    // Read/write the RAW flags object (not getFlag/setFlag — those reject an unregistered scope, and
    // this macro isn't an installed module; a direct document update accepts any flag path, exactly
    // like the per-weapon condIds flag below).
    const overrides = foundry.utils.deepClone(actor.flags?.[MOD_NS]?.overrides || {});

    // Build the editable row state for a weapon from specs + any saved overrides.
    const rowsFor = weaponId => {
      const ov = overrides[weaponId] || {};
      return specs.map(s => {
        const o = ov[s.name] || {};
        return {
          origName: s.name, srcName: s.srcName, rawMods: s.rawMods, section: s.section,
          include: o.include !== undefined ? o.include : true,
          def: o.default !== undefined ? o.default : !!s.default,
          name: o.name !== undefined ? o.name : s.name,
        };
      });
    };

    let curWeaponId = weapons[0].id, curActionIdx = 0, curRows = [];

    const rowHtml = (r, i) => {
      const mods = (r.rawMods || []).map(m => `${m.formula} → ${m.target}`).join(", ") || "—";
      const editable = String(r.name).split("; ").join(";\n");   // one clause per line for editing
      return `<details class="cond-row" data-i="${i}" style="border:1px solid rgba(0,0,0,.15);border-radius:4px;margin:3px 0;padding:1px 6px">
        <summary style="cursor:pointer;list-style:none">
          <label style="cursor:pointer"><input type="checkbox" class="inc" ${r.include ? "checked" : ""}></label>
          <strong>${esc(String(r.name).split(":")[0].slice(0, 70))}</strong>
        </summary>
        <div style="padding:4px 2px 6px">
          <label style="font-size:.85em"><input type="checkbox" class="def" ${r.def ? "checked" : ""}> on by default (per-roll)</label>
          <textarea class="txt" rows="4" style="width:100%;font-size:.82em;font-family:monospace">${esc(editable)}</textarea>
          <div style="font-size:.78em;opacity:.7">modifiers: ${esc(mods)}</div>
        </div>
      </details>`;
    };

    const weaponOpts = weapons.map(w => `<option value="${w.id}">${esc(w.name)} [${w.type}]</option>`).join("");
    const li = arr => arr.length ? `<ul style="margin:.2em 0 .5em 1em">${arr.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : `<em>none</em>`;
    const gapCount = gaps.spells.length + gaps.maneuvers.length + gaps.talents.length;
    const content = `
      <div style="min-width:520px">
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:4px">
          <label>Weapon: <select id="weapon-sel" style="max-width:250px">${weaponOpts}</select></label>
          <span id="action-wrap" style="display:none"></span>
          <button type="button" id="toggle-all"><i class="fas fa-check-double"></i> All on/off</button>
          <button type="button" id="apply-weapon"><i class="fas fa-check"></i> Apply to this weapon</button>
        </div>
        <p style="font-size:.78em;margin:.2em 0;opacity:.75">Uncheck to exclude a conditional; expand a row to edit its clauses or per-roll default. Edits persist per weapon and survive re-runs.</p>
        <div id="cond-rows" style="max-height:52vh;overflow:auto"></div>
        <hr>
        <details style="font-size:.85em"><summary>Curation gaps (${gapCount})</summary>
          <div style="max-height:22vh;overflow:auto">
            <strong>Spells (${gaps.spells.length})</strong>${li(gaps.spells)}
            <strong>Maneuvers (${gaps.maneuvers.length})</strong>${li(gaps.maneuvers)}
            <strong>Talents (${gaps.talents.length})</strong>${li(gaps.talents)}
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
        const sectionHeader = name => `<div class="cond-section" style="display:flex;align-items:center;gap:8px;margin:8px 0 2px;padding-bottom:2px;border-bottom:1px solid rgba(0,0,0,.25)">
          <strong style="flex:1">${esc(name)}</strong>
          <button type="button" class="toggle-section" data-section="${esc(name)}" style="font-size:.8em">All on/off</button>
        </div>`;
        const renderRows = () => {
          curRows = rowsFor(curWeaponId);
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
        html.on("change", "#action-sel", ev => { curActionIdx = +ev.target.value; });
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

        renderActionSel();
        renderRows();
      },
    }, { width: 600, resizable: true }).render(true);
  }

  // --- run ---
  try {
    const actor = await resolveActor();
    if (!actor) return;
    const data = await loadData();
    const init = initAttr(actor);
    const { specs, gaps } = buildSpecs(actor, data, init);
    openDialog(actor, specs, gaps, init);
  } catch (err) {
    console.error(`[${MOD_NS}] error:`, err);
    ui.notifications.error(`Apply Conditionals failed: ${err.message}`);
  }
})();
