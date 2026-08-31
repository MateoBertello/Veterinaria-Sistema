import { test, expect } from "@playwright/test";
import { unico } from "./fixtures.ts";

/**
 * Gestión de catálogos por clínica (especies, razas, tipos de vacuna).
 *
 * El caso que da nombre a este archivo es el segundo: crear una raza y verla
 * acto seguido en el combo de mascotas SIN recargar la página. Es el síntoma que
 * hace sentir roto un CRUD que en realidad guarda bien, y no lo cubre ningún
 * test unitario: depende del cache de lectura de `api/catalogos.ts`, de que las
 * escrituras lo invaliden y de que el navegador no sirva su propia copia. Solo
 * se ve de punta a punta, en un browser real.
 */

test("una raza recién creada aparece en el combo de mascotas sin recargar la página", async ({ page }) => {
  const nombreRaza = unico("Raza");

  // 1. Se crea la raza desde la pantalla de catálogos.
  await page.goto("/catalogos");
  await page.getByRole("tab", { name: "Razas" }).click();
  await page.getByRole("button", { name: "Nueva raza" }).click();

  // Los selectores se acotan al panel: los filtros de la pantalla siguen
  // montados detrás y "Especie" matchearía también el filtro por especie.
  const panel = page.getByRole("dialog");
  await panel.getByLabel("Especie").click();
  await page.getByRole("option", { name: "Perro" }).click();
  await panel.getByLabel("Nombre").fill(nombreRaza);
  await panel.getByRole("button", { name: "Guardar" }).click();

  await expect(page.getByText("Raza creada")).toBeVisible();
  await expect(page.getByRole("row", { name: new RegExp(nombreRaza) })).toBeVisible();

  // 2. Se navega a Mascotas DENTRO DE LA MISMA sesión de navegador: sin reload,
  //    que es justamente lo que el cache podría estar tapando.
  await page.getByRole("link", { name: "Mascotas" }).click();
  await expect(page).toHaveURL(/\/mascotas/);

  await page.getByRole("button", { name: "Nueva mascota" }).click();
  await page.getByLabel("Especie *").click();
  await page.getByRole("option", { name: "Perro" }).click();
  await page.getByLabel("Raza").click();

  // 3. La raza nueva está en el combo.
  await expect(page.getByRole("option", { name: nombreRaza })).toBeVisible();
});

test("una especie dada de baja deja de ofrecerse en el alta de mascotas (RN-CAT9)", async ({ page }) => {
  const nombreEspecie = unico("Especie");

  await page.goto("/catalogos");
  await page.getByRole("button", { name: "Nueva especie" }).click();
  const panel = page.getByRole("dialog");
  await panel.getByLabel("Nombre").fill(nombreEspecie);
  await panel.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText("Especie creada")).toBeVisible();

  // Recién creada: seleccionable en el alta de mascotas.
  await page.getByRole("link", { name: "Mascotas" }).click();
  await page.getByRole("button", { name: "Nueva mascota" }).click();
  await page.getByLabel("Especie *").click();
  await expect(page.getByRole("option", { name: nombreEspecie })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");

  // Se la da de baja (no tiene mascotas, así que RN-CAT5 no la protege).
  await page.getByRole("link", { name: "Catálogos" }).click();
  await page.getByRole("button", { name: `Dar de baja ${nombreEspecie}` }).click();
  await page.getByRole("button", { name: "Dar de baja" }).click();
  await expect(page.getByRole("row", { name: new RegExp(nombreEspecie) }))
    .toContainText("Dado de baja");

  // Y deja de ofrecerse, otra vez sin recargar.
  await page.getByRole("link", { name: "Mascotas" }).click();
  await page.getByRole("button", { name: "Nueva mascota" }).click();
  await page.getByLabel("Especie *").click();
  await expect(page.getByRole("option", { name: nombreEspecie })).toHaveCount(0);
});

test("RN-CAT5: una especie en uso no se puede dar de baja, y el motivo se ve en el diálogo", async ({ page }) => {
  await page.goto("/catalogos");

  // "Perro" la usan las mascotas del seed.
  await page.getByRole("button", { name: "Dar de baja Perro" }).click();
  await page.getByRole("button", { name: "Dar de baja" }).click();

  await expect(page.getByRole("alert")).toContainText(/mascotas registradas/i);
  // El diálogo sigue abierto con el motivo a la vista.
  await expect(page.getByRole("alertdialog")).toBeVisible();
});
