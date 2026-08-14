import { Hono } from "hono";
import {
  AuditoriaService,
  EXPORT_LIMIT,
  type CallerContext,
} from "./auditoria.service.ts";
import {
  ListarAuditoriaQuerySchema,
  ExportarAuditoriaQuerySchema,
} from "./auditoria.schemas.ts";
import { DomainError, ErrorCode } from "../../shared/errors.ts";
import { ok } from "../../shared/envelope.ts";
import { tenantContext, getTenantContext } from "../../middleware/tenantContext.ts";
import { requireActiveTenant } from "../../middleware/requireActiveTenant.ts";
import { requirePermission } from "../../middleware/requirePermission.ts";
import type { Context } from "hono";
import { CALLER_UNRESOLVED } from "../../shared/audit.ts";

export const auditoriaRouter = new Hono();

// RN-AUD3: solo view_audit puede consultar o exportar.
// Auditoría es feature core — no pasa por requireModule.
auditoriaRouter.use(
  "/*",
  tenantContext,
  requireActiveTenant,
  requirePermission("view_audit"),
);

function callerCtx(c: Context): CallerContext {
  const { tenantId, userId } = getTenantContext(c);
  return { tenantId, callerUserId: userId, callerName: CALLER_UNRESOLVED, callerRole: CALLER_UNRESOLVED };
}

// ── GET /auditoria ─────────────────────────────────────────────────────────────
// RN-AUD5: paginado con filtros opcionales.
auditoriaRouter.get("/", async (c) => {
  const parsed = ListarAuditoriaQuerySchema.safeParse({
    search:   c.req.query("search"),
    module:   c.req.query("module"),
    action:   c.req.query("action"),
    userId:   c.req.query("userId"),
    dateFrom: c.req.query("dateFrom"),
    dateTo:   c.req.query("dateTo"),
    page:     c.req.query("page"),
    limit:    c.req.query("limit"),
  });

  if (!parsed.success) {
    throw new DomainError(
      ErrorCode.VALIDATION_ERROR,
      422,
      "Parámetros de consulta inválidos",
      parsed.error.issues,
    );
  }

  const { tenantId } = getTenantContext(c);
  const { items, total } = await AuditoriaService.buscarPaginado(
    parsed.data,
    { tenantId, callerUserId: "", callerName: "", callerRole: "" },
  );
  return c.json(ok(items, { page: parsed.data.page, limit: parsed.data.limit, total }), 200);
});

// ── GET /auditoria/export ──────────────────────────────────────────────────────
// Retorna CSV; si el resultado fue truncado lo indica en headers HTTP (nunca silencioso).
auditoriaRouter.get("/export", async (c) => {
  const parsed = ExportarAuditoriaQuerySchema.safeParse({
    search:   c.req.query("search"),
    module:   c.req.query("module"),
    action:   c.req.query("action"),
    userId:   c.req.query("userId"),
    dateFrom: c.req.query("dateFrom"),
    dateTo:   c.req.query("dateTo"),
  });

  if (!parsed.success) {
    throw new DomainError(
      ErrorCode.VALIDATION_ERROR,
      422,
      "Parámetros de exportación inválidos",
      parsed.error.issues,
    );
  }

  const { csv, truncated, totalMatching } = await AuditoriaService.exportarCsv(
    parsed.data,
    callerCtx(c),
  );

  const date    = new Date().toISOString().slice(0, 10);
  const headers: Record<string, string> = {
    "Content-Type":        "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="auditoria_${date}.csv"`,
  };

  if (truncated) {
    headers["X-Export-Truncated"]      = "true";
    headers["X-Export-Total-Matching"] = String(totalMatching);
    headers["X-Export-Rows"]           = String(EXPORT_LIMIT);
  }

  return new Response(csv, { headers });
});
