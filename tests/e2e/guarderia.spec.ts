import { test, expect, type Page } from "@playwright/test";
import { SEED, fechaUnica, sumarDias } from "./fixtures.ts";

async function registrarEstadia(
  page: Page,
  opts: { cliente: string; mascota: string; checkIn: string; checkOut: string },
): Promise<void> {
  await page.goto("/guarderia/nuevo");
  await page.getByRole("combobox", { name: "Dueño" }).click();
  await page.getByPlaceholder("Buscar por nombre o DNI...").fill(opts.cliente);
  await page.getByRole("option", { name: new RegExp(opts.cliente) }).click();
  await page.getByLabel("Mascota").click();
  await page.getByRole("option", { name: opts.mascota }).click();
  await page.getByLabel("Check-in *").fill(opts.checkIn);
  await page.getByLabel("Check-out *").fill(opts.checkOut);
  await page.getByLabel("Motivo *").fill("Estadía E2E");
  await page.getByRole("button", { name: "Registrar Estadía" }).click();
}

test("alta de estadía + check-in y check-out", async ({ page }) => {
  const checkIn = fechaUnica(100);
  const checkOut = sumarDias(checkIn, 1);

  await registrarEstadia(page, {
    cliente: SEED.clientes.carlos.nombre,
    mascota: SEED.mascotas.rocky,
    checkIn,
    checkOut,
  });
  await expect(page.getByText(new RegExp(`Estadía registrada: ${SEED.mascotas.rocky}`))).toBeVisible();

  await page.goto("/guarderia");
  await page.getByLabel("Elegir fecha de la ocupación").fill(checkIn);

  const fila = page.getByRole("row", { name: `Estadía de ${SEED.mascotas.rocky}, estado Reservada` });
  await expect(fila).toBeVisible();
  await fila.getByRole("button", { name: "Check-in" }).click();
  await expect(page.getByText(`Check-in de ${SEED.mascotas.rocky} registrado`)).toBeVisible();

  const filaEnCurso = page.getByRole("row", { name: `Estadía de ${SEED.mascotas.rocky}, estado En curso` });
  await filaEnCurso.getByRole("button", { name: "Check-out" }).click();
  await expect(page.getByText(`Check-out de ${SEED.mascotas.rocky} registrado`)).toBeVisible();
  await expect(page.getByRole("row", { name: `Estadía de ${SEED.mascotas.rocky}, estado Finalizada` })).toBeVisible();
});

test("RN-ME2: CUPO_GUARDERIA_AGOTADO cuando el día ya está al máximo de cupo", async ({ page }) => {
  await page.goto("/configuracion");
  const cupoInput = page.getByLabel("Cupo máximo diario");
  const cupoOriginal = await cupoInput.inputValue();
  await cupoInput.fill("1");
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.getByText("Configuración actualizada")).toBeVisible();

  try {
    const checkIn = fechaUnica(200);
    const checkOut = sumarDias(checkIn, 1);

    // Primera estadía del día: ocupa el único cupo disponible.
    await registrarEstadia(page, {
      cliente: SEED.clientes.juana.nombre,
      mascota: SEED.mascotas.michi,
      checkIn,
      checkOut,
    });
    await expect(page.getByText(new RegExp(`Estadía registrada: ${SEED.mascotas.michi}`))).toBeVisible();

    // Segunda mascota, mismo día: sin cupo.
    await registrarEstadia(page, {
      cliente: SEED.clientes.juana.nombre,
      mascota: SEED.mascotas.firulais,
      checkIn,
      checkOut,
    });
    await expect(page.getByText("No hay cupo de guardería disponible en los días seleccionados")).toBeVisible();
  } finally {
    await page.goto("/configuracion");
    await page.getByLabel("Cupo máximo diario").fill(cupoOriginal);
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    await expect(page.getByText("Configuración actualizada")).toBeVisible();
  }
});
