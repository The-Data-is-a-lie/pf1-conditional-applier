/**
 * Module entry point. All the work lives in apply-conditionals.js; this only publishes it.
 *
 * The "Apply Conditionals" macro in the module's compendium is a one-liner that calls
 * game.modules.get("pf1-conditional-applier").api.apply(), so the macro a user drags to their hotbar
 * never goes stale — updating the module updates what the macro runs.
 */
import { apply } from "./apply-conditionals.js";

const MOD_NS = "pf1-conditional-applier";

Hooks.once("init", () => {
  game.modules.get(MOD_NS).api = { apply };
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
