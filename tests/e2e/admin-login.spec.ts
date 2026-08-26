import { test, expect, type Page } from "@playwright/test";
import { loginPlataforma, SEED } from "./fixtures.ts";

/**
 * Autenticación de plataforma (Super Admin) de punta a punta.
 *
 * Estos tests arrancan SIN el `storageState` del tenant: ejercitan justamente el
 * mecanismo de sesión de la consola, que es OTRO. Hasta la Etapa de
 * "Autenticación de plataforma" no existía forma de conseguir esa sesión desde
 * la aplicación: el Super Admin no tiene fila en `usuarios`, así que
 * `POST /auth/login` le respondía 401, y la única vía era pegar un access_token
 * a mano en `localStorage`.
 */
test.use({ storageState: { cookies: [], origins: [] } });

/** Claves de `localStorage` de cada sesión (ver web/src/lib/session.ts). */
const CLAVES = {
  plataforma:        "sb-platform-token",
  plataformaRefresh: "sb-platform-refresh-token",
  tenant:            "sb-token",
} as const;

function leerStorage(page: Page, clave: string): Promise<string | null> {
  return page.evaluate((k) => window.localStorage.getItem(k), clave);
}

test("el Super Admin entra por /admin/login y aterriza en la consola", async ({ page }) => {
  await loginPlataforma(page, SEED.superAdmin.email, SEED.superAdmin.password);

  await expect(page).toHaveURL(/\/admin\/tenants$/);
  await expect(page.getByRole("heading", { name: /Tenants/ })).toBeVisible();

  // La sesión queda guardada CON refresh token: es lo que le faltaba al
  // workaround del token pegado a mano, que moría al vencer el access token.
  expect(await leerStorage(page, CLAVES.plataforma)).toBeTruthy();
  expect(await leerStorage(page, CLAVES.plataformaRefresh)).toBeTruthy();
  // Y no ensucia la sesión de la clínica.
  expect(await leerStorage(page, CLAVES.tenant)).toBeNull();
});

test("credenciales de un usuario de tenant no abren la consola, y el mensaje no lo delata", async ({ page }) => {
  // `admin_demo` existe y su contraseña es correcta, pero su JWT no acredita
  // plataforma. El error tiene que ser el mismo que el de una contraseña mal
  // puesta: distinguirlos confirmaría que la contraseña era buena.
  await loginPlataforma(page, SEED.admin.email, SEED.admin.password);
  await expect(page.getByRole("alert")).toHaveText("Credenciales inválidas.");

  await page.reload();
  await page.getByLabel("Email").pressSequentially(SEED.superAdmin.email);
  await page.getByLabel("Contraseña").pressSequentially("password-incorrecta");
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await expect(page.getByRole("alert")).toHaveText("Credenciales inválidas.");

  await expect(page).toHaveURL(/\/admin\/login$/);
});

test("sin sesión de plataforma, /admin/tenants manda al login de la consola", async ({ page }) => {
  await page.goto("/admin/tenants");
  await expect(page).toHaveURL(/\/admin\/login$/);
});

test("la sesión de plataforma se renueva sola al vencer el access token", async ({ page }) => {
  await loginPlataforma(page, SEED.superAdmin.email, SEED.superAdmin.password);
  await expect(page).toHaveURL(/\/admin\/tenants$/);

  const refreshOriginal = await leerStorage(page, CLAVES.plataformaRefresh);

  // Se fuerza el vencimiento pisando el access token por uno ya expirado y
  // dejando intacto el refresh token: es exactamente el estado en el que queda
  // la consola después de una hora abierta (o al volver al otro día).
  await page.evaluate(([clave, token]) => {
    window.localStorage.setItem(clave!, token!);
  }, [CLAVES.plataforma, jwtVencido()] as const);

  await page.reload();

  // No vuelve a pedir credenciales: renueva con el refresh token y sigue.
  await expect(page).toHaveURL(/\/admin\/tenants$/);
  await expect(page.getByRole("heading", { name: /Tenants/ })).toBeVisible();

  // GoTrue rota el refresh token en cada uso: el par guardado es OTRO.
  const tokenNuevo = await leerStorage(page, CLAVES.plataforma);
  expect(tokenNuevo).toBeTruthy();
  expect(tokenNuevo).not.toBe(jwtVencido());
  expect(await leerStorage(page, CLAVES.plataformaRefresh)).not.toBe(refreshOriginal);
});

test("un 401 de la API del tenant no cierra la sesión de plataforma", async ({ page }) => {
  await loginPlataforma(page, SEED.superAdmin.email, SEED.superAdmin.password);
  await expect(page).toHaveURL(/\/admin\/tenants$/);

  const tokenPlataforma = await leerStorage(page, CLAVES.plataforma);

  // Una sesión de tenant vencida en la misma pestaña: cualquier request suyo
  // devuelve 401. Mientras las dos sesiones compartían la clave `sb-token`, ese
  // 401 borraba el token del Super Admin y lo echaba de la consola.
  await page.evaluate((clave) => {
    window.localStorage.setItem(clave, "jwt-de-tenant-invalido");
  }, CLAVES.tenant);

  await page.goto("/clientes");
  await expect(page).toHaveURL(/\/login$/);

  expect(await leerStorage(page, CLAVES.plataforma)).toBe(tokenPlataforma);

  // Y la consola sigue abierta.
  await page.goto("/admin/tenants");
  await expect(page.getByRole("heading", { name: /Tenants/ })).toBeVisible();
});

test("cerrar sesión en la consola vuelve a su login y no deja el par guardado", async ({ page }) => {
  await loginPlataforma(page, SEED.superAdmin.email, SEED.superAdmin.password);
  await expect(page).toHaveURL(/\/admin\/tenants$/);

  await page.getByRole("button", { name: "Cerrar sesión" }).click();

  await expect(page).toHaveURL(/\/admin\/login$/);
  expect(await leerStorage(page, CLAVES.plataforma)).toBeNull();
  expect(await leerStorage(page, CLAVES.plataformaRefresh)).toBeNull();
});

/** JWT vencido con forma de token de plataforma (la firma no importa: el front solo decodifica). */
function jwtVencido(): string {
  const b64url = (obj: unknown) =>
    Buffer.from(JSON.stringify(obj)).toString("base64url");
  return [
    b64url({ alg: "HS256", typ: "JWT" }),
    b64url({
      sub:          "00000000-0000-0000-0000-000000000000",
      exp:          Math.floor(Date.now() / 1000) - 60,
      app_metadata: { platform_role: "super_admin" },
    }),
    "firma-que-no-se-verifica-en-el-front",
  ].join(".");
}
