import type { SupabaseClient } from "@supabase/supabase-js";

export type AuditAction =
  | "CREATE" | "UPDATE" | "DELETE" | "CANCEL"
  | "LOGIN"  | "LOGOUT" | "VIEW"   | "EXPORT";

export type AuditModule =
  | "clients" | "pets" | "medical_records" | "appointments" | "daycare"
  | "users"   | "security" | "services" | "system" | "platform";

export interface AuditPayload {
  tenantId:   string | null;
  userId:     string | null;
  userName:   string | null;
  userRole:   string | null;
  action:     AuditAction;
  module:     AuditModule;
  entityId?:  string;
  oldValues?: Record<string, unknown>;
  newValues?: Record<string, unknown>;
  details?:   string;
  ipAddress?: string;
}

/**
 * Sentinela de "autor sin resolver": el JWT solo trae `sub`, así que los
 * controllers no conocen el nombre ni el rol de quien llama sin ir a la base.
 * En vez de pagar esa consulta en CADA request (los controllers arman el
 * contexto también para lecturas), la difieren hasta acá: `recordAudit` la
 * resuelve solo cuando efectivamente hay un asiento que escribir.
 */
export const CALLER_UNRESOLVED = "unknown";

interface CallerIdentity {
  name: string;
  role: string;
}

interface CallerCacheEntry {
  identity:  CallerIdentity;
  expiresAt: number;
}

// Identidad por usuario: cambia rarísimo (alta/cambio de rol) y solo afecta la
// ETIQUETA del asiento — el user_id, que es el dato duro, nunca sale de acá.
const callerCache = new Map<string, CallerCacheEntry>();
const CALLER_CACHE_TTL_MS = 60_000;

/** Descarta la identidad cacheada de un usuario (o de todos). */
export function invalidateCallerCache(userId?: string): void {
  if (userId) callerCache.delete(userId);
  else callerCache.clear();
}

function needsResolution(value: string | null | undefined): boolean {
  return value === null || value === undefined || value === "" ||
    value === CALLER_UNRESOLVED;
}

/** Nombre y rol del autor, por su id. `null` si no se pudo resolver. */
async function resolveCaller(
  db: SupabaseClient,
  userId: string,
): Promise<CallerIdentity | null> {
  const cached = callerCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.identity;

  // Una sola consulta con embed (usuarios → roles); respeta RLS como el resto.
  const { data, error } = await db
    .from("usuarios")
    .select("username, roles!inner(name)")
    .eq("id", userId)
    .single();

  if (error || !data) return null;

  const row  = data as { username?: string; roles?: unknown };
  const roles = Array.isArray(row.roles) ? row.roles[0] : row.roles;
  const role  = (roles as { name?: string } | undefined)?.name;

  if (!row.username) return null;

  const identity: CallerIdentity = {
    name: row.username,
    role: role ?? CALLER_UNRESOLVED,
  };
  callerCache.set(userId, { identity, expiresAt: Date.now() + CALLER_CACHE_TTL_MS });
  return identity;
}

export async function recordAudit(
  db: SupabaseClient,
  payload: AuditPayload,
): Promise<void> {
  let userName = payload.userName;
  let userRole = payload.userRole;

  // RN-S3: el asiento tiene que decir QUIÉN hizo el cambio. Si el llamador no
  // pudo resolverlo (controllers de tenant) se resuelve acá por `userId`. Los
  // autores que no son usuarios del tenant —"sistema" del cron, "super_admin"
  // de plataforma— ya vienen resueltos y no se tocan.
  if (payload.userId && (needsResolution(userName) || needsResolution(userRole))) {
    const identity = await resolveCaller(db, payload.userId).catch(() => null);
    if (identity) {
      if (needsResolution(userName)) userName = identity.name;
      if (needsResolution(userRole)) userRole = identity.role;
    }
  }

  const { error } = await db.from("registros_auditoria").insert({
    tenant_id:  payload.tenantId,
    user_id:    payload.userId,
    user_name:  userName,
    user_role:  userRole,
    action:     payload.action,
    module:     payload.module,
    entity_id:  payload.entityId   ?? null,
    old_values: payload.oldValues  ?? null,
    new_values: payload.newValues  ?? null,
    details:    payload.details    ?? null,
    ip_address: payload.ipAddress  ?? null,
  });

  if (error) {
    // La auditoría nunca debe romper el flujo principal; se loguea en consola
    console.error("[audit] Error al registrar auditoría:", error.message);
  }
}
