import { test, expect, type Page } from "@playwright/test";
import { SEED, fechaUnica } from "./fixtures.ts";

async function completarFormularioTurno(
  page: Page,
  opts: { cliente: string; mascota: string; fecha: string },
): Promise<void> {
  await page.goto("/turnos/nuevo");
  await page.getByRole("combobox", { name: "Servicio" }).click();
  await page.getByPlaceholder("Buscar por nombre...").fill(SEED.servicio);
  await page.getByRole("option", { name: new RegExp(SEED.servicio) }).click();

  await page.getByRole("combobox", { name: "Dueño" }).click();
  await page.getByPlaceholder("Buscar por nombre o DNI...").fill(opts.cliente);
  await page.getByRole("option", { name: new RegExp(opts.cliente) }).click();

  await page.getByLabel("Mascota").click();
  await page.getByRole("option", { name: opts.mascota }).click();

  await page.getByRole("combobox", { name: "Doctor" }).click();
  await page.getByPlaceholder("Buscar por nombre...").fill(SEED.vet.nombreCompleto);
  await page.getByRole("option", { name: new RegExp(SEED.vet.nombreCompleto) }).click();

  await page.getByLabel("Fecha *").fill(opts.fecha);
}

test("agendar turno y avanzar su transición de estado hasta Completado", async ({ page }) => {
  const fecha = fechaUnica(30);
  await completarFormularioTurno(page, { cliente: SEED.clientes.juana.nombre, mascota: SEED.mascotas.michi, fecha });

  const primerSlot = page.getByRole("group", { name: "Horarios de inicio disponibles" }).getByRole("button").first();
  const startTime = (await primerSlot.textContent())!.trim();
  await primerSlot.click();

  await page.getByLabel("Motivo *").fill("Control de rutina — E2E");
  await page.getByRole("button", { name: "Agendar y Confirmar" }).click();

  await expect(page.getByText(/Turno agendado/)).toBeVisible();
  await page.waitForURL("**/turnos");

  await page.getByLabel("Elegir fecha de la agenda").fill(fecha);
  // RN-TU5: el turno nace ya "Confirmado" (auto-confirmación) — no pasa por "Programado".
  const fila = page.getByRole("row", { name: `Turno de ${SEED.mascotas.michi} a las ${startTime}, estado Confirmado` });
  await fila.click();

  const dialogo = page.getByRole("dialog", { name: "Detalle del turno" });
  await expect(dialogo).toBeVisible();
  await dialogo.getByRole("button", { name: "Completar" }).click();
  await expect(page.getByText("Turno marcado como completado")).toBeVisible();

  // RN-MC1: Completado es terminal — el propio diálogo se refresca in-place y
  // ya no ofrece ninguna transición (RN-ES2/RN-MC4: se excluye de la agenda
  // "Activos", por eso se verifica acá y no reabriendo la fila de la lista).
  await expect(dialogo.getByText("Completado")).toBeVisible();
  await expect(dialogo.getByText("No hay acciones disponibles para este turno.")).toBeVisible();
});

test("RN-TU3: TURNO_SOLAPADO cuando dos reservas concurrentes compiten por el mismo horario del profesional", async ({ page, context }) => {
  const fecha = fechaUnica(60);
  const pageB = await context.newPage();

  await completarFormularioTurno(page, { cliente: SEED.clientes.juana.nombre, mascota: SEED.mascotas.firulais, fecha });
  await completarFormularioTurno(pageB, { cliente: SEED.clientes.carlos.nombre, mascota: SEED.mascotas.rocky, fecha });

  // Ambas páginas cargan la MISMA grilla de horarios disponibles (todavía sin
  // reservas ese día) antes de que ninguna confirme — así se simula la
  // condición de carrera real: dos recepcionistas mirando el mismo horario libre.
  const slotA = page.getByRole("group", { name: "Horarios de inicio disponibles" }).getByRole("button").first();
  const horario = (await slotA.textContent())!.trim();
  await slotA.click();
  await page.getByLabel("Motivo *").fill("Reserva A — E2E solapado");

  const slotB = pageB.getByRole("group", { name: "Horarios de inicio disponibles" }).getByRole("button", { name: horario });
  await slotB.click();
  await pageB.getByLabel("Motivo *").fill("Reserva B — E2E solapado");

  await page.getByRole("button", { name: "Agendar y Confirmar" }).click();
  await expect(page.getByText(/Turno agendado/)).toBeVisible();

  await pageB.getByRole("button", { name: "Agendar y Confirmar" }).click();
  await expect(pageB.getByRole("alert")).toContainText(/solapa/i);
  await expect(pageB).toHaveURL(/\/turnos\/nuevo$/);

  await pageB.close();
});
