/**
 * Module entry point. All the work lives in apply-conditionals.js; this only publishes it and wires
 * the ways a user can trigger it.
 *
 * apply() is exposed on the module API and reached three ways, all equivalent:
 *   • the "Apply Conditionals" macro in the module's compendium (a one-liner calling api.apply()),
 *   • a button in each owned actor sheet's header  -> api.apply(thatActor)  (skips the chooser),
 *   • a (user-assigned) keybinding                  -> api.apply().
 * Because the macro and keybinding pass no actor, apply() falls through to its own resolveActor()
 * (single controlled token, else a chooser) — so every surface works with nothing selected.
 */
import { apply } from "./apply-conditionals.js";

const MOD_NS = "pf1-conditional-applier";

const runApply = (actor) => game.modules.get(MOD_NS)?.api?.apply(actor);

// --- character-sheet header button --------------------------------------------------------------
// Fires on every (re)render, so it removes any button it already added before adding a fresh one.
// Uses app.element (the outer window) rather than the render hook's html arg, because AppV1 only
// hands the inner content there — the .window-header lives on the outer element in both v1 and v2.
function onRenderActorSheet(app) {
  try {
    const actor = app?.actor ?? app?.document;
    if (!actor?.items || actor.isOwner === false) return;
    const appEl = app?.element?.jquery ? app.element[0] : app?.element;
    const header = appEl?.querySelector?.(".window-header");
    if (!header) return;
    header.querySelector(".pf1ca-apply-btn")?.remove();
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pf1ca-apply-btn";
    btn.title = "Wire curated conditionals onto this character's weapons.";
    btn.innerHTML = `<i class="fas fa-wand-magic-sparkles"></i> Conditionals`;
    btn.addEventListener("click", (ev) => { ev.preventDefault(); ev.stopPropagation(); runApply(actor); });
    const title = header.querySelector(".window-title");
    if (title) title.after(btn); else header.prepend(btn);
  } catch (err) {
    console.error(`[${MOD_NS}] sheet button error:`, err);
  }
}

Hooks.once("init", () => {
  game.modules.get(MOD_NS).api = { apply };

  // AppV1 sheets fire renderActorSheet; AppV2 (pf1 on Foundry v13) fires renderActorSheetV2.
  for (const hook of ["renderActorSheet", "renderActorSheetV2"]) Hooks.on(hook, onRenderActorSheet);

  // Keybinding: no default key (editable: []) so it never collides — the user assigns one in
  // Configure Controls. Discovery of the feature comes from the visible sheet/toolbar buttons.
  game.keybindings.register(MOD_NS, "apply", {
    name: "Apply Conditionals",
    hint: "Wire curated conditionals onto the selected token's weapons (or pick a character).",
    editable: [],
    onDown: () => { runApply(); return true; },
  });
});

Hooks.once("ready", () => {
  // Every table this reads (weapon actions, conditionals, spellbooks, @classes.<tag>.level) is pf1
  // data, so on another system the macro would only ever find nothing. Say so once, up front.
  if (game.system.id !== "pf1") {
    console.warn(`[${MOD_NS}] inactive: this module targets the pf1 system, but the world runs `
      + `"${game.system.id}".`);
    if (game.user.isGM) {
      ui.notifications.warn("PF1 Conditional Applier requires the Pathfinder 1e system.");
    }
  }
});
