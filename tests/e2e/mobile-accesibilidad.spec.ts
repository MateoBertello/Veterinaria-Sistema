import { test, expect } from "@playwright/test";

/**
 * Cobertura mobile (Etapa cobertura mobile). Corre SOLO en el proyecto
 * `mobile-chromium` (ver playwright.config.ts): hasta esta etapa ningún test
 * E2E tocaba un viewport de teléfono, así que dos huecos quedaban invisibles:
 *   1. Objetivos táctiles menores a 44px (Input/Button del kit heredado
 *      medían 36px, contra los 44px que el propio proyecto ya aplicaba al
 *      botón de menú mobile).
 *   2. Las preferencias de accesibilidad (fuente, densidad, vista de tabla,
 *      alto contraste) nunca se habían probado combinadas con un viewport
 *      angosto — el caso peor, y el que un layout roto elige para aparecer.
 */

const MIN_TOUCH_TARGET = 44;

test.describe("login sin sesión", () => {
  // Sin esto, /login ve la sesión ya autenticada del storageState por
  // defecto y redirige a "/" antes de renderizar el form (el mismo tipo de
  // hueco de cobertura que esta etapa busca cerrar): igual que auth.spec.ts.
  test.use({ storageState: { cookies: [], origins: [] } });

  test("objetivos táctiles: Input y Button del kit alcanzan 44px en mobile (login)", async ({ page }) => {
    await page.goto("/login");

    const usuario = await page.getByLabel("Usuario o email").boundingBox();
    expect(usuario!.height).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);

    const contrasena = await page.getByLabel("Contraseña").boundingBox();
    expect(contrasena!.height).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);

    const submit = await page.getByRole("button", { name: "Iniciar sesión" }).boundingBox();
    expect(submit!.height).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
  });
});

test("objetivos táctiles: trigger de combobox (Button) y menú mobile alcanzan 44px", async ({ page }) => {
  await page.goto("/turnos/nuevo");

  const servicio = await page.getByRole("combobox", { name: "Servicio" }).boundingBox();
  expect(servicio!.height).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);

  const menu = await page.getByRole("button", { name: "Abrir menú" }).boundingBox();
  expect(menu!.height).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
  expect(menu!.width).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
});

test("preferencias combinadas (fuente muy grande, densidad compacta, tabla expandida, alto contraste) no rompen el layout mobile en turnos y guardería", async ({ page }) => {
  await page.goto("/turnos");
  await expect(page.getByRole("heading", { name: "Agenda de Turnos" })).toBeVisible();

  await page.getByRole("button", { name: "Abrir panel de accesibilidad" }).click();
  const panel = page.getByRole("dialog", { name: "Accesibilidad y personalización" });
  await expect(panel).toBeVisible();

  await panel.getByRole("radiogroup", { name: "Tamaño de fuente" }).getByRole("radio", { name: "Muy grande" }).click();
  await panel.getByRole("radiogroup", { name: "Densidad de tablas" }).getByRole("radio", { name: "Compacta" }).click();
  await panel.getByRole("radiogroup", { name: "Vista de tablas" }).getByRole("radio", { name: "Expandida" }).click();
  await panel.getByRole("switch", { name: "Alto contraste" }).click();
  await page.keyboard.press("Escape");
  await expect(panel).not.toBeVisible();

  await expect(page.getByRole("heading", { name: "Agenda de Turnos" })).toBeVisible();
  const overflowTurnos = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflowTurnos).toBe(false);

  // La barra+Sheet de navegación mobile sigue operable con las prefs activas
  // (texto más grande es, justamente, el escenario donde un menú se rompe).
  await page.getByRole("button", { name: "Abrir menú" }).click();
  await expect(page.getByRole("dialog", { name: "Menú de navegación" })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.goto("/guarderia");
  await expect(page.getByRole("heading", { name: "Ocupación de Guardería" })).toBeVisible();
  const overflowGuarderia = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflowGuarderia).toBe(false);

  // PreferenciasPage tiene su propio layout de radios (grid-cols-2 sm:grid-cols-4,
  // sm:grid-flow-col) además del Sheet de AccessibilityButton ya probado arriba:
  // con las mismas prefs "peores" activas, es el otro lugar donde un layout
  // roto podría aparecer y hoy nadie lo prueba.
  await page.goto("/preferencias");
  await expect(page.getByRole("heading", { name: "Preferencias de accesibilidad" })).toBeVisible();
  const overflowPreferencias = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflowPreferencias).toBe(false);
  await expect(page.getByRole("radio", { name: "Muy grande" })).toBeChecked();
});
