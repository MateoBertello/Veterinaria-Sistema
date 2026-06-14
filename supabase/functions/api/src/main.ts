import { Hono } from "hono";
import { errorHandler } from "./middleware/errorHandler.ts";
import { tenantContext } from "./middleware/tenantContext.ts";
import { getDb } from "./shared/db.ts";
import { ok } from "./shared/envelope.ts";
import { getTenantContext } from "./middleware/tenantContext.ts";

const app = new Hono().basePath("/api/v1");

app.onError(errorHandler);

// ─── Endpoint público de salud ─────────────────────────────────────────────
app.get("/health", (c) => {
  return c.json(ok({ status: "ok", ts: new Date().toISOString() }));
});

// ─── Módulos habilitados del tenant autenticado ────────────────────────────
app.get("/modulos-habilitados", tenantContext, async (c) => {
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

export default app;
