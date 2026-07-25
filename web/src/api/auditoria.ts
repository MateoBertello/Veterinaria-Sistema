import { apiClientBlob, apiClientList } from "./client.ts";
import type { ApiMeta, RegistroAuditoria } from "../types/index.ts";

export interface FiltrosAuditoria {
  search?:   string;
  module?:   string;
  action?:   string;
  userId?:   string;
  dateFrom?: string;
  dateTo?:   string;
}

export interface ListarAuditoriaParams extends FiltrosAuditoria {
  page?:  number;
  limit?: number;
}

function buildQuery(filtros: ListarAuditoriaParams): string {
  const qs = new URLSearchParams();
  if (filtros.search)   qs.set("search", filtros.search);
  if (filtros.module)   qs.set("module", filtros.module);
  if (filtros.action)   qs.set("action", filtros.action);
  if (filtros.userId)   qs.set("userId", filtros.userId);
  if (filtros.dateFrom) qs.set("dateFrom", filtros.dateFrom);
  if (filtros.dateTo)   qs.set("dateTo", filtros.dateTo);
  if (filtros.page)     qs.set("page", String(filtros.page));
  if (filtros.limit)    qs.set("limit", String(filtros.limit));

  const s = qs.toString();
  return s ? `?${s}` : "";
}

/** GET /auditoria — listado paginado con filtros opcionales (permiso view_audit). */
export function listarAuditoria(
  params: ListarAuditoriaParams = {},
): Promise<{ items: RegistroAuditoria[]; meta: ApiMeta }> {
  return apiClientList<RegistroAuditoria>(`/auditoria${buildQuery(params)}`);
}

export interface ExportarAuditoriaResultado {
  blob:          Blob;
  filename:      string;
  /** Si el backend truncó el export (más de EXPORT_LIMIT filas coincidentes). */
  truncated:     boolean;
  totalMatching: number | null;
  rowsExported:  number | null;
}

/**
 * GET /auditoria/export — descarga CSV con los mismos filtros (sin page/limit).
 * El backend nunca falla por truncar: si el total supera el límite de export,
 * lo indica con headers HTTP (X-Export-Truncated/-Total-Matching/-Rows) para que
 * el llamador avise al usuario en vez de entregar un CSV incompleto en silencio.
 */
export async function exportarAuditoriaCsv(
  filtros: FiltrosAuditoria = {},
): Promise<ExportarAuditoriaResultado> {
  const { blob, filename, headers } = await apiClientBlob(`/auditoria/export${buildQuery(filtros)}`);
  const truncated = headers.get("X-Export-Truncated") === "true";

  return {
    blob,
    filename: filename ?? `auditoria_${new Date().toISOString().slice(0, 10)}.csv`,
    truncated,
    totalMatching: truncated ? Number(headers.get("X-Export-Total-Matching")) : null,
    rowsExported:  truncated ? Number(headers.get("X-Export-Rows")) : null,
  };
}
