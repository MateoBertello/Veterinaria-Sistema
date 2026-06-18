import { Hono } from "hono";
import { errorHandler } from "./middleware/errorHandler.ts";
import { tenantContext } from "./middleware/tenantContext.ts";
import { getDb } from "./shared/db.ts";
import { ok } from "./shared/envelope.ts";
import { getTenantContext } from "./middleware/tenantContext.ts";
import { authRouter } from "./modules/auth/auth.controller.ts";
import { usuariosRouter } from "./modules/usuarios/usuarios.controller.ts";
import { tenantsRouter } from "./modules/admin/tenants.controller.ts";
import { requireActiveTenant } from "./middleware/requireActiveTenant.ts";

const app = new Hono().basePath("/api/v1");

app.onError(errorHandler);

// ─── Endpoint público de salud ─────────────────────────────────────────────
app.get("/health", (c) => {
  return c.json(ok({ status: "ok", ts: new Date().toISOString() }));
});

// ─── Módulos habilitados del tenant autenticado ────────────────────────────
// requireActiveTenant bloquea tenants suspendidos (RN-SA3) antes de servir datos.
app.get("/modulos-habilitados", tenantContext, requireActiveTenant, async (c) => {
  const { tenantId } = getTenantContext(c);
  const authHeader = c.req.header("Authorization") ?? "";
  const db = getDb(authHeader);

  const { data, error } = await db
    .from("modulos_contratados")
    .select("modulo, habilitado, fecha_alta")
    .eq("tenant_id", tenantId)
    .order("modulo");

  if (error) {
    throw new Error(`Error al obtener módulos: ${error.message}`);
  }

  return c.json(ok(data ?? []));
});

// ─── Módulo Auth ──────────────────────────────────────────────────────────────
app.route("/auth", authRouter);

// ─── Módulo Usuarios ──────────────────────────────────────────────────────────
app.route("/usuarios", usuariosRouter);

// ─── Consola Super Admin (fuera de tenant) ──────────────────────────────────────
// Montado en /api/v1/admin/tenants; el router NO repite el segmento /tenants.
app.route("/admin/tenants", tenantsRouter);

export default app;
