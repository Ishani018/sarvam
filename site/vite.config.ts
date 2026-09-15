import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

/**
 * The absolute origin this deploys to.
 *
 * Open Graph images have to be absolute URLs. They were written root-relative
 * -- `/og-card.png` -- and `base: "./"` quietly rewrote them to `./og-card.png`
 * in the built HTML, which some scrapers refuse to resolve. The source looked
 * right and the shipped file was wrong, which is the failure mode worth
 * engineering against rather than fixing once.
 *
 * So the origin is resolved here and substituted into index.html as
 * `%SITE_ORIGIN%`, a token Vite's asset rewriting does not touch.
 *
 * Preference order, and why:
 *
 *   SITE_ORIGIN                     an explicit override, for a custom domain
 *   VERCEL_PROJECT_PRODUCTION_URL   Vercel's own name for the project's stable
 *                                   production host. It follows a project
 *                                   rename automatically, which is the whole
 *                                   point: renaming the project must not
 *                                   silently break the preview card.
 *   the fallback below              local builds, and any host that sets
 *                                   neither
 *
 * Deliberately NOT VERCEL_URL: that is the per-deployment host and changes on
 * every push, so a card pointing at it would rot the moment the next deploy
 * lands.
 */
const FALLBACK_ORIGIN = "https://sarvam-vgsi.vercel.app";

function siteOrigin(): string {
  const explicit = process.env.SITE_ORIGIN?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercel) return `https://${vercel.replace(/^https?:\/\//, "").replace(/\/$/, "")}`;
  return FALLBACK_ORIGIN;
}

/** Substitute %SITE_ORIGIN% after Vite has finished rewriting asset paths. */
function originTokens(): Plugin {
  const origin = siteOrigin();
  return {
    name: "ginti-site-origin",
    enforce: "post",
    transformIndexHtml(html) {
      return html.replaceAll("%SITE_ORIGIN%", origin);
    },
    closeBundle() {
      console.log(`  site origin: ${origin}`);
    },
  };
}

export default defineConfig({
  plugins: [react(), originTokens()],
  // Relative base so dist/ can be served from any path, not just a domain root.
  base: "./",
  build: {
    assetsInlineLimit: 0,
    // Two entries: the page, and the source for the 1200x630 link preview.
    // The card is a separate entry rather than a route so none of it reaches
    // the page bundle, and a component rather than handwritten HTML in the
    // generator so it uses the same tokens and the same diff logic the page
    // does.
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        card: resolve(__dirname, "card.html"),
      },
    },
  },
});
