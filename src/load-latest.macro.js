/**
 * Loader — paste this ONCE into a Foundry Script macro, then never again.
 *
 * A pasted Script macro stores its code in the world database, so rebuilding the bundle does nothing
 * for a macro you already pasted. This macro instead FETCHES the bundled file from the FoundryVTT
 * user Data dir (Foundry serves that dir over HTTP) and runs it, so whatever build/bundle_macro.py
 * last wrote is what runs — no re-paste after a data refresh or a macro edit.
 *
 * Requires the deploy copy that build/bundle_macro.py writes on every build:
 *   <FoundryVTT user data>/Data/pf1-conditional-applier/apply-conditionals.deployed.js
 * That is deliberately NOT the repo's apply-conditionals.bundled.js: the deploy folder may be a
 * clone of the repo, and a build overwriting a tracked file there would block git pull. Change PATH
 * below (and PF1CA_DEPLOY on the bundler side) if you keep it somewhere else under Data/.
 *
 * Prefer no moving parts? apply-conditionals.bundled.js still works pasted directly — it just has to
 * be re-pasted whenever it is rebuilt.
 */
(async () => {
  const PATH = "pf1-conditional-applier/apply-conditionals.deployed.js";
  try {
    // Cache-bust so a rebuild is picked up in the same session, not served from the browser cache.
    const res = await fetch(`${PATH}?v=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} for Data/${PATH} — has the bundler deployed it there yet?`);
    }
    const src = await res.text();
    // The bundle is a self-invoking async IIFE; run it in its own function scope, not via a script
    // tag, so it still sees game/ui/canvas exactly as a pasted macro would.
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    await new AsyncFunction(src)();
  } catch (err) {
    console.error("[pf1-conditional-applier] loader:", err);
    ui.notifications.error(`Could not load Apply Conditionals: ${err.message}`);
  }
})();
