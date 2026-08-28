// @ts-expect-error — script de tooling en JS plano, sin tipos (igual que scripts/seed.mjs).
import { limpiarResiduosE2E, reportar } from "../../scripts/limpiar-e2e.mjs";

/**
 * Barre lo que la suite dejó en la base local (ver scripts/limpiar-e2e.mjs).
 *
 * NUNCA hace fallar la corrida: si la limpieza no puede correr —falta el
 * service role, la stack local está apagada— se reporta y se sigue. Un teardown
 * que tumba una suite verde convierte un problema de higiene en un falso rojo.
 */
export default async function globalTeardown(): Promise<void> {
  try {
    reportar(await limpiarResiduosE2E());
  } catch (err) {
    console.warn(`⚠ Limpieza E2E: no se pudo completar — ${(err as Error).message}`);
  }
}
