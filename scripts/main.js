/**
 * Module entry point. All the work lives in apply-conditionals.js; this only publishes it and wires
 * the ways a user can trigger it.
 *
 * apply() is exposed on the module API and reached three ways, all equivalent:
 *   • the "Apply Conditionals" macro in the module's compendium (a one-liner calling api.apply()),
 *   • a button on each owned actor sheet    -> api.apply(thatActor)  (skips the chooser),
 *   • a (user-assigned) keybinding          -> api.apply().
 * Because the macro and keybinding pass no actor, apply() falls through to its own resolveActor()
 * (single controlled token, else a chooser) — so every surface works with nothing selected.
 *
 * The sheet button has two possible homes — the window header and the Settings tab's "Utility
 * Functions" section — each switched on or off by a world setting (both on by default).
 */
import { apply } from "./apply-conditionals.js";

const MOD_NS = "pf1-conditional-applier";
const HEADER_BTN = "pf1ca-apply-btn";
const UTILITY_BTN = "pf1ca-utility-btn";
const TIP = "Wire curated conditionals onto this character's weapons.";

const runApply = (actor) => game.modules.get(MOD_NS)?.api?.apply(actor);
const showing = (key) => { try { return game.settings.get(MOD_NS, key); } catch { return true; } };

// Re-render every open actor sheet so a flipped setting takes effect without reopening. AppV1 keeps
// its windows in ui.windows; AppV2 (v13) tracks them in foundry.applications.instances.
function rerenderActorSheets() {
  const apps = [...Object.values(ui.windows ?? {}),
                ...(foundry.applications?.instances?.values?.() ?? [])];
  for (const app of apps) if (app?.actor) app.render(false);
}

function makeButton(cls, actor, label) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = cls;
  btn.title = TIP;
  // `inert` on the icon mirrors pf1's own buttons — it keeps the <i> from becoming the click target.
  btn.innerHTML = `<i class="fa-solid fa-wand-magic-sparkles" inert></i> ${label}`;
  btn.addEventListener("click", (ev) => { ev.preventDefault(); ev.stopPropagation(); runApply(actor); });
  return btn;
}

// --- sheet buttons ------------------------------------------------------------------------------
// Fires on every (re)render. Both buttons are removed up front and only the enabled ones re-added,
// which is what makes turning a setting off actually clear the button on the next render.
//
// Uses app.element (the outer window) rather than the render hook's html arg: AppV1 only hands the
// inner content there, while .window-header lives on the outer element. The outer element also
// contains the tab content, so one root serves both injection sites.
function onRenderActorSheet(app) {
  try {
    const actor = app?.actor ?? app?.document;
    if (!actor?.items || actor.isOwner === false) return;
    const root = app?.element?.jquery ? app.element[0] : app?.element;
    if (!root?.querySelector) return;

    root.querySelector(`.${HEADER_BTN}`)?.remove();
    root.querySelector(`.${UTILITY_BTN}`)?.remove();

    if (showing("showHeaderButton")) {
      const header = root.querySelector(".window-header");
      if (header) {
        const btn = makeButton(HEADER_BTN, actor, "Conditionals");
        const title = header.querySelector(".window-title");
        if (title) title.after(btn); else header.prepend(btn);
      }
    }

    if (showing("showUtilityButton")) {
      // The Utility Functions column has no class of its own, but the point-buy button inside it
      // does — so take that button's parent. Falls back to the column's position under .base-setup.
      // Absent entirely on sheets without point buy (loot, vehicle…), in which case we just skip.
      const col = root.querySelector('.tab[data-tab="settings"] button.pointbuy-calculator')?.parentElement
               ?? root.querySelector('.tab[data-tab="settings"] .base-setup > div.flexcol:not(.spellbook-usage)');
      if (col) col.appendChild(makeButton(UTILITY_BTN, actor, "Apply Conditionals"));
    }
  } catch (err) {
    console.error(`[${MOD_NS}] sheet button error:`, err);
  }
}

Hooks.once("init", () => {
  game.modules.get(MOD_NS).api = { apply };

  // Where the sheet button may appear. World-scoped: the GM decides for the whole table. Registered
  // here so they exist before the first sheet renders and reads them.
  game.settings.register(MOD_NS, "showHeaderButton", {
    name: "Button in the sheet header",
    hint: "Show an Apply Conditionals button in the actor sheet's title bar.",
    scope: "world", config: true, type: Boolean, default: true, onChange: rerenderActorSheets,
  });
  game.settings.register(MOD_NS, "showUtilityButton", {
    name: "Button in Utility Functions",
    hint: "Show an Apply Conditionals button at the bottom of the character sheet's "
      + "Settings tab, under Utility Functions.",
    scope: "world", config: true, type: Boolean, default: true, onChange: rerenderActorSheets,
  });

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
