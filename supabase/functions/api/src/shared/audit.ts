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

export async function recordAudit(
  db: SupabaseClient,
  payload: AuditPayload,
): Promise<void> {
  const { error } = await db.from("registros_auditoria").insert({
    tenant_id:  payload.tenantId,
    user_id:    payload.userId,
    user_name:  payload.userName,
    user_role:  payload.userRole,
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
