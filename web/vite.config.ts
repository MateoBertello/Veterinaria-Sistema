/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from "vite";
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

export default defineConfig(({ command, mode }) => {
  // `vite build` es el único comando que produce el bundle que se despliega:
  // ahí (y solo ahí, `vite preview` resuelve con command "serve" y no debe
  // frenarse) hace falta que quien buildea haya decidido a propósito cómo
  // llega el front a la API. Sin este chequeo, un build sin VITE_API_URL cae
  // en el default relativo `/api/v1` de src/api/client.ts y, en un hosting
  // estático con SPA fallback (Vercel/Netlify, ver docs/DEPLOY.md §4), ese
  // path puede resolver contra el propio index.html: el login falla en
  // silencio (200 con HTML) en vez de con un error visible.
  if (command === "build") {
    const env = loadEnv(mode, process.cwd(), "");
    const apiUrl = env["VITE_API_URL"];
    const proxyAck = env["VITE_API_PROXY_ACK"];
    if (!apiUrl && proxyAck !== "1") {
      throw new Error(
        "\n\n" +
        "BUILD ABORTADO — falta VITE_API_URL (o la confirmación de proxy).\n" +
        "Ver docs/DEPLOY.md §4 'Frontend'. Elegí una de las dos:\n\n" +
        "  · Hosting estático sin proxy (Vercel/Netlify, Opción A): seteá\n" +
        "    VITE_API_URL con la URL absoluta de la Edge Function, ej.\n" +
        "    https://<project-ref>.supabase.co/functions/v1/api/v1\n\n" +
        "  · Reverse proxy same-origin (VPS, Opción B): seteá\n" +
        "    VITE_API_PROXY_ACK=1 para confirmar a propósito que el default\n" +
        "    relativo /api/v1 es correcto porque el proxy lo resuelve.\n\n" +
        "Sin ninguna de las dos, el build queda ambiguo y el síntoma es un\n" +
        "login que falla solo en producción (200 con HTML del SPA fallback\n" +
        "en vez de la respuesta de la API).\n",
      );
    }
  }

  return {
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
  };
});
