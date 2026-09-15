import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
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
