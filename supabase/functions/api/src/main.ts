import { Hono } from "hono";
import { errorHandler } from "./middleware/errorHandler.ts";
import { ok } from "./shared/envelope.ts";
import { authRouter } from "./modules/auth/auth.controller.ts";
import { usuariosRouter } from "./modules/usuarios/usuarios.controller.ts";
import { clientesRouter } from "./modules/clientes/clientes.controller.ts";
import { tenantsRouter } from "./modules/admin/tenants.controller.ts";
import { modulosRouter } from "./modules/modulos/modulos.controller.ts";

const app = new Hono().basePath("/api/v1");

app.onError(errorHandler);

// ─── Endpoint público de salud ─────────────────────────────────────────────
app.get("/health", (c) => {
  return c.json(ok({ status: "ok", ts: new Date().toISOString() }));
});

// ─── Módulos habilitados del tenant autenticado (sidebar dinámico) ──────────
app.route("/modulos-habilitados", modulosRouter);

// ─── Módulo Auth ──────────────────────────────────────────────────────────────
app.route("/auth", authRouter);

// ─── Módulo Usuarios ──────────────────────────────────────────────────────────
app.route("/usuarios", usuariosRouter);

// ─── Módulo Clientes (Core Cliente-Mascota) ────────────────────────────────────
app.route("/clientes", clientesRouter);

// ─── Consola Super Admin (fuera de tenant) ──────────────────────────────────────
// Montado en /api/v1/admin/tenants; el router NO repite el segmento /tenants.
app.route("/admin/tenants", tenantsRouter);

export default app;
