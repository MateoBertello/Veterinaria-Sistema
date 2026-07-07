import type { Page } from "@playwright/test";

export const ADMIN_STORAGE_STATE = "playwright/.auth/admin.json";

/** Datos fijos sembrados por `npm run seed` (scripts/seed.mjs) — estables entre corridas. */
export const SEED = {
  admin: { username: "admin_demo", password: "Demo1234!" },
  vet: { username: "vet_demo", nombreCompleto: "Dr. Vet Demo" },
  clientes: {
    juana: { nombre: "Juana Pérez", dni: "27000000001" },
    carlos: { nombre: "Carlos Gómez", dni: "20000000002" },
  },
  mascotas: {
    firulais: "Firulais", // de Juana Pérez
    michi:    "Michi",    // de Juana Pérez
    rocky:    "Rocky",    // de Carlos Gómez
  },
  servicio: "Consulta general",
} as const;

/** Sufijo único por corrida: la stack local no se resetea entre ejecuciones de la suite. */
export function unico(prefijo: string): string {
  return `${prefijo} E2E ${Date.now()}`;
}

/** Fecha YYYY-MM-DD a N días de hoy. */
export function fechaEnDias(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Fecha "de un solo uso" para specs que agendan turnos/estadías: además del
 * offset base, suma unos días derivados de Date.now() para no chocar con lo
 * que dejó una corrida anterior en el mismo día calendario (la stack local no
 * se resetea entre corridas — RN-TU4/DUPLICATE_APPOINTMENT no distingue turnos
 * ya Completados de uno nuevo en el mismo horario para la misma mascota).
 */
export function fechaUnica(offsetBase: number): string {
  return fechaEnDias(offsetBase + (Date.now() % 500));
}

/** Suma N días a una fecha YYYY-MM-DD y devuelve YYYY-MM-DD. */
export function sumarDias(fechaIso: string, n: number): string {
  const d = new Date(`${fechaIso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

export async function login(page: Page, username: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Usuario").fill(username);
  await page.getByLabel("Contraseña").fill(password);
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await page.waitForURL("**/clientes");
}
