/**
 * Teardown compartido de las suites de integración: borra un tenant de prueba
 * completo (tablas de negocio + la fila de `tenants` + sus cuentas de Auth) y
 * crea usuarios de Auth con la guarda de id vacío.
 *
 * Por qué existe esto en un solo lugar y no repetido por archivo:
 *
 *   Varias FKs entre tablas de negocio son ON DELETE RESTRICT (`turnos.client_id
 *   → clientes`, `historial_clinico.professional_id → usuarios`, etc.), y
 *   RESTRICT se chequea de inmediato, no al final de la sentencia. Si el
 *   borrado de un tenant se deja en manos del CASCADE de `tenants.id`, Postgres
 *   puede intentar liberar `clientes` antes que `turnos` —que la referencia con
 *   RESTRICT— y el DELETE completo aborta. La fila de `tenants` sobrevive, y
 *   como el borrado de la cuenta de Auth va DESPUÉS del de `tenants` (para no
 *   chocar con las FK que apuntan a `usuarios.id → auth.users`), esa cuenta
 *   queda huérfana.
 *
 *   Una cuenta huérfana rompe la corrida SIGUIENTE: GoTrue exige email único
 *   global, así que el alta del próximo fixture con ese email falla. Si el
 *   fixture no valida el id resultante, sigue con un id vacío y las llamadas
 *   terminan en rutas como `/historial/undefined`, que responden 500 — un test
 *   de aislamiento puede contar ese 500 como "rechazado" y dar verde por el
 *   motivo equivocado (así se detectó, en la suite de aislamiento por API).
 *
 *   `limpiarTenant` borra las tablas hijas en orden explícito (hijo → padre)
 *   en vez de delegar en el cascade, y `crearUsuarioAuth` no deja pasar un id
 *   vacío: revienta el `beforeAll` con un mensaje claro en vez de sembrar un
 *   fixture a medias.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SERVICE_ROLE_KEY } from "./_env.ts";

export function adminHeaders(): Record<string, string> {
  return {
    "Content-Type":  "application/json",
    "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
    "apikey":        SERVICE_ROLE_KEY,
  };
}

/** Crea una cuenta de Auth. Revienta si la respuesta no trae id: nunca deja un fixture a medias. */
export async function crearUsuarioAuth(
  email: string,
  appMetadata: Record<string, unknown> = {},
  password = "TestPass123!",
): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method:  "POST",
    headers: adminHeaders(),
    body:    JSON.stringify({ email, password, email_confirm: true, app_metadata: appMetadata }),
  });
  const user = await res.json() as { id?: string; msg?: string };
  if (!user.id) {
    throw new Error(`No se pudo crear la cuenta de Auth ${email}: ${user.msg ?? JSON.stringify(user)}`);
  }
  return user.id;
}

export async function borrarUsuarioAuth(userId: string): Promise<void> {
  if (!userId) return;
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, { method: "DELETE", headers: adminHeaders() });
}

/**
 * Tablas de negocio con `tenant_id`, en orden hijo → padre según las FKs
 * ON DELETE RESTRICT del Apéndice DDL. Borrar una tabla vacía para ese tenant
 * es un no-op, así que correr la lista entera es seguro aunque la suite no
 * siembre todas las entidades.
 */
export const ORDEN_BORRADO_TABLAS_NEGOCIO = [
  "plan_vacunacion", "adjuntos_medicos", "historial_clinico", "turnos",
  "estadias", "cambios_propietario", "notificaciones", "registros_auditoria",
  "horarios_doctor", "doctores", "mascotas", "servicios", "clientes", "usuarios",
] as const;

/** Borra un tenant de prueba entero: tablas de negocio en orden, el tenant y sus cuentas de Auth. */
export async function limpiarTenant(serviceDb: SupabaseClient, tenantId: string | undefined | null): Promise<void> {
  if (!tenantId) return;

  const { data: usuarios } = await serviceDb.from("usuarios").select("id").eq("tenant_id", tenantId);
  const usuarioIds = (usuarios ?? []).map((u) => (u as { id: string }).id);

  for (const tabla of ORDEN_BORRADO_TABLAS_NEGOCIO) {
    await serviceDb.from(tabla).delete().eq("tenant_id", tenantId);
  }
  await serviceDb.from("tenants").delete().eq("id", tenantId);

  for (const uid of usuarioIds) await borrarUsuarioAuth(uid);
}
