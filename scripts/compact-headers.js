/**
 * Compact header buttons. With enough modules each injecting a labeled button into a window's title
 * bar (ours included), AppV1's .window-header overflows at default sheet sizes and the close X — the
 * rightmost control — is clipped until the user widens the window by hand. Foundry v13's AppV2
 * windows already show icon-only header controls; this brings AppV1 windows in line.
 *
 * The whole feature is one world setting toggling one class on <body>; the actual collapsing lives
 * in styles/apply-conditionals.css under `body.pf1ca-compact-headers`. The only other moving part is
 * a render hook that copies each header button's label into a tooltip, since AppV1 buttons carry no
 * tooltip of their own and an icon with no hover text is a guessing game.
 *
 * Imported by main.js purely for its side effects — it registers everything itself.
 */

const MOD_NS = "pf1-conditional-applier";
const BODY_CLASS = "pf1ca-compact-headers";

function applyClass() {
  let on = true;
  try { on = game.settings.get(MOD_NS, "compactHeaderButtons"); } catch { /* pre-init: keep default */ }
  document.body.classList.toggle(BODY_CLASS, on);
}

Hooks.once("init", () => {
  game.settings.register(MOD_NS, "compactHeaderButtons", {
    name: "Compact header buttons",
    hint: "Collapse every window title-bar button to its icon (hover for the name), so the close X "
      + "stays visible no matter how many modules add header buttons.",
    scope: "world", config: true, type: Boolean, default: true, onChange: applyClass,
  });

  // Fires for every AppV1 application (AppV2 headers are icon-only natively and never see this).
  // The hook hands AppV1's inner content as html, so reach the header via app.element like
  // onRenderActorSheet does. data-tooltip feeds Foundry's own tooltip system.
  Hooks.on("renderApplication", (app) => {
    try {
      const root = app?.element?.jquery ? app.element[0] : app?.element;
      const buttons = root?.querySelectorAll?.(".window-header a.header-button") ?? [];
      for (const btn of buttons) {
        if (!btn.dataset.tooltip && !btn.title) {
          const label = btn.textContent.trim();
          if (label) btn.dataset.tooltip = label;
        }
      }
    } catch (err) {
      console.error(`[${MOD_NS}] header tooltip error:`, err);
    }
  });
});

// World settings aren't readable until the world is fully loaded; ready is the first safe moment.
Hooks.once("ready", applyClass);
