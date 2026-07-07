import { test, expect } from "@playwright/test";
import { SEED, fechaUnica } from "./fixtures.ts";

// Mismo formateo que PlanVacunacionTimeline.tsx (formatFecha) — permite ubicar
// la fila exacta de esta corrida sin depender de su posición en la lista (la
// stack local acumula dosis de corridas anteriores sobre la misma mascota).
function formatFechaEsAr(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("es-AR", { year: "numeric", month: "short", day: "numeric" });
}

test("programar dosis y marcarla aplicada", async ({ page }) => {
  const fechaEstimada = fechaUnica(10);

  await page.goto("/mascotas");
  await page.getByRole("button", { name: `Ver historial clínico de ${SEED.mascotas.firulais}` }).click();
  await page.waitForURL(/\/historial\//);

  await page.getByRole("tab", { name: "Plan de Vacunación" }).click();
  await page.getByRole("button", { name: "Programar dosis" }).click();

  await page.getByLabel("Tipo de vacuna *").click();
  await page.getByRole("option", { name: "Antirrábica" }).click();
  await page.getByLabel("Fecha estimada *").fill(fechaEstimada);
  await page.getByRole("button", { name: "Programar" }).click();
  await expect(page.getByText("Dosis programada")).toBeVisible();

  const fila = page.locator("li").filter({ hasText: formatFechaEsAr(fechaEstimada) }).filter({ hasText: "Antirrábica" });
  await expect(fila).toBeVisible();
  await fila.getByRole("button", { name: "Marcar aplicada" }).click();

  await page.getByLabel("Profesional *").click();
  await page.getByRole("option", { name: new RegExp(SEED.vet.nombreCompleto) }).click();
  await page.getByRole("button", { name: "Confirmar aplicación" }).click();

  await expect(page.getByText("Dosis aplicada — se registró el evento clínico")).toBeVisible();
  await expect(fila.getByText("Aplicada", { exact: true })).toBeVisible();
  await expect(fila.getByRole("button", { name: "Marcar aplicada" })).not.toBeVisible();
});
