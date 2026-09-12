import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Relative base so dist/ can be served from any path, not just a domain root.
  base: "./",
  build: { assetsInlineLimit: 0 },
});
