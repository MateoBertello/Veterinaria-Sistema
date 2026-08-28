import { test, expect } from "@playwright/test";
import { SEED, unico } from "./fixtures.ts";

test("alta encadenada: cliente nuevo → mascota nueva con ese dueño", async ({ page }) => {
  const nombreCliente = unico("Cliente");
  const dni = String(Date.now()).slice(-10);

  await page.goto("/clientes");
  await page.getByRole("button", { name: "Nuevo cliente" }).click();
  await page.getByLabel("Nombre completo *").fill(nombreCliente);
  await page.getByLabel("DNI/CUIT *").fill(dni);
  await page.getByLabel("Teléfono *").fill("+54 11 5555-9999");
  await page.getByLabel("Dirección *").fill("Calle Test 100");
  await page.getByRole("button", { name: "Registrar" }).click();
  await expect(page.getByText("Cliente registrado")).toBeVisible();

  await page.goto("/mascotas");
  await page.getByRole("button", { name: "Nueva mascota" }).click();

  const nombreMascota = unico("Mascota");
  await page.getByLabel("Nombre *").fill(nombreMascota);

  await page.getByRole("combobox").filter({ hasText: "Buscar tutor..." }).click();
  await page.getByPlaceholder("Buscar por nombre o DNI...").fill(nombreCliente);
  await page.getByRole("option", { name: new RegExp(nombreCliente) }).click();

  await page.getByLabel("Especie *").click();
  await page.getByRole("option", { name: "Perro" }).click();
  await page.getByLabel("Raza").click();
  await page.getByRole("option", { name: "Mestizo" }).click();
  await page.getByLabel("Sexo *").click();
  await page.getByRole("option", { name: "Macho" }).click();
  await page.getByLabel("Tamaño *").click();
  await page.getByRole("option", { name: "Mediano" }).click();

  await page.getByRole("button", { name: "Registrar" }).click();
  await expect(page.getByText("Mascota registrada")).toBeVisible();
  await expect(page.getByRole("row", { name: new RegExp(nombreMascota) })).toBeVisible();
});

test("búsqueda de clientes filtra por nombre", async ({ page }) => {
  await page.goto("/clientes");
  await page.getByRole("searchbox", { name: "Buscar clientes" }).fill(SEED.clientes.juana.nombre);

  await expect(page.getByRole("row", { name: new RegExp(SEED.clientes.juana.nombre) })).toBeVisible();
  await expect(page.getByRole("row", { name: new RegExp(SEED.clientes.carlos.nombre) })).not.toBeVisible();
});

test("cambio de dueño de una mascota nueva (no toca los fixtures fijos del seed)", async ({ page }) => {
  // Mascota propia de este test (evita mutar Firulais/Michi/Rocky para el resto de la suite).
  await page.goto("/mascotas");
  await page.getByRole("button", { name: "Nueva mascota" }).click();
  const nombreMascota = unico("CambioDueno");
  await page.getByLabel("Nombre *").fill(nombreMascota);
  await page.getByRole("combobox").filter({ hasText: "Buscar tutor..." }).click();
  await page.getByPlaceholder("Buscar por nombre o DNI...").fill(SEED.clientes.juana.nombre);
  await page.getByRole("option", { name: new RegExp(SEED.clientes.juana.nombre) }).click();
  await page.getByLabel("Especie *").click();
  await page.getByRole("option", { name: "Gato" }).click();
  await page.getByLabel("Sexo *").click();
  await page.getByRole("option", { name: "Hembra" }).click();
  await page.getByLabel("Tamaño *").click();
  await page.getByRole("option", { name: "Pequeño" }).click();
  await page.getByRole("button", { name: "Registrar" }).click();
  await expect(page.getByText("Mascota registrada")).toBeVisible();

  const fila = page.getByRole("row", { name: new RegExp(nombreMascota) });
  await fila.getByRole("button", { name: `Cambiar tutor de ${nombreMascota}` }).click();

  await page.getByRole("combobox").filter({ hasText: "Buscar nuevo tutor..." }).click();
  await page.getByPlaceholder("Buscar por nombre o DNI...").fill(SEED.clientes.carlos.nombre);
  await page.getByRole("option", { name: new RegExp(SEED.clientes.carlos.nombre) }).click();
  await page.getByRole("button", { name: "Confirmar cambio" }).click();

  await expect(page.getByText("Tutor cambiado correctamente")).toBeVisible();
  await expect(page.getByRole("row", { name: new RegExp(nombreMascota) })).toContainText(SEED.clientes.carlos.nombre);
});

test("RN-CL3: DNI duplicado al crear cliente muestra error de campo, no toast", async ({ page }) => {
  await page.goto("/clientes");
  await page.getByRole("button", { name: "Nuevo cliente" }).click();
  await page.getByLabel("Nombre completo *").fill(unico("Duplicado"));
  await page.getByLabel("DNI/CUIT *").fill(SEED.clientes.juana.dni);
  await page.getByLabel("Teléfono *").fill("+54 11 5555-0000");
  await page.getByLabel("Dirección *").fill("Calle Duplicada 1");
  await page.getByRole("button", { name: "Registrar" }).click();

  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByText("Cliente registrado")).not.toBeVisible();
});
