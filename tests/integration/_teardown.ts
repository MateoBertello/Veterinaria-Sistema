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
 * Borra una cuenta de Auth buscándola por email con paginación (perPage: 1000).
 * Revienta si no pudo borrarla o si la cuenta sobrevive al DELETE.
 */
export async function borrarUsuarioAuthPorEmail(email: string): Promise<void> {
  let page = 1;
  const perPage = 1000;
  let targetId: string | null = null;

  while (true) {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?page=${page}&per_page=${perPage}`, {
      headers: adminHeaders(),
    });
    if (!res.ok) {
      throw new Error(`borrarUsuarioAuthPorEmail(${email}): error al listar usuarios (pág ${page}): ${res.statusText}`);
    }
    const data = await res.json() as { users?: Array<{ id: string; email?: string }> };
    const users = data.users ?? [];
    const found = users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (found) {
      targetId = found.id;
      break;
    }
    if (users.length < perPage) {
      break;
    }
    page++;
  }

  if (!targetId) return;

  const delRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${targetId}`, {
    method: "DELETE",
    headers: adminHeaders(),
  });
  if (!delRes.ok) {
    throw new Error(`borrarUsuarioAuthPorEmail(${email}): falló DELETE ${targetId} — status ${delRes.status}: ${delRes.statusText}`);
  }

  // Verificación activa: la cuenta no puede seguir existiendo
  const verifyRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${targetId}`, {
    headers: adminHeaders(),
  });
  if (verifyRes.ok) {
    throw new Error(`borrarUsuarioAuthPorEmail(${email}): la cuenta de Auth ${targetId} sigue existiendo tras el DELETE.`);
  }
}

/**
 * Tablas de negocio con `tenant_id`, en orden hijo → padre según las FKs
 * ON DELETE RESTRICT del Apéndice DDL. Borrar una tabla vacía para ese tenant
 * es un no-op, así que correr la lista entera es seguro aunque la suite no
 * siembre todas las entidades.
 */
// Ya no se recorre para borrar (ver `limpiarTenant`): queda como el mapa
// hijo → padre de las dependencias del tenant, que es lo que explica por qué la
// cascada de `dar_de_baja_tenant()` alcanza y en qué orden se resuelve.
export const ORDEN_BORRADO_TABLAS_NEGOCIO = [
  "plan_vacunacion", "adjuntos_medicos", "historial_clinico", "turnos",
  "estadias", "cambios_propietario", "notificaciones", "registros_auditoria",
  "horarios_doctor", "doctores", "mascotas", "servicios", "clientes", "usuarios",
  // Catálogos clínicos: por tenant desde 20260827000001_catalogos_por_tenant.sql,
  // así que ahora los borra el teardown como cualquier otra tabla del tenant.
  // Van AL FINAL y en este orden por las FKs compuestas: `mascotas` referencia
  // especies y razas con ON DELETE RESTRICT, y `plan_vacunacion` referencia
  // tipos_vacuna igual — las dos ya se fueron para cuando llega este tramo.
  // `razas` antes que `especies` porque la CASCADE de especies→razas se
  // dispararía igual, pero el orden explícito no depende de eso.
  // `especie_tipo_vacuna` va ANTES que las dos tablas que referencia
  // (20260828000001_vacunas_por_especie.sql). Sus FKs son ON DELETE CASCADE, así
  // que borrarla explícitamente es redundante — se pone igual por lo mismo que
  // el resto de esta lista: el orden no depende de una cascada que alguien puede
  // cambiar sin darse cuenta de que este teardown la estaba usando.
  "especie_tipo_vacuna", "razas", "especies", "tipos_vacuna",
] as const;

/**
 * Ids del catálogo clínico DE UN TENANT: especie, una raza de esa especie y un
 * tipo de vacuna activo.
 *
 * Los catálogos dejaron de ser globales (20260827000001_catalogos_por_tenant.sql):
 * cada clínica nace con SU copia, creada por `on_tenant_created`, y las FKs
 * compuestas sobre (especie_id, tenant_id) / (raza_id, tenant_id) /
 * (tipo_vacuna_id, tenant_id) rechazan en la base un catálogo de otra clínica.
 *
 * De ahí las dos condiciones que este helper impone y que antes no existían:
 * hay que pedir el catálogo DE SU tenant (no "la primera fila que aparezca") y
 * hay que pedirlo DESPUÉS de crear el tenant. Un fixture que tomara el catálogo
 * global —como hacían todas estas suites— hoy elegiría el de una clínica
 * cualquiera y el INSERT de la mascota moriría con un error de FK.
 *
 * Revienta si falta alguno, en vez de devolver "" y dejar que la suite falle
 * más adelante por una razón que no es la que se está probando.
 */
export async function catalogoDelTenant(
  serviceDb: SupabaseClient,
  tenantId: string,
): Promise<{ especieId: string; razaId: string; tipoVacunaId: string }> {
  const { data: especie } = await serviceDb
    .from("especies").select("id")
    .eq("tenant_id", tenantId).eq("name", "Perro").maybeSingle();
  const especieId = (especie as { id?: string } | null)?.id ?? "";

  const { data: raza } = await serviceDb
    .from("razas").select("id")
    .eq("tenant_id", tenantId).eq("especie_id", especieId).limit(1).maybeSingle();
  const razaId = (raza as { id?: string } | null)?.id ?? "";

  // El tipo de vacuna tiene que ser APLICABLE A "Perro", que es la especie que
  // este helper devuelve y con la que las suites crean sus mascotas.
  //
  // Antes acá se tomaba "el primer tipo de vacuna activo", cualquiera. Con
  // RN-PV11 eso es una bomba de tiempo: si la fila que devolviera el `.limit(1)`
  // fuese "Triple Felina", toda suite que programe una dosis para su perro
  // fallaría con VACCINE_NOT_APPLICABLE_TO_SPECIES — y el rojo aparecería en el
  // test de otra regla, no en el de ésta. Se pide por la relación, que es la
  // misma fuente de verdad que consulta el Service.
  const { data: tipo } = await serviceDb
    .from("especie_tipo_vacuna")
    .select("tipo_vacuna_id, tipo:tipos_vacuna!especie_tipo_vacuna_tipo_fkey(id, active)")
    .eq("tenant_id", tenantId)
    .eq("especie_id", especieId)
    .eq("tipo.active", true)
    .limit(1)
    .maybeSingle();
  const tipoVacunaId = (tipo as { tipo_vacuna_id?: string } | null)?.tipo_vacuna_id ?? "";

  const faltantes = Object.entries({ especieId, razaId, tipoVacunaId })
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (faltantes.length > 0) {
    throw new Error(
      `El tenant ${tenantId} no tiene catálogo clínico (falta: ${faltantes.join(", ")}). ` +
      "Lo siembra on_tenant_created; si falta `tipoVacunaId`, puede ser que la especie no tenga " +
      "ninguna vacuna asociada — eso lo siembra 20260828000001_vacunas_por_especie.sql. " +
      "Si falta todo, no está aplicada 20260827000001_catalogos_por_tenant.sql en este Supabase.",
    );
  }

  return { especieId, razaId, tipoVacunaId };
}

/**
 * Borra un tenant de prueba entero: tablas de negocio, la fila de `tenants` y
 * sus cuentas de Auth. **Revienta si no puede limpiar.**
 *
 * POR QUÉ REVIENTA AHORA Y ANTES NO
 *
 * Esta función ignoraba el `error` de cada `.delete()` y el de `tenants`. Con el
 * Módulo Comercial eso dejó de ser una imprudencia teórica: los dos libros
 * mayores (`movimientos_stock`, `movimientos_caja`) tienen un trigger
 * `BEFORE DELETE` que hacía fallar la cascada de `tenants` SIEMPRE, así que
 * ninguna suite que tocara stock o caja borraba nunca su clínica. El síntoma no
 * era un rojo sino 168 tenants residuales acumulados y, con ellos, cuentas de
 * Auth huérfanas que rompían la corrida siguiente por email duplicado — un rojo
 * en un test que no tenía nada que ver con lo que se estaba tocando.
 *
 * Un teardown que no puede limpiar y no avisa es peor que uno que no existe:
 * esconde el problema y lo cobra en la corrida siguiente. Ahora corta acá, con
 * el error de Postgres, y además VERIFICA que la fila se haya ido.
 *
 * CÓMO BORRA
 *
 * Por `dar_de_baja_tenant()` (20261027000003), que es la vía legítima: borra la
 * fila de `tenants` y deja que la cascada arrastre todo. Los libros mayores solo
 * pueden irse ahí — con la clínica viva el trigger de inmutabilidad los sigue
 * frenando, que es exactamente lo que tiene que hacer.
 *
 * El borrado explícito tabla por tabla que hacía antes YA NO SE PUEDE hacer:
 * `movimientos_stock` referencia `mascotas`, `historial_clinico`,
 * `plan_vacunacion`, `productos` y `lotes` con ON DELETE RESTRICT, y el libro
 * mayor no se puede sacar de en medio hasta que se borre el tenant. Cualquier
 * DELETE suelto sobre esas tablas aborta. Queda un solo orden posible y es el
 * que impone la cascada.
 *
 * `ORDEN_BORRADO_TABLAS_NEGOCIO` se conserva como documentación del árbol de
 * dependencias hijo → padre, que sigue siendo la referencia para entender por
 * qué la cascada alcanza.
 */
export async function limpiarTenant(serviceDb: SupabaseClient, tenantId: string | undefined | null): Promise<void> {
  if (!tenantId) return;

  const { data: usuarios } = await serviceDb.from("usuarios").select("id").eq("tenant_id", tenantId);
  const usuarioIds = (usuarios ?? []).map((u) => (u as { id: string }).id);

  const { error: errBaja } = await serviceDb.rpc("dar_de_baja_tenant", { p_tenant_id: tenantId });
  if (errBaja) {
    throw new Error(
      `limpiarTenant(${tenantId}): dar_de_baja_tenant falló — ${errBaja.code}: ${errBaja.message}. ` +
      "El tenant queda residual y su cuenta de Auth huérfana va a romper la corrida siguiente.",
    );
  }

  // Comprobación real: que la RPC no devuelva error no prueba que la fila se
  // haya ido. Sin esto volveríamos al silencio de antes, un nivel más arriba.
  const { data: sobreviviente } = await serviceDb
    .from("tenants").select("id").eq("id", tenantId).maybeSingle();
  if (sobreviviente) {
    throw new Error(
      `limpiarTenant(${tenantId}): la fila de tenants sigue existiendo después de dar_de_baja_tenant.`,
    );
  }

  for (const uid of usuarioIds) await borrarUsuarioAuth(uid);
}
