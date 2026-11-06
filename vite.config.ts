import {readFileSync} from "node:fs";
import { defineConfig } from "vite";

export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**", "**/core/**", "**/target/**"] },
  },
  build: { rollupOptions: { output: { banner: "/*! highlight.js —\n"+readFileSync(new URL("./node_modules/highlight.js/LICENSE",import.meta.url),"utf8")+"\n*/" } }, target: "es2021", minify: false, sourcemap: true, outDir: "dist" },
});
