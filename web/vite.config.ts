import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Keep one shared, gitignored .env at the monorepo root.
  envDir: "..",
  server: { port: 5173 },
  preview: { port: 4173 },
});

