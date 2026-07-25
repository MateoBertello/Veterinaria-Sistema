import { apiClient } from "./client.ts";
import type { ResumenDashboard } from "../types/index.ts";

/**
 * GET /dashboard/resumen — métricas agregadas del tenant (Etapa 12A).
 *
 * Una sola llamada para todas las tarjetas: el backend resuelve cada métrica con
 * un COUNT y ya aplica el gate por permiso y por módulo licenciado. Las métricas
 * que el usuario no puede ver vuelven en `null` (≠ 0) y la tarjeta no se dibuja.
 */
export function obtenerResumenDashboard(): Promise<ResumenDashboard> {
  return apiClient<ResumenDashboard>("/dashboard/resumen");
}
