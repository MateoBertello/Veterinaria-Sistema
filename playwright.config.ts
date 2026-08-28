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
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      // El spec de accesibilidad mobile mide layout/objetivos táctiles a un
      // viewport de teléfono: no aporta nada corrido en Desktop Chrome.
      testIgnore: ["**/mobile-accesibilidad.spec.ts"],
    },
    {
      // Cobertura mobile (Etapa cobertura mobile): hasta acá el único
      // proyecto E2E era Desktop Chrome, así que ningún test tocaba un
      // viewport de teléfono. Pixel 5 usa Chromium (mismo browser ya
      // instalado que "chromium" de arriba), a diferencia de un device
      // iPhone que requeriría instalar el binario de WebKit.
      name: "mobile-chromium",
      use: { ...devices["Pixel 5"] },
      // Alcance acotado a propósito: el spec de login (auth) y los flujos
      // principales de turnos y guardería, más el spec dedicado a objetivos
      // táctiles/preferencias de accesibilidad en mobile. El resto de la
      // suite (admin-login, clientes-mascotas, historial, vacunacion,
      // rn-ux1) ya corre en Desktop Chrome y no ejercita nada específico de
      // mobile más allá de lo que login/turnos/guardería ya cubren con
      // comboboxes, diálogos y formularios — correrla dos veces solo suma
      // tiempo de CI sin sumar señal.
      testMatch: [
        "**/auth.spec.ts",
        "**/turnos.spec.ts",
        "**/guarderia.spec.ts",
        "**/mobile-accesibilidad.spec.ts",
      ],
    },
  ],
  globalSetup: "./tests/e2e/global-setup.ts",
  webServer: {
    command: "npm run dev --prefix web",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: !process.env["CI"],
    timeout: 30_000,
  },
});
