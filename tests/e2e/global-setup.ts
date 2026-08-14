import { chromium, type FullConfig } from "@playwright/test";
import { ADMIN_STORAGE_STATE, login } from "./fixtures.ts";

/** Loguea una vez como admin_demo y persiste la sesión — cada spec la reutiliza vía storageState. */
export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use.baseURL as string;
  const browser = await chromium.launch();
  const page = await browser.newPage({ baseURL });

  await login(page, "admin_demo", "Demo1234!");
  await page.context().storageState({ path: ADMIN_STORAGE_STATE });

  await browser.close();
}
