import { test, expect } from "@playwright/test";
import { SEED, unico } from "./fixtures.ts";

async function crearMascotaPropia(page: import("@playwright/test").Page, nombreCliente: string): Promise<string> {
  await page.goto("/clientes");
  await page.getByRole("button", { name: "Nuevo cliente" }).click();
  await page.getByLabel("Nombre completo *").fill(nombreCliente);
  await page.getByLabel("DNI/CUIT *").fill(String(Date.now()).slice(-10));
  await page.getByLabel("Teléfono *").fill("+54 11 5555-1234");
  await page.getByLabel("Dirección *").fill("Calle Historial 1");
  await page.getByRole("button", { name: "Registrar" }).click();
  await expect(page.getByText("Cliente registrado")).toBeVisible();

  await page.goto("/mascotas");
  await page.getByRole("button", { name: "Nueva mascota" }).click();
  const nombreMascota = unico("MascotaHist");
  await page.getByLabel("Nombre *").fill(nombreMascota);
  await page.getByRole("combobox").filter({ hasText: "Buscar tutor..." }).click();
  await page.getByPlaceholder("Buscar por nombre o DNI...").fill(nombreCliente);
  await page.getByRole("option", { name: new RegExp(nombreCliente) }).click();
  await page.getByLabel("Especie *").click();
  await page.getByRole("option", { name: "Perro" }).click();
  await page.getByLabel("Sexo *").click();
  await page.getByRole("option", { name: "Macho" }).click();
  await page.getByLabel("Tamaño *").click();
  await page.getByRole("option", { name: "Mediano" }).click();
  await page.getByRole("button", { name: "Registrar" }).click();
  await expect(page.getByText("Mascota registrada")).toBeVisible();

  return nombreMascota;
}

test("registrar evento clínico agrega una entrada al timeline", async ({ page }) => {
  await page.goto("/mascotas");
  await page.getByRole("button", { name: `Ver historial clínico de ${SEED.mascotas.firulais}` }).click();
  await page.waitForURL(/\/historial\//);

  const totalAntes = await contarEventos(page);

  await page.getByRole("button", { name: "Registrar evento" }).click();
  await page.getByLabel("Fecha *").fill(new Date().toISOString().slice(0, 10));
  await page.getByLabel("Tipo de evento *").click();
  await page.getByRole("option", { name: "Consulta" }).click();
  await page.getByLabel("Profesional *").click();
  await page.getByRole("option", { name: new RegExp(SEED.vet.nombreCompleto) }).click();
  await page.getByLabel("Descripción *").fill(unico("Control anual"));
  await page.getByRole("button", { name: "Registrar" }).click();

  await expect(page.getByText("Evento clínico registrado")).toBeVisible();
  await expect.poll(() => contarEventos(page)).toBe(totalAntes + 1);
});

async function contarEventos(page: import("@playwright/test").Page): Promise<number> {
  const texto = await page.getByText(/\d+ eventos? · Página/).textContent();
  return Number(texto?.match(/\d+/)?.[0] ?? NaN);
}

test("exportar historial en PDF dispara una descarga", async ({ page }) => {
  await page.goto("/mascotas");
  await page.getByRole("button", { name: `Ver historial clínico de ${SEED.mascotas.firulais}` }).click();
  await page.waitForURL(/\/historial\//);

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Exportar PDF" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.pdf$/);
});

test("RN-EC10/EC12: eutanasia requiere confirmación explícita y es visiblemente irreversible", async ({ page }) => {
  const nombreCliente = unico("ClienteEuta");
  const nombreMascota = await crearMascotaPropia(page, nombreCliente);

  await page.goto("/mascotas");
  await page.getByRole("button", { name: `Ver historial clínico de ${nombreMascota}` }).click();
  await page.waitForURL(/\/historial\//);

  await page.getByRole("button", { name: "Registrar eutanasia" }).click();
  const confirmar = page.getByRole("button", { name: "Confirmar eutanasia" });
  await expect(confirmar).toBeDisabled();

  await page.getByLabel("Fecha *").fill(new Date().toISOString().slice(0, 10));
  await page.getByLabel("Profesional *").click();
  await page.getByRole("option", { name: new RegExp(SEED.vet.nombreCompleto) }).click();
  await page.getByLabel("Descripción *").fill("Eutanasia por E2E — RN-EC10/EC12");

  await expect(confirmar).toBeDisabled();
  await page.getByLabel(/esta acción es irreversible/i).check();
  await expect(confirmar).toBeEnabled();

  await confirmar.click();
  await expect(page.getByText(new RegExp(`Se registró la eutanasia de ${nombreMascota}`))).toBeVisible();

  await expect(page.locator('[data-slot="badge"]', { hasText: "Fallecida" })).toBeVisible();
  await expect(page.getByText("Mascota fallecida")).toBeVisible();
  await expect(page.getByRole("button", { name: "Registrar evento" })).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Registrar eutanasia" })).not.toBeVisible();
});
