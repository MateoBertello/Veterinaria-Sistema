import type { Page } from "@playwright/test";

export const ADMIN_STORAGE_STATE = "playwright/.auth/admin.json";

/** Datos fijos sembrados por `npm run seed` (scripts/seed.mjs) — estables entre corridas. */
export const SEED = {
  admin: { username: "admin_demo", email: "admin@demo.local", password: "Demo1234!" },
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
  /**
   * Super Admin de PLATAFORMA. No es un usuario del tenant: entra por
   * `/admin/login` con su email, no por `/login` con un username.
   */
  superAdmin: { email: "super@leo.local", password: "Super1234!" },
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
 * Suma además un jitter aleatorio: desde que el proyecto `mobile-chromium`
 * corre el mismo spec en paralelo al de desktop (Etapa cobertura mobile), dos
 * llamadas en la MISMA corrida pueden pedir la fecha con milisegundos muy
 * cercanos y caer en el mismo resto módulo 500 por coincidencia — el jitter
 * hace esa colisión entre proyectos concurrentes improbable.
 */
export function fechaUnica(offsetBase: number): string {
  return fechaEnDias(offsetBase + (Date.now() % 500) + Math.floor(Math.random() * 500));
}

/** Suma N días a una fecha YYYY-MM-DD y devuelve YYYY-MM-DD. */
export function sumarDias(fechaIso: string, n: number): string {
  const d = new Date(`${fechaIso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

export async function login(page: Page, username: string, password: string): Promise<void> {
  await page.goto("/login");
  // `pressSequentially` en vez de `fill`: `fill` escribe el valor de una sola
  // vez (equivale a pegar) y por eso la suite nunca ejercitó el tipeo real —
  // que era justamente donde fallaba el login. Tipear tecla por tecla es lo
  // que hace una persona.
  await page.getByLabel("Usuario o email").pressSequentially(username);
  await page.getByLabel("Contraseña").pressSequentially(password);
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  // El aterrizaje post-login es el panel de inicio ("/", Etapa 12B). Se espera el
  // saludo y no la URL: "/" hace match con cualquier ruta en los patrones glob.
  await page.getByRole("heading", { name: /^Bienvenido/ }).waitFor();
}

/** Entra a la consola de plataforma por su propio login (`/admin/login`). */
export async function loginPlataforma(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/admin/login");
  await page.getByLabel("Email").pressSequentially(email);
  await page.getByLabel("Contraseña").pressSequentially(password);
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
}
