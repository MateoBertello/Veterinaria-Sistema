import { test, expect } from "@playwright/test";
import { login, SEED } from "./fixtures.ts";

// Los tres tests de este archivo ejercitan el propio mecanismo de sesión, así
// que arrancan SIN el storageState autenticado del resto de la suite.
test.use({ storageState: { cookies: [], origins: [] } });

test("login OK con admin_demo redirige a /clientes", async ({ page }) => {
  await login(page, SEED.admin.username, SEED.admin.password);
  await expect(page).toHaveURL(/\/clientes$/);
  await expect(page.getByRole("heading", { name: "Clientes" })).toBeVisible();
});

test("credencial mala muestra el mensaje de error sin redirigir", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Usuario").fill("admin_demo");
  await page.getByLabel("Contraseña").fill("password-incorrecta");
  await page.getByRole("button", { name: "Iniciar sesión" }).click();

  await expect(page.getByRole("alert")).toHaveText("Usuario o contraseña incorrectos.");
  await expect(page).toHaveURL(/\/login$/);
});

test("ruta protegida sin sesión redirige a /login", async ({ page }) => {
  await page.goto("/clientes");
  await expect(page).toHaveURL(/\/login$/);
});
