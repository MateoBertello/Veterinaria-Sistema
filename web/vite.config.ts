/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Proxy de DEV: el front llama con paths relativos y Vite los reenvía al stack
// local de Supabase (evita CORS, es server-side).
//   /api/v1/*  → Edge Function "api" (Hono). Rewrite: antepone /functions/v1.
//   /rest/v1/* → PostgREST directo (catálogos globales sin Controller/Service).
//               La apikey se inyecta aquí (server-side) para que nunca entre al
//               bundle del front. El front solo envía el Bearer del usuario.
//               Leer de SUPABASE_ANON_KEY (sin prefijo VITE_); fallback = clave
//               pública del dev local de Supabase CLI (siempre la misma).
const EDGE_FUNCTIONS_BASE = "http://127.0.0.1:54321";
const SUPABASE_ANON_KEY =
  process.env["SUPABASE_ANON_KEY"] ??
  // Clave anon del CLI local de Supabase — pública y fija para todo proyecto local.
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRFA0NiK7kyqd6-g51S9A17u5JkA4YiD7WkbXSj9fJ4";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "/api/v1": {
        target: EDGE_FUNCTIONS_BASE,
        changeOrigin: true,
        rewrite: (path) => `/functions/v1${path}`,
      },
      "/rest/v1": {
        target: EDGE_FUNCTIONS_BASE,
        changeOrigin: true,
        headers: { "apikey": SUPABASE_ANON_KEY },
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
