import { resolve } from "path";
import { writeFileSync } from "fs";
import { fileURLToPath } from "node:url";
import SystemData from "./system.json";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";
import Components from "unplugin-vue-components/vite";
import { viteStaticCopy } from "vite-plugin-static-copy";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  base: `/systems/${SystemData.id}/`,

  resolve: {
    conditions: ["import", "browser"],
    alias: {
      "~": resolve(__dirname, "src"),
      "@": resolve(__dirname, "src")
    }
  },

  esbuild: {
    target: ["es2022"],
    keepNames: true // Preserve function and class names for Foundry globals
  },

  css: {
    // Creates a standard configuration for PostCSS with autoprefixer & postcss-preset-env.
    // postcss: postcssConfig({ compress: s_COMPRESS, sourceMap: s_SOURCEMAPS })
    devSourcemap: true,
    preprocessorOptions: {
      scss: {
        silenceDeprecations: ["import"]
      }
    }
  },

  define: {
    "process.env.NODE_ENV": JSON.stringify(mode)
  },

  server: {
    port: 5173,
    open: false,
    allowedHosts: ["fvtt-dev.dev", "localhost"],
    proxy: {
      // Serves static files from main Foundry server.
      [`^/(systems/${SystemData.id}/(images|assets|lang|packs|style\\.css))`]:
        "http://localhost:30000",

      // All other paths besides package ID path are served from main Foundry server.
      [`^/(?!` +
      [
        `systems/${SystemData.id}/@vite\\/client`,
        `systems/${SystemData.id}/@id`,
        `systems/${SystemData.id}/.*?/env.mjs$`,
        `systems/${SystemData.id}/node_systems/.vite/.*`,
        `systems/${SystemData.id}/`,
        `/${SystemData.id}/`
      ].join("|") +
      ")"]: "http://localhost:30000",

      // Enable socket.io from main Foundry server.
      "/socket.io": { target: "ws://localhost:30000", ws: true }
    }
  },

  preview: {
    allowedHosts: ["fvtt-dev.dev", "localhost"],
    port: 5173,
    proxy: {
      // Serves static files from main Foundry server.
      [`^/(systems/${SystemData.id}/(images|assets|lang|packs|style\\.css))`]:
        "http://localhost:30000",

      // All other paths besides package ID path are served from main Foundry server.
      [`^/(?!` +
      [
        `systems/${SystemData.id}/@vite\\/client`,
        `systems/${SystemData.id}/@id`,
        `systems/${SystemData.id}/.*?/env.mjs$`,
        `systems/${SystemData.id}/node_systems/.vite/.*`,
        `systems/${SystemData.id}/src/`
      ].join("|") +
      ")"]: "http://localhost:30000",

      // Enable socket.io from main Foundry server.
      "/socket.io": { target: "ws://localhost:30000", ws: true }
    }
  },

  build: {
    outDir: resolve(__dirname, "dist"),
    sourcemap: true,
    target: ["es2022"],
    // Use esbuild for minification but preserve function/class names for Foundry compatibility
    minify: "esbuild",
    manifest: false,
    lib: {
      name: "faserip",
      entry: "./src/faserip.ts",
      formats: ["es"],
      fileName: () => "faserip.js",
      cssFileName: "styles/faserip"
    },
    rollupOptions: {
      output: {
        assetFileNames: assetInfo => {
          if (assetInfo.name === "style.css") return "faserip.css";
          return assetInfo.name!;
        }
      },
      onwarn(warning, warn) {
        // Ignore sourcemap warnings
        if (warning.code === "SOURCEMAP_BROKEN") {
          return;
        }
        warn(warning);
      }
    }
  },

  // Necessary when using the dev server for top-level await usage inside of TRL.
  optimizeDeps: {
    esbuildOptions: {
      target: "es2022"
    }
  },

  plugins: [
    vue(),
    {
      name: "vite-plugin-system-json",
      closeBundle() {
        const jsFile = "faserip.js";
        const cssFiles = ["styles/faserip.css"];

        // Build system.json
        const systemJson = { ...SystemData } as Record<string, unknown>;
        delete systemJson.scripts;
        systemJson.esmodules = [jsFile];
        systemJson.styles = cssFiles;

        // Write system.json
        const outputPath = resolve(__dirname, "dist/system.json");
        writeFileSync(outputPath, JSON.stringify(systemJson, null, 2));
      }
    },
    tailwindcss(),
    Components({
      dts: false,
      dirs: []
    }),
    mode === "production"
      ? viteStaticCopy({
          targets: [
            {
              src: "src/module/templates",
              dest: "templates",
              rename: { stripBase: 3 }
            },
            { src: "template.json", dest: "" },
            { src: "lang", dest: "" }
          ]
        })
      : null
  ]
}));
