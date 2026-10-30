import { defineConfig } from "vite";

export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**", "**/core/**", "**/target/**"] },
  },
  build: { target: "es2021", minify: false, sourcemap: true, outDir: "dist" },
});
