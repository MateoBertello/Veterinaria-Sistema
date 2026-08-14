import { test, expect } from "@playwright/test";
import { login, SEED } from "./fixtures.ts";

// Los tres tests de este archivo ejercitan el propio mecanismo de sesión, así
// que arrancan SIN el storageState autenticado del resto de la suite.
test.use({ storageState: { cookies: [], origins: [] } });

test("login OK con admin_demo aterriza en el panel de inicio", async ({ page }) => {
  // El destino post-login es el panel ("/"), no /clientes: cambió en la Etapa
  // 12B y este test había quedado con la expectativa vieja (no se ejecutaba
  // desde entonces).
  await login(page, SEED.admin.username, SEED.admin.password);

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: /^Bienvenido/ })).toBeVisible();
});

test("credencial mala muestra el mensaje de error sin redirigir", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Usuario o email").pressSequentially("admin_demo");
  await page.getByLabel("Contraseña").pressSequentially("password-incorrecta");
  await page.getByRole("button", { name: "Iniciar sesión" }).click();

  await expect(page.getByRole("alert")).toHaveText("Usuario o contraseña incorrectos.");
  await expect(page).toHaveURL(/\/login$/);
});

test("el usuario entra tipeando su nombre con otra combinación de mayúsculas", async ({ page }) => {
  // Regresión del bug reportado: el alta guardaba el username tal cual se
  // escribió (p. ej. `Juanpa`) y el login comparaba con igualdad sensible a
  // mayúsculas, así que tipearlo devolvía el mismo 401 genérico que una
  // contraseña mal puesta. Pegado exacto entraba; tipeado, no.
  // `login()` ya espera el saludo del panel: si no autenticara, este test falla.
  await login(page, SEED.admin.username.toUpperCase(), SEED.admin.password);

  await expect(page.getByRole("heading", { name: /^Bienvenido/ })).toBeVisible();
});

test("el usuario también puede entrar con su email", async ({ page }) => {
  await login(page, SEED.admin.email, SEED.admin.password);

  await expect(page.getByRole("heading", { name: /^Bienvenido/ })).toBeVisible();
});

test("ruta protegida sin sesión redirige a /login", async ({ page }) => {
  await page.goto("/clientes");
  await expect(page).toHaveURL(/\/login$/);
});
