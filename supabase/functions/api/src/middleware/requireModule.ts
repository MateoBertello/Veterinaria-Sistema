import type { Context, Next } from "hono";
import { DomainError, ErrorCode } from "../shared/errors.ts";
import { getDb } from "../shared/db.ts";
import { getTenantContext } from "./tenantContext.ts";

export type ModuloVendible = "historial_clinico" | "turnos" | "guarderia" | "stock" | "ventas";

interface CacheEntry {
  value:     boolean;
  expiresAt: number;
}

// Caché en memoria de la Edge Function — TTL 60 segundos (RN-SM3)
const moduleCache = new Map<string, CacheEntry>();

const CACHE_TTL_MS = 60_000;

function cacheKey(tenantId: string, modulo: ModuloVendible): string {
  return `${tenantId}:${modulo}`;
}

/**
 * Invalida la caché de un módulo (o todos los módulos de un tenant).
 * Llamar cuando un Super Admin habilita/deshabilita un módulo.
 */
export function invalidateModuleCache(tenantId: string, modulo?: ModuloVendible): void {
  if (modulo) {
    moduleCache.delete(cacheKey(tenantId, modulo));
  } else {
    for (const key of moduleCache.keys()) {
      if (key.startsWith(`${tenantId}:`)) {
        moduleCache.delete(key);
      }
    }
  }
}

/**
 * Middleware factory: verifica que el tenant tenga el módulo contratado y habilitado.
 * Cachea el resultado 60 segundos para minimizar queries a la DB (RN-SM1, RN-SM3).
 * Rechaza con 403 MODULE_NOT_LICENSED si el módulo está deshabilitado.
 *
 * La suspensión del tenant (activo=false) NO se evalúa aquí: la cubre el guard
 * requireActiveTenant, que corre antes y bloquea TODO el tenant con TENANT_SUSPENDED
 * (RN-SA3).
 */
export function requireModule(modulo: ModuloVendible) {
  return async function (c: Context, next: Next): Promise<Response | void> {
    const { tenantId } = getTenantContext(c);
    const key = cacheKey(tenantId, modulo);
    const now = Date.now();

    const cached = moduleCache.get(key);
    if (cached && cached.expiresAt > now) {
      if (!cached.value) {
        throw new DomainError(
          ErrorCode.MODULE_NOT_LICENSED,
          403,
          `El módulo '${modulo}' no está habilitado para este tenant`,
        );
      }
      return next();
    }

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

    moduleCache.set(key, { value: habilitado, expiresAt: now + CACHE_TTL_MS });

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
