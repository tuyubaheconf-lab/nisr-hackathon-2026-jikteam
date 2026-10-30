import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // relative paths: the same build works on Vercel, Netlify or GitHub Pages
  base: "./",
  build: { outDir: "dist", chunkSizeWarningLimit: 900 },
});
