import { DomainError, ErrorCode } from "../../shared/errors.ts";
import { recordAudit } from "../../shared/audit.ts";
import { getServiceDb } from "../../shared/db.ts";
import type { ListarAuditoriaOpts, ExportarAuditoriaOpts } from "./auditoria.schemas.ts";

// ─── Tipos públicos ───────────────────────────────────────────────────────────

export interface CallerContext {
  tenantId:     string;
  callerUserId: string;
  callerName:   string;
  callerRole:   string;
}

export interface RegistroAuditoriaPublico {
  id:        string;
  timestamp: string;
  module:    string;
  action:    string;
  userId:    string | null;
  userName:  string | null;
  userRole:  string | null;
  entityId:  string | null;
  oldValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
  details:   string | null;
  ipAddress: string | null;
}

export const EXPORT_LIMIT = 10_000;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toPublic(row: Record<string, unknown>): RegistroAuditoriaPublico {
  return {
    id:        row["id"]         as string,
    timestamp: row["timestamp"]  as string,
    module:    row["module"]     as string,
    action:    row["action"]     as string,
    userId:    (row["user_id"]   as string | null) ?? null,
    userName:  (row["user_name"] as string | null) ?? null,
    userRole:  (row["user_role"] as string | null) ?? null,
    entityId:  (row["entity_id"] as string | null) ?? null,
    oldValues: (row["old_values"] as Record<string, unknown> | null) ?? null,
    newValues: (row["new_values"] as Record<string, unknown> | null) ?? null,
    details:   (row["details"]   as string | null) ?? null,
    ipAddress: (row["ip_address"] as string | null) ?? null,
  };
}

function csvEscape(val: unknown): string {
  const s = val === null || val === undefined ? "" : String(val);
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function buildCsv(rows: Record<string, unknown>[]): string {
  const header = "id,timestamp,module,action,userId,userName,userRole,entityId,details,ipAddress";
  const lines = rows.map((r) =>
    [
      csvEscape(r["id"]),
      csvEscape(r["timestamp"]),
      csvEscape(r["module"]),
      csvEscape(r["action"]),
      csvEscape(r["user_id"]),
      csvEscape(r["user_name"]),
      csvEscape(r["user_role"]),
      csvEscape(r["entity_id"]),
      csvEscape(r["details"]),
      csvEscape(r["ip_address"]),
    ].join(","),
  );
  return [header, ...lines].join("\n");
}

// ─── Aplicar filtros comunes a un query builder ────────────────────────────────

// deno-lint-ignore no-explicit-any
function applyFiltros(q: any, filtros: ExportarAuditoriaOpts, tenantId: string): any {
  q = q.eq("tenant_id", tenantId);
  if (filtros.module)   q = q.eq("module", filtros.module);
  if (filtros.action)   q = q.eq("action", filtros.action);
  if (filtros.userId)   q = q.eq("user_id", filtros.userId);
  if (filtros.dateFrom) q = q.gte("timestamp", filtros.dateFrom);
  if (filtros.dateTo)   q = q.lte("timestamp", filtros.dateTo);
  if (filtros.search)   q = q.ilike("user_name", `%${filtros.search}%`);
  return q;
}

// ─── Service ──────────────────────────────────────────────────────────────────

export const AuditoriaService = {
  /**
   * RN-AUD5: consulta paginada con filtros opcionales.
   * Todos los registros pertenecen al tenant del ctx (defensa + RLS).
   */
  async buscarPaginado(
    filtros: ListarAuditoriaOpts,
    ctx: CallerContext,
  ): Promise<{ items: RegistroAuditoriaPublico[]; total: number }> {
    const db     = getServiceDb();
    const offset = (filtros.page - 1) * filtros.limit;

    let q = db.from("registros_auditoria").select("*", { count: "exact" });
    q = applyFiltros(q, filtros, ctx.tenantId);

    const { data, error, count } = await q
      .order("timestamp", { ascending: false })
      .range(offset, offset + filtros.limit - 1);

    if (error) {
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, "Error al consultar auditoría");
    }

    const items = ((data ?? []) as Record<string, unknown>[]).map(toPublic);
    return { items, total: count ?? 0 };
  },

  /**
   * RN-AUD1: exporta como CSV todos los registros que coincidan con los filtros.
   * Si el total supera EXPORT_LIMIT, solo se exportan los primeros EXPORT_LIMIT
   * y se devuelve truncated=true para que el controller informe al cliente
   * vía headers HTTP (no silencioso).
   * La exportación registra su propio asiento de auditoría con action='EXPORT'.
   */
  async exportarCsv(
    filtros: ExportarAuditoriaOpts,
    ctx: CallerContext,
  ): Promise<{ csv: string; truncated: boolean; totalMatching: number }> {
    const db = getServiceDb();

    let q = db.from("registros_auditoria").select("*", { count: "exact" });
    q = applyFiltros(q, filtros, ctx.tenantId);

    const { data, error, count } = await q
      .order("timestamp", { ascending: false })
      .range(0, EXPORT_LIMIT - 1);

    if (error) {
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, "Error al exportar auditoría");
    }

    const totalMatching = count ?? 0;
    const truncated     = totalMatching > EXPORT_LIMIT;
    const rows          = (data ?? []) as Record<string, unknown>[];
    const csv           = buildCsv(rows);

    await recordAudit(db as never, {
      tenantId:  ctx.tenantId,
      userId:    ctx.callerUserId,
      userName:  ctx.callerName,
      userRole:  ctx.callerRole,
      action:    "EXPORT",
      module:    "security",
      details:   JSON.stringify({ filtros, rows: rows.length, totalMatching, truncated }),
    });

    return { csv, truncated, totalMatching };
  },
};
