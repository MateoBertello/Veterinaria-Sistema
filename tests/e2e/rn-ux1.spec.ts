import { test, expect } from "@playwright/test";
import { SEED } from "./fixtures.ts";

// RN-UX1 (Documento Maestro): "ninguna acción frecuente (agendar, registrar
// evento, alta de cliente) debe requerir más de 3 interacciones desde el
// dashboard". Desde la Etapa 12B el aterrizaje post-login ES el dashboard ("/"),
// así que los clics se cuentan desde ahí, con la navegación real: accesos
// rápidos del panel + sidebar + botones de cada pantalla.

/** Accesos rápidos del dashboard (evita ambigüedad con el sidebar y las tarjetas). */
function accesos(page: import("@playwright/test").Page) {
  return page.getByRole("navigation", { name: "Accesos rápidos" });
}

test("RN-UX1: alta de cliente en ≤3 clics desde el dashboard", async ({ page }) => {
  await page.goto("/");
  let clics = 0;

  await accesos(page).getByRole("link", { name: "Clientes" }).click(); clics++;
  await page.getByRole("button", { name: "Nuevo cliente" }).click(); clics++;

  await expect(page.getByRole("dialog", { name: "Nuevo cliente" })).toBeVisible();
  expect(clics).toBeLessThanOrEqual(3);
});

test("RN-UX1: agendar turno en ≤3 clics desde el dashboard", async ({ page }) => {
  await page.goto("/");
  let clics = 0;

  // El acceso rápido va directo al formulario de alta: 1 solo clic.
  await accesos(page).getByRole("link", { name: "Agendar turno" }).click(); clics++;

  await expect(page).toHaveURL(/\/turnos\/nuevo$/);
  expect(clics).toBeLessThanOrEqual(3);
});

test("RN-UX1: registrar evento clínico en ≤3 clics desde el dashboard", async ({ page }) => {
  await page.goto("/");
  let clics = 0;

  // Camino más corto real de la app: Mascotas → acción de fila "Ver historial
  // clínico" → Registrar evento (evita pasar por el selector de /historial,
  // que exige elegir dueño Y mascota por separado).
  await accesos(page).getByRole("link", { name: "Mascotas" }).click(); clics++;
  await page.getByRole("button", { name: `Ver historial clínico de ${SEED.mascotas.firulais}` }).click(); clics++;
  await page.getByRole("button", { name: "Registrar evento" }).click(); clics++;

  await expect(page.getByRole("dialog", { name: "Registrar evento clínico" })).toBeVisible();
  expect(clics).toBeLessThanOrEqual(3);
});
