import type { Context, Next } from "hono";
import { DomainError, ErrorCode } from "../shared/errors.ts";
import { getDb } from "../shared/db.ts";
import { getTenantContext } from "./tenantContext.ts";

export type ModuloVendible = "historial_clinico" | "turnos" | "guarderia" | "stock" | "ventas";

// ─── Sin caché en memoria de proceso (RN-SM3) ────────────────────────────────
// Originalmente existía acá una caché en memoria (Map) con TTL de 60 segundos.
// Se eliminó porque en producción el isolate se destruye y recrea en cada request
// (requestSeq siempre 1 en producción, medido el 2026-09-10 con commit e8e2740,
// isolateAgeMs 34 a 48 ms). El TTL de 60s nunca acertaba entre requests: era
// un viaje a la base en cada endpoint de módulo vendible disfrazado de ahorro.
// NO volver a agregar caché de proceso aquí salvo que cambie la infraestructura
// de Supabase y requestSeq sea consistentemente > 1.

/**
 * No-op: la caché en memoria fue eliminada (el isolate no sobrevive al request).
 * Se conserva la exportación vacía para no romper call sites en services ni tests.
 */
export function invalidateModuleCache(_tenantId?: string, _modulo?: ModuloVendible): void {
  // No-op intencional.
}

/**
 * Middleware factory: verifica que el tenant tenga el módulo contratado y habilitado.
 * Consulta directamente la base de datos con el JWT del usuario (RLS activo).
 * Rechaza con 403 MODULE_NOT_LICENSED si el módulo está deshabilitado.
 *
 * La suspensión del tenant (activo=false) NO se evalúa aquí: la cubre el guard
 * requireActiveTenant, que corre antes y bloquea TODO el tenant con TENANT_SUSPENDED
 * (RN-SA3).
 */
export function requireModule(modulo: ModuloVendible) {
  return async function (c: Context, next: Next): Promise<Response | void> {
    const { tenantId } = getTenantContext(c);

    // Consultar DB con el JWT del usuario (RLS activo)
    const authHeader = c.req.header("Authorization") ?? "";
    const db = getDb(authHeader);

    // Verificar que el módulo esté habilitado
    const { data: mod, error: modError } = await db
      .from("modulos_contratados")
      .select("habilitado")
      .eq("tenant_id", tenantId)
      .eq("modulo", modulo)
      .single();

    const habilitado = !modError && mod?.habilitado === true;

    if (!habilitado) {
      throw new DomainError(
        ErrorCode.MODULE_NOT_LICENSED,
        403,
        `El módulo '${modulo}' no está habilitado para este tenant`,
      );
    }

    await next();
  };
}
