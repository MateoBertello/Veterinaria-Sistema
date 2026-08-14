import { defineConfig, devices } from "@playwright/test";

/**
 * E2E (Etapa 9 — S9). Requiere la stack local levantada y seedeada ANTES de
 * correr `npx playwright test`:
 *   1. supabase start
 *   2. supabase functions serve --no-verify-jwt   (o el edge-runtime que ya
 *      trae `supabase start`, según la versión de la CLI)
 *   3. npm run seed   (credenciales admin_demo/Demo1234!)
 * `webServer` solo levanta el front (Vite); no orquesta Supabase.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  retries: 0,
  reporter: "html",
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "retain-on-failure",
    storageState: "playwright/.auth/admin.json",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  globalSetup: "./tests/e2e/global-setup.ts",
  webServer: {
    command: "npm run dev --prefix web",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: !process.env["CI"],
    timeout: 30_000,
  },
});
