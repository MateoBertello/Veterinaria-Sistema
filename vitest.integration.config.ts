import { defineConfig } from "vitest/config";
import dotenv from "dotenv";

dotenv.config();

/**
 * Config aparte para `tests/integration`: cada archivo crea y borra tenants y
 * cuentas de Auth reales contra el MISMO Supabase (local o remoto) con el
 * mismo service role. Con el paralelismo de archivos por defecto de Vitest,
 * eso es contención real —no un bug de la suite—: se vio con dos corridas
 * combinadas donde falló un test distinto cada vez (siempre uno ajeno al
 * código tocado, y verde al reintentar solo), y en un teardown que no llegó a
 * completarse a tiempo dejó una cuenta de Auth huérfana que rompió la corrida
 * siguiente por email duplicado.
 *
 * La lógica de negocio (RN-xx) ya está probada en `tests/unit` con mocks, sin
 * esta contención. Acá lo único que compra el paralelismo es velocidad —18
 * archivos corren en ~12s en serie contra un Supabase local— y lo que cuesta
 * es un flake que puede tapar una falla real (ver CLAUDE.md: un verde que no
 * prueba nada es peor que un rojo). Por eso `fileParallelism: false` en vez de
 * un retry: un retry esconde el síntoma, esto elimina la causa.
 *
 * (No es un `mergeConfig` sobre `vitest.config.ts`: mergeConfig UNE los
 * arrays de `include` en vez de reemplazarlos, así que terminaba corriendo
 * también `tests/unit`.)
 */
export default defineConfig({
  test: {
    globals:         true,
    environment:     "node",
    include:         ["tests/integration/**/*.test.ts"],
    setupFiles:      ["tests/setup.ts"],
    fileParallelism: false,
  },
  resolve: {
    extensions: [".ts", ".js"],
  },
});
