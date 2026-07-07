import { test, expect } from "@playwright/test";
import { SEED } from "./fixtures.ts";

// RN-UX1 (Documento Maestro): "ninguna acción frecuente (agendar, registrar
// evento, alta de cliente) debe requerir más de 3 interacciones desde el
// dashboard". La app no tiene una pantalla de "dashboard" dedicada — el
// aterrizaje post-login es /clientes (App.tsx: "/" redirige ahí) — así que acá
// se cuenta desde esa pantalla, con la navegación real (sidebar + botones).

test("RN-UX1: alta de cliente en ≤3 clics desde el aterrizaje", async ({ page }) => {
  await page.goto("/clientes");
  let clics = 0;

  await page.getByRole("button", { name: "Nuevo cliente" }).click(); clics++;

  await expect(page.getByRole("dialog", { name: "Nuevo cliente" })).toBeVisible();
  expect(clics).toBeLessThanOrEqual(3);
});

test("RN-UX1: agendar turno en ≤3 clics desde el aterrizaje", async ({ page }) => {
  await page.goto("/clientes");
  let clics = 0;

  await page.getByRole("link", { name: "Turnos" }).click(); clics++;
  await page.getByRole("button", { name: "Nuevo turno" }).click(); clics++;

  await expect(page).toHaveURL(/\/turnos\/nuevo$/);
  expect(clics).toBeLessThanOrEqual(3);
});

test("RN-UX1: registrar evento clínico en ≤3 clics desde el aterrizaje", async ({ page }) => {
  await page.goto("/clientes");
  let clics = 0;

  // Camino más corto real de la app: Mascotas → acción de fila "Ver historial
  // clínico" → Registrar evento (evita pasar por el selector de /historial,
  // que exige elegir dueño Y mascota por separado).
  await page.getByRole("link", { name: "Mascotas" }).click(); clics++;
  await page.getByRole("button", { name: `Ver historial clínico de ${SEED.mascotas.firulais}` }).click(); clics++;
  await page.getByRole("button", { name: "Registrar evento" }).click(); clics++;

  await expect(page.getByRole("dialog", { name: "Registrar evento clínico" })).toBeVisible();
  expect(clics).toBeLessThanOrEqual(3);
});
