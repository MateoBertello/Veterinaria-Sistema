/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Proxy de DEV: el front llama con path relativo (/api/v1/...) y Vite lo reenvía
// a la Edge Function del stack local de Supabase. Evita CORS (es server-side).
// La función se llama "api" y Hono usa basePath("/api/v1"); por eso el nombre de
// la función ("api") coincide con el 1er segmento del basePath y la URL final es
//   http://127.0.0.1:54321/functions/v1/api/v1/<ruta>
// (el rewrite antepone /functions/v1). Verificar con `curl .../functions/v1/api/v1/health`.
const EDGE_FUNCTIONS_BASE = "http://127.0.0.1:54321";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "/api/v1": {
        target: EDGE_FUNCTIONS_BASE,
        changeOrigin: true,
        rewrite: (path) => `/functions/v1${path}`,
      },
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    css: false,
  },
});
