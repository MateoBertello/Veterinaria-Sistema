import type { SupabaseClient } from "@supabase/supabase-js";
import { DomainError, ErrorCode } from "../../shared/errors.ts";
import { recordAudit } from "../../shared/audit.ts";
import { getServiceDb } from "../../shared/db.ts";
import { sanitizeLikeTerm } from "../../shared/sanitize.ts";
import {
  CrearEspecieSchema,
  ActualizarEspecieSchema,
  CrearRazaSchema,
  ActualizarRazaSchema,
  CrearTipoVacunaSchema,
  ActualizarTipoVacunaSchema,
  AsociarEspeciesSchema,
  type CrearEspecieDto,
  type ActualizarEspecieDto,
  type CrearRazaDto,
  type ActualizarRazaDto,
  type CrearTipoVacunaDto,
  type ActualizarTipoVacunaDto,
  type AsociarEspeciesDto,
  type ListarCatalogoOpts,
  type ListarRazasOpts,
} from "./catalogos.schemas.ts";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CATÁLOGOS CLÍNICOS DEL TENANT — especies, razas y tipos de vacuna
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Cada clínica administra su propio catálogo desde que
 * `20260827000001_catalogos_por_tenant.sql` les puso `tenant_id`. Antes eran
 * globales y solo el Super Admin los tocaba.
 *
 * REGLAS DE NEGOCIO
 *
 *   RN-CAT1 — ALCANCE POR TENANT. Toda lectura y escritura opera únicamente
 *     sobre filas del `tenant_id` del JWT. El tenant nunca viaja en el request.
 *     Estas consultas corren con `getServiceDb()` (service role, RLS
 *     bypasseada), así que el `.eq("tenant_id", ...)` no es decorativo: es el
 *     único control que hay. Un ítem de otra clínica responde
 *     `404 CATALOG_NOT_FOUND` — no 403, para no confirmar que existe.
 *
 *   RN-CAT2 — UNICIDAD POR TENANT, case-insensitive. Nombre de especie y de
 *     tipo de vacuna únicos dentro de la clínica; en razas la unicidad es por
 *     (especie, nombre). Colisión → `409 CATALOG_DUPLICATE`. La base ya lo
 *     garantiza con UNIQUE (tenant_id, name) y UNIQUE (especie_id, name); la
 *     pre-consulta existe para devolver un error de dominio en vez de un 500
 *     de constraint, y por eso usa `ilike`: la UNIQUE es sensible a mayúsculas
 *     y "Perro"/"perro" son el mismo animal para quien carga el catálogo.
 *
 *   RN-CAT3 — LA ESPECIE DE UNA RAZA ES DEL MISMO TENANT. Un `especieId` que
 *     llega en el body no está validado por venir de una FK: se resuelve
 *     contra `especies` filtrando por tenant y, si no aparece, se rechaza con
 *     `422`. La FK compuesta (especie_id, tenant_id) lo frenaría igual, pero
 *     como error de base — es decir, un 500.
 *
 *   RN-CAT4 — BAJA LÓGICA, NUNCA DELETE. El módulo no expone borrado físico.
 *     Dos razones, y la primera es una trampa heredada: `razas.especie_id` es
 *     ON DELETE CASCADE, así que borrar una especie se llevaría sus razas en
 *     silencio, y `mascotas.raza_id` es ON DELETE SET NULL — la ficha de la
 *     mascota perdería el dato sin que nadie se entere. La segunda es que el
 *     historial clínico es un registro que no se reescribe. Sacar de
 *     circulación es `active = false`.
 *
 *   RN-CAT5 — NO SE DESACTIVA UN ÍTEM EN USO. "En uso" = referenciado por
 *     datos del MISMO tenant: especie → `mascotas.especie_id`; raza →
 *     `mascotas.raza_id`; tipo de vacuna → `plan_vacunacion.tipo_vacuna_id`.
 *     Violación → `409 CATALOG_IN_USE`. Solo la baja está protegida: reactivar
 *     no consulta uso.
 *
 *   RN-CAT6 — DESACTIVAR UNA ESPECIE NO TOCA SUS RAZAS. Quedan
 *     inseleccionables junto con ella porque el camino de lectura llega a las
 *     razas a través de una especie activa, no porque se les escriba nada. Sin
 *     cascada de escritura, reactivar la especie devuelve el catálogo tal como
 *     estaba.
 *
 *   RN-CAT7 — REACTIVAR UNA RAZA EXIGE ESPECIE ACTIVA. Si no, quedaría en un
 *     estado que la lectura filtra igual: activa en la tabla, invisible en la
 *     aplicación. → `409 CATALOG_IN_USE`.
 *
 *   RN-CAT8 — AUDITORÍA IMPLÍCITA (RN-S3/RN-UX4). Toda escritura registra en
 *     `registros_auditoria` desde el Service, módulo `catalogs`. Una escritura
 *     rechazada no deja asiento.
 *
 *   RN-CAT9 — UN ÍTEM INACTIVO SIGUE VISIBLE DONDE YA ESTÁ REFERENCIADO. La
 *     ficha de una mascota sigue mostrando su raza aunque esa raza esté dada
 *     de baja; lo que la baja impide es ELEGIRLA en altas nuevas (lo aplican
 *     `mascotas.service.ts` y `vacunacion.service.ts`, que validan el catálogo
 *     exigiendo `active = true`). El listado de gestión, en cambio, muestra
 *     activos e inactivos: es la pantalla desde la que se reactiva.
 *
 *   RN-CAT10 — UN TIPO DE VACUNA DECLARA A QUÉ ESPECIES APLICA. La relación
 *     es N:M contra el catálogo de especies (`especie_tipo_vacuna`), con al
 *     menos una especie, y reemplaza al `especie_aplicable` de texto libre que
 *     dropeó `20260828000001_vacunas_por_especie.sql`. Cada `especieId` se
 *     resuelve contra `especies` filtrando por tenant antes de escribirlo: un
 *     id de otra clínica es `422`, igual que en RN-CAT3. La FK compuesta
 *     (especie_id, tenant_id) lo frenaría de todas formas, pero como error de
 *     base — es decir, un 500. Un conjunto que llega, llega COMPLETO: la
 *     escritura reemplaza las asociaciones anteriores, no las suma.
 *
 *     Deliberadamente NO hay equivalente a nivel raza: el calendario sanitario
 *     es por especie. El razonamiento largo y el punto de extensión están en el
 *     encabezado de la migración.
 *
 *   RN-CAT11 — CAMBIAR LAS ESPECIES DE UNA VACUNA NO TOCA LAS DOSIS YA
 *     REGISTRADAS. Una dosis aplicada ES historial clínico y no se recalcula ni
 *     se invalida porque la clínica corrija el catálogo; una pendiente tampoco.
 *     La regla de aplicabilidad (RN-PV11) valida al PROGRAMAR, no al leer, así
 *     que desasociar una especie sólo cambia lo que se ofrece de acá en más.
 *     Por eso esta operación no consulta `plan_vacunacion` ni tiene un
 *     equivalente de RN-CAT5: no hay nada que bloquear.
 *
 * LECTURA vs ESCRITURA. El frontend sigue LEYENDO el catálogo por PostgREST
 * directo (excepción documentada en CLAUDE.md, hoy aislada por RLS de tenant).
 * Todo lo que ESCRIBE pasa por acá: Controller → Service → DB, con Zod,
 * permiso `manage_catalogs` y auditoría.
 */

// ─── Tipos públicos ───────────────────────────────────────────────────────────

export interface CallerContext {
  tenantId:     string;
  callerUserId: string;
  callerName:   string;
  callerRole:   string;
}

export interface EspeciePublica {
  id:          string;
  name:        string;
  description: string | null;
  active:      boolean;
}

export interface RazaPublica {
  id:          string;
  especieId:   string;
  /** Nombre de la especie, resuelto por embed en la MISMA consulta (sin N+1). */
  especieName: string | null;
  name:        string;
  description: string | null;
  active:      boolean;
}

/** Especie tal como la ve el catálogo de vacunas: id + nombre, nada más. */
export interface EspecieAsociada {
  id:   string;
  name: string;
}

export interface TipoVacunaPublico {
  id:                    string;
  nombre:                string;
  /**
   * Especies a las que aplica (RN-CAT10), resueltas por embed en la MISMA
   * consulta del listado. Vacío significa "no aplica a ninguna": la API no deja
   * llegar a ese estado, pero si una fila estuviera ahí, se lee estricto.
   */
  especies:              EspecieAsociada[];
  mesesRefuerzoSugerido: number | null;
  active:                boolean;
}

type Fila = Record<string, unknown>;

// ─── Mapeo snake ↔ camel ──────────────────────────────────────────────────────

function especieToPublic(row: Fila): EspeciePublica {
  return {
    id:          row["id"]          as string,
    name:        row["name"]        as string,
    description: (row["description"] as string | null) ?? null,
    active:      row["active"]      as boolean,
  };
}

/**
 * El embed a-uno de PostgREST llega como objeto, pero supabase-js lo tipa como
 * arreglo en algunas versiones. Se contemplan las dos formas para que un cambio
 * de versión no deje la columna "Especie" vacía en la tabla.
 */
function unwrapEmbed(valor: unknown): Fila | undefined {
  if (!valor) return undefined;
  return (Array.isArray(valor) ? valor[0] : valor) as Fila | undefined;
}

function nombreEmbebido(valor: unknown): string | null {
  return (unwrapEmbed(valor)?.["name"] as string | undefined) ?? null;
}

function razaToPublic(row: Fila): RazaPublica {
  return {
    id:          row["id"]         as string,
    especieId:   row["especie_id"] as string,
    especieName: nombreEmbebido(row["especie"]),
    name:        row["name"]       as string,
    description: (row["description"] as string | null) ?? null,
    active:      row["active"]     as boolean,
  };
}

/**
 * Aplana el embed `tipos_vacuna → especie_tipo_vacuna → especies` a una lista
 * plana de especies, ordenada por nombre para que la tabla de gestión no baile
 * entre recargas (PostgREST no garantiza el orden de un embed).
 */
function especiesEmbebidas(valor: unknown): EspecieAsociada[] {
  if (!Array.isArray(valor)) return [];
  return valor
    .map((rel) => unwrapEmbed((rel as Fila | undefined)?.["especie"]))
    .filter((e): e is Fila => Boolean(e?.["id"]))
    .map((e) => ({ id: e["id"] as string, name: e["name"] as string }))
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
}

function tipoVacunaToPublic(row: Fila): TipoVacunaPublico {
  return {
    id:                    row["id"]                      as string,
    nombre:                row["nombre"]                  as string,
    especies:              especiesEmbebidas(row["asociaciones"]),
    mesesRefuerzoSugerido: (row["meses_refuerzo_sugerido"] as number | null) ?? null,
    active:                row["active"]                  as boolean,
  };
}

// ─── Helpers compartidos ──────────────────────────────────────────────────────

/** Columnas del listado de razas: la especie viaja embebida (CLAUDE.md, N+1). */
const RAZA_COLS = "*, especie:especies(name)";

/**
 * Columnas del listado de tipos de vacuna: las especies aplicables viajan
 * embebidas a través de la tabla de asociación, en la MISMA consulta.
 *
 * LAS PISTAS DE EMBED NOMBRAN LA CONSTRAINT, NO LA COLUMNA — Y NO ES UN DETALLE
 * DE ESTILO. `especie_tipo_vacuna` referencia a `especies` y a `tipos_vacuna`
 * con FKs COMPUESTAS sobre (fk_id, tenant_id). Una pista de la forma
 * `tipos_vacuna!tipo_vacuna_id(...)` —que nombra una columna— deja de resolver
 * en cuanto la FK es compuesta: PostgREST responde PGRST200 y el endpoint
 * termina en 500. Ya pasó una vez, en las ocho consultas de vacunación e
 * historial que rompió la migración de catálogos por tenant, y ninguna suite
 * unit lo vio: el mock de supabase-js acepta cualquier string.
 */
const TIPO_VACUNA_COLS =
  "*, asociaciones:especie_tipo_vacuna!especie_tipo_vacuna_tipo_fkey(" +
  "especie:especies!especie_tipo_vacuna_especie_fkey(id, name))";

function validar<T>(schema: { safeParse: (v: unknown) => { success: boolean; data?: T; error?: { issues: unknown[] } } }, dto: unknown): T {
  const parsed = schema.safeParse(dto);
  if (!parsed.success) {
    throw new DomainError(
      ErrorCode.VALIDATION_ERROR,
      422,
      "Datos de catálogo inválidos",
      parsed.error?.issues ?? [],
    );
  }
  return parsed.data as T;
}

function noEncontrado(que: string): DomainError {
  // 404 y no 403: un id de otra clínica no debe distinguirse de uno inexistente.
  return new DomainError(ErrorCode.CATALOG_NOT_FOUND, 404, `${que} no encontrada/o en el catálogo de esta clínica`);
}

/** RN-CAT1: carga una fila del catálogo exigiendo que sea del tenant. */
async function cargarDelTenant(
  db: SupabaseClient,
  tabla: string,
  id: string,
  tenantId: string,
  cols = "*",
): Promise<Fila | null> {
  const { data } = await db
    .from(tabla)
    .select(cols)
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  return (data as Fila | null) ?? null;
}

/**
 * RN-CAT2: ¿hay otra fila con ese nombre en el mismo ámbito?
 *
 * `excluirId` deja fuera a la propia fila cuando se está editando; `ambito`
 * agrega el filtro extra que define el alcance de la unicidad (la especie, en
 * el caso de las razas).
 */
async function assertNombreLibre(
  db: SupabaseClient,
  tabla: string,
  columna: string,
  valor: string,
  tenantId: string,
  opts: { excluirId?: string; ambito?: { columna: string; valor: string } } = {},
): Promise<void> {
  let query = db
    .from(tabla)
    .select("id")
    .eq("tenant_id", tenantId)
    .ilike(columna, valor);

  if (opts.ambito) query = query.eq(opts.ambito.columna, opts.ambito.valor);
  if (opts.excluirId) query = query.neq("id", opts.excluirId);

  const { data } = await query.maybeSingle();

  if (data) {
    throw new DomainError(
      ErrorCode.CATALOG_DUPLICATE,
      409,
      `Ya existe "${valor}" en el catálogo de esta clínica`,
    );
  }
}

/**
 * RN-CAT5: ¿alguien del MISMO tenant referencia este ítem?
 *
 * El `.eq("tenant_id", ...)` no es redundante con el `.eq(columna, id)`: corre
 * con service role, así que sin él una mascota de otra clínica que apuntara al
 * mismo id bloquearía la baja acá — y de paso confirmaría su existencia.
 *
 * `.limit(1)` en vez de un count: solo importa si hay alguna, no cuántas.
 */
async function assertNoEnUso(
  db: SupabaseClient,
  tabla: string,
  columna: string,
  id: string,
  tenantId: string,
  mensaje: string,
): Promise<void> {
  const { data } = await db
    .from(tabla)
    .select("id")
    .eq("tenant_id", tenantId)
    .eq(columna, id)
    .limit(1);

  if ((data as unknown[] | null)?.length) {
    throw new DomainError(ErrorCode.CATALOG_IN_USE, 409, mensaje);
  }
}

/** RN-CAT8: asiento de auditoría del módulo `catalogs`. */
async function auditar(
  db: SupabaseClient,
  ctx: CallerContext,
  action: "CREATE" | "UPDATE",
  entityId: string,
  valores: { oldValues?: Fila; newValues?: Fila },
): Promise<void> {
  await recordAudit(db, {
    tenantId: ctx.tenantId,
    userId:   ctx.callerUserId,
    userName: ctx.callerName,
    userRole: ctx.callerRole,
    action,
    module:   "catalogs",
    entityId,
    ...valores,
  });
}

/** Aplica los filtros comunes de los listados de gestión. */
function aplicarFiltros<Q extends {
  eq: (c: string, v: unknown) => Q;
  ilike: (c: string, v: string) => Q;
}>(query: Q, opts: { active?: boolean; search?: string }, columnaNombre: string): Q {
  let q = query;
  // `undefined` = sin filtrar: la pantalla de gestión necesita ver también los
  // dados de baja para poder reactivarlos (RN-CAT9).
  if (opts.active !== undefined) q = q.eq("active", opts.active);
  if (opts.search) q = q.ilike(columnaNombre, `%${sanitizeLikeTerm(opts.search)}%`);
  return q;
}

function fallo(error: { message?: string } | null, que: string): never {
  throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, `${que}: ${error?.message ?? ""}`);
}

// ══════════════════════════════════════════════════════════════════════════════
// Especies
// ══════════════════════════════════════════════════════════════════════════════

export const EspeciesService = {
  async buscarPaginado(
    opts: ListarCatalogoOpts,
    tenantId: string,
  ): Promise<{ items: EspeciePublica[]; total: number }> {
    const db     = getServiceDb();
    const offset = (opts.page - 1) * opts.limit;

    const query = aplicarFiltros(
      db.from("especies").select("*", { count: "exact" }).eq("tenant_id", tenantId),
      opts,
      "name",
    );

    const { data, error, count } = await query
      .order("name", { ascending: true })
      .range(offset, offset + opts.limit - 1);

    if (error) fallo(error, "No se pudo listar el catálogo de especies");

    return {
      items: ((data as Fila[]) ?? []).map(especieToPublic),
      total: count ?? 0,
    };
  },

  /** RN-CAT2, RN-CAT8. */
  async crear(dto: CrearEspecieDto, ctx: CallerContext): Promise<EspeciePublica> {
    const data = validar<CrearEspecieDto>(CrearEspecieSchema, dto);
    const db   = getServiceDb();

    await assertNombreLibre(db, "especies", "name", data.name, ctx.tenantId);

    const payload = {
      tenant_id:   ctx.tenantId, // RN-CAT1: siempre del JWT
      name:        data.name,
      description: data.description ?? null,
      active:      true,
    };

    const { data: row, error } = await db.from("especies").insert(payload).select("*").single();
    if (error || !row) fallo(error, "No se pudo crear la especie");

    await auditar(db, ctx, "CREATE", (row as Fila)["id"] as string, { newValues: payload });
    return especieToPublic(row as Fila);
  },

  /** RN-CAT1, RN-CAT2, RN-CAT8. */
  async actualizar(id: string, dto: ActualizarEspecieDto, ctx: CallerContext): Promise<EspeciePublica> {
    const data = validar<ActualizarEspecieDto>(ActualizarEspecieSchema, dto);
    const db   = getServiceDb();

    const actual = await cargarDelTenant(db, "especies", id, ctx.tenantId);
    if (!actual) throw noEncontrado("Especie");

    if (data.name !== undefined && data.name !== actual["name"]) {
      await assertNombreLibre(db, "especies", "name", data.name, ctx.tenantId, { excluirId: id });
    }

    const cambios: Fila = {};
    if (data.name        !== undefined) cambios["name"]        = data.name;
    if (data.description !== undefined) cambios["description"] = data.description ?? null;

    const { data: row, error } = await db
      .from("especies").update(cambios)
      .eq("id", id).eq("tenant_id", ctx.tenantId)
      .select("*").single();

    if (error) fallo(error, "No se pudo actualizar la especie");

    await auditar(db, ctx, "UPDATE", id, { oldValues: actual, newValues: cambios });
    return especieToPublic((row as Fila) ?? { ...actual, ...cambios });
  },

  /** RN-CAT4, RN-CAT5, RN-CAT6, RN-CAT8. */
  async cambiarEstado(id: string, active: boolean, ctx: CallerContext): Promise<EspeciePublica> {
    const db = getServiceDb();

    const actual = await cargarDelTenant(db, "especies", id, ctx.tenantId);
    if (!actual) throw noEncontrado("Especie");

    if (!active) {
      // RN-CAT5. RN-CAT6: no se toca ninguna raza — quedan inseleccionables
      // porque la lectura pasa por una especie activa, no por una cascada.
      await assertNoEnUso(
        db, "mascotas", "especie_id", id, ctx.tenantId,
        "No se puede dar de baja una especie que tiene mascotas registradas",
      );
    }

    const { data: row, error } = await db
      .from("especies").update({ active })
      .eq("id", id).eq("tenant_id", ctx.tenantId)
      .select("*").single();

    if (error) fallo(error, "No se pudo cambiar el estado de la especie");

    await auditar(db, ctx, "UPDATE", id, { oldValues: actual, newValues: { active } });
    return especieToPublic((row as Fila) ?? { ...actual, active });
  },
};

// ══════════════════════════════════════════════════════════════════════════════
// Razas
// ══════════════════════════════════════════════════════════════════════════════

/** RN-CAT3: resuelve la especie exigiendo que sea del tenant. */
async function resolverEspecieDelTenant(
  db: SupabaseClient,
  especieId: string,
  tenantId: string,
): Promise<Fila> {
  const especie = await cargarDelTenant(db, "especies", especieId, tenantId);
  if (!especie) {
    throw new DomainError(
      ErrorCode.VALIDATION_ERROR,
      422,
      "La especie no existe en el catálogo de esta clínica",
      [{ field: "especieId", message: "Especie inexistente en este tenant" }],
    );
  }
  return especie;
}

/**
 * RN-CAT10: resuelve varias especies exigiendo que TODAS sean del tenant, en
 * una sola consulta (`in`), no una por id. Devuelve los ids validados.
 *
 * El mensaje no enumera los ids que faltaron por deliberación: un id de otra
 * clínica y uno inexistente tienen que ser indistinguibles desde afuera (mismo
 * criterio que el 404 de `noEncontrado`).
 */
async function resolverEspeciesDelTenant(
  db: SupabaseClient,
  especieIds: string[],
  tenantId: string,
): Promise<EspecieAsociada[]> {
  const { data, error } = await db
    .from("especies")
    .select("id, name")
    .eq("tenant_id", tenantId)
    .in("id", especieIds);

  if (error) fallo(error, "No se pudieron verificar las especies");

  const encontradas = ((data as Fila[]) ?? [])
    .map((f) => ({ id: f["id"] as string, name: f["name"] as string }));

  if (encontradas.length !== new Set(especieIds).size) {
    throw new DomainError(
      ErrorCode.VALIDATION_ERROR,
      422,
      "Alguna de las especies no existe en el catálogo de esta clínica",
      [{ field: "especieIds", message: "Especie inexistente en este tenant" }],
    );
  }

  // Se devuelven ya resueltas (id + nombre) para poder componer el DTO de
  // respuesta sin releer la fila: esta consulta es la única que hace falta.
  return encontradas.sort((a, b) => a.name.localeCompare(b.name, "es"));
}

/**
 * RN-CAT10: deja las asociaciones de un tipo de vacuna EXACTAMENTE en
 * `especieIds`. Borra las que sobran y agrega las que faltan en vez de "borrar
 * todo y reinsertar": así una edición que no cambia nada no reescribe filas, y
 * el `created_at` de las que ya estaban sobrevive.
 *
 * No hay transacción. El peor caso es quedar con el borrado hecho y el alta no,
 * que se corrige reintentando desde la misma pantalla; envolver esto en un RPC
 * costaría duplicar la validación de tenant en SQL para proteger un catálogo
 * que se edita a mano y de a una vacuna por vez.
 */
async function sincronizarEspecies(
  db: SupabaseClient,
  tipoVacunaId: string,
  especieIds: string[],
  tenantId: string,
): Promise<void> {
  const { data, error } = await db
    .from("especie_tipo_vacuna")
    .select("especie_id")
    .eq("tenant_id", tenantId)
    .eq("tipo_vacuna_id", tipoVacunaId);

  if (error) fallo(error, "No se pudieron leer las especies de la vacuna");

  const actuales = new Set(((data as Fila[]) ?? []).map((f) => f["especie_id"] as string));
  const deseadas = new Set(especieIds);

  const aBorrar  = [...actuales].filter((id) => !deseadas.has(id));
  const aAgregar = [...deseadas].filter((id) => !actuales.has(id));

  if (aBorrar.length > 0) {
    const { error: delErr } = await db
      .from("especie_tipo_vacuna")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("tipo_vacuna_id", tipoVacunaId)
      .in("especie_id", aBorrar);
    if (delErr) fallo(delErr, "No se pudieron quitar especies de la vacuna");
  }

  if (aAgregar.length > 0) {
    const { error: insErr } = await db
      .from("especie_tipo_vacuna")
      .insert(aAgregar.map((especieId) => ({
        tenant_id:      tenantId, // RN-CAT1: siempre del JWT
        tipo_vacuna_id: tipoVacunaId,
        especie_id:     especieId,
      })));
    if (insErr) fallo(insErr, "No se pudieron asociar las especies a la vacuna");
  }
}

export const RazasService = {
  async buscarPaginado(
    opts: ListarRazasOpts,
    tenantId: string,
  ): Promise<{ items: RazaPublica[]; total: number }> {
    const db     = getServiceDb();
    const offset = (opts.page - 1) * opts.limit;

    // UNA sola consulta: el nombre de la especie viene embebido. Traer las razas
    // y después pedir su especie fila por fila sería el N+1 que el CLAUDE.md
    // prohíbe explícitamente.
    let query = aplicarFiltros(
      db.from("razas").select(RAZA_COLS, { count: "exact" }).eq("tenant_id", tenantId),
      opts,
      "name",
    );

    if (opts.especieId) query = query.eq("especie_id", opts.especieId);

    const { data, error, count } = await query
      .order("name", { ascending: true })
      .range(offset, offset + opts.limit - 1);

    if (error) fallo(error, "No se pudo listar el catálogo de razas");

    return {
      items: ((data as Fila[]) ?? []).map(razaToPublic),
      total: count ?? 0,
    };
  },

  /** RN-CAT2, RN-CAT3, RN-CAT8. */
  async crear(dto: CrearRazaDto, ctx: CallerContext): Promise<RazaPublica> {
    const data = validar<CrearRazaDto>(CrearRazaSchema, dto);
    const db   = getServiceDb();

    await resolverEspecieDelTenant(db, data.especieId, ctx.tenantId); // RN-CAT3

    // RN-CAT2: la unicidad de raza es por (especie, nombre).
    await assertNombreLibre(db, "razas", "name", data.name, ctx.tenantId, {
      ambito: { columna: "especie_id", valor: data.especieId },
    });

    const payload = {
      tenant_id:   ctx.tenantId,
      especie_id:  data.especieId,
      name:        data.name,
      description: data.description ?? null,
      active:      true,
    };

    const { data: row, error } = await db.from("razas").insert(payload).select(RAZA_COLS).single();
    if (error || !row) fallo(error, "No se pudo crear la raza");

    await auditar(db, ctx, "CREATE", (row as Fila)["id"] as string, { newValues: payload });
    return razaToPublic(row as Fila);
  },

  /** RN-CAT1, RN-CAT2, RN-CAT3, RN-CAT8. */
  async actualizar(id: string, dto: ActualizarRazaDto, ctx: CallerContext): Promise<RazaPublica> {
    const data = validar<ActualizarRazaDto>(ActualizarRazaSchema, dto);
    const db   = getServiceDb();

    const actual = await cargarDelTenant(db, "razas", id, ctx.tenantId, RAZA_COLS);
    if (!actual) throw noEncontrado("Raza");

    const especieDestino = (data.especieId ?? actual["especie_id"]) as string;

    // RN-CAT3: solo si efectivamente cambia de especie.
    if (data.especieId !== undefined && data.especieId !== actual["especie_id"]) {
      await resolverEspecieDelTenant(db, data.especieId, ctx.tenantId);
    }

    // RN-CAT2: revalidar si cambia el nombre O si se muda de especie (el mismo
    // nombre puede estar libre en una especie y ocupado en la otra).
    const cambiaNombre  = data.name !== undefined && data.name !== actual["name"];
    const cambiaEspecie = especieDestino !== actual["especie_id"];
    if (cambiaNombre || cambiaEspecie) {
      await assertNombreLibre(
        db, "razas", "name", (data.name ?? actual["name"]) as string, ctx.tenantId,
        { excluirId: id, ambito: { columna: "especie_id", valor: especieDestino } },
      );
    }

    const cambios: Fila = {};
    if (data.especieId   !== undefined) cambios["especie_id"]  = data.especieId;
    if (data.name        !== undefined) cambios["name"]        = data.name;
    if (data.description !== undefined) cambios["description"] = data.description ?? null;

    const { data: row, error } = await db
      .from("razas").update(cambios)
      .eq("id", id).eq("tenant_id", ctx.tenantId)
      .select(RAZA_COLS).single();

    if (error) fallo(error, "No se pudo actualizar la raza");

    await auditar(db, ctx, "UPDATE", id, { oldValues: actual, newValues: cambios });
    return razaToPublic((row as Fila) ?? { ...actual, ...cambios });
  },

  /** RN-CAT4, RN-CAT5, RN-CAT7, RN-CAT8. */
  async cambiarEstado(id: string, active: boolean, ctx: CallerContext): Promise<RazaPublica> {
    const db = getServiceDb();

    const actual = await cargarDelTenant(db, "razas", id, ctx.tenantId, RAZA_COLS);
    if (!actual) throw noEncontrado("Raza");

    if (!active) {
      // RN-CAT5
      await assertNoEnUso(
        db, "mascotas", "raza_id", id, ctx.tenantId,
        "No se puede dar de baja una raza que tiene mascotas registradas",
      );
    } else {
      // RN-CAT7: reactivarla bajo una especie inactiva la dejaría activa en la
      // tabla e invisible en la aplicación — un estado que confunde más de lo
      // que resuelve. Primero se reactiva la especie.
      const especie = await cargarDelTenant(db, "especies", actual["especie_id"] as string, ctx.tenantId);
      if (!especie?.["active"]) {
        throw new DomainError(
          ErrorCode.CATALOG_IN_USE,
          409,
          "No se puede reactivar una raza cuya especie está dada de baja: reactivá primero la especie",
        );
      }
    }

    const { data: row, error } = await db
      .from("razas").update({ active })
      .eq("id", id).eq("tenant_id", ctx.tenantId)
      .select(RAZA_COLS).single();

    if (error) fallo(error, "No se pudo cambiar el estado de la raza");

    await auditar(db, ctx, "UPDATE", id, { oldValues: actual, newValues: { active } });
    return razaToPublic((row as Fila) ?? { ...actual, active });
  },
};

// ══════════════════════════════════════════════════════════════════════════════
// Tipos de vacuna
// ══════════════════════════════════════════════════════════════════════════════

export const TiposVacunaService = {
  async buscarPaginado(
    opts: ListarCatalogoOpts,
    tenantId: string,
  ): Promise<{ items: TipoVacunaPublico[]; total: number }> {
    const db     = getServiceDb();
    const offset = (opts.page - 1) * opts.limit;

    // UNA sola consulta: las especies aplicables vienen embebidas a través de
    // `especie_tipo_vacuna`. Pedirlas después, vacuna por vacuna, sería el N+1
    // que el CLAUDE.md prohíbe.
    const query = aplicarFiltros(
      db.from("tipos_vacuna").select(TIPO_VACUNA_COLS, { count: "exact" }).eq("tenant_id", tenantId),
      opts,
      "nombre",
    );

    const { data, error, count } = await query
      .order("nombre", { ascending: true })
      .range(offset, offset + opts.limit - 1);

    if (error) fallo(error, "No se pudo listar el catálogo de tipos de vacuna");

    return {
      // Doble cast: el parser de tipos de supabase-js no sabe leer una pista de
      // embed por nombre de constraint y devuelve `GenericStringError[]`. El
      // dato en runtime es el correcto — lo prueban los tests de integración.
      items: ((data as unknown as Fila[]) ?? []).map(tipoVacunaToPublic),
      total: count ?? 0,
    };
  },

  /** RN-CAT2, RN-CAT8, RN-CAT10. */
  async crear(dto: CrearTipoVacunaDto, ctx: CallerContext): Promise<TipoVacunaPublico> {
    const data = validar<CrearTipoVacunaDto>(CrearTipoVacunaSchema, dto);
    const db   = getServiceDb();

    await assertNombreLibre(db, "tipos_vacuna", "nombre", data.nombre, ctx.tenantId);

    // RN-CAT10, ANTES de insertar: si alguna especie no es de esta clínica, el
    // pedido se rechaza sin haber creado nada.
    const especies = await resolverEspeciesDelTenant(db, data.especieIds, ctx.tenantId);

    const payload = {
      tenant_id:               ctx.tenantId,
      nombre:                  data.nombre,
      meses_refuerzo_sugerido: data.mesesRefuerzoSugerido ?? null,
      active:                  true,
    };

    const { data: row, error } = await db.from("tipos_vacuna").insert(payload).select("*").single();
    if (error || !row) fallo(error, "No se pudo crear el tipo de vacuna");

    const id = (row as Fila)["id"] as string;

    // Las asociaciones van en un segundo INSERT: necesitan el id que acaba de
    // generar el anterior. Si fallan, se deshace la vacuna recién creada en vez
    // de dejarla sin especies —es decir, inutilizable— y sin que nadie lo note.
    // El DELETE es seguro justo acá y sólo acá: la fila tiene segundos de vida y
    // todavía no puede estar referenciada por ninguna dosis, así que no choca
    // con RN-CAT4 (que prohíbe el borrado como operación del catálogo, no esta
    // compensación interna).
    try {
      await sincronizarEspecies(db, id, data.especieIds, ctx.tenantId);
    } catch (err) {
      await db.from("tipos_vacuna").delete().eq("id", id).eq("tenant_id", ctx.tenantId);
      throw err;
    }

    await auditar(db, ctx, "CREATE", id, {
      newValues: { ...payload, especie_ids: data.especieIds },
    });

    return { ...tipoVacunaToPublic(row as Fila), especies };
  },

  /** RN-CAT1, RN-CAT2, RN-CAT8, RN-CAT10. */
  async actualizar(id: string, dto: ActualizarTipoVacunaDto, ctx: CallerContext): Promise<TipoVacunaPublico> {
    const data = validar<ActualizarTipoVacunaDto>(ActualizarTipoVacunaSchema, dto);
    const db   = getServiceDb();

    const actual = await cargarDelTenant(db, "tipos_vacuna", id, ctx.tenantId, TIPO_VACUNA_COLS);
    if (!actual) throw noEncontrado("Tipo de vacuna");

    if (data.nombre !== undefined && data.nombre !== actual["nombre"]) {
      await assertNombreLibre(db, "tipos_vacuna", "nombre", data.nombre, ctx.tenantId, { excluirId: id });
    }

    // RN-CAT10: `especieIds` es opcional en la edición (se puede corregir el
    // nombre sin tocar las especies), pero si viene, viene COMPLETO y reemplaza
    // el conjunto entero.
    const especies = data.especieIds !== undefined
      ? await resolverEspeciesDelTenant(db, data.especieIds, ctx.tenantId)
      : especiesEmbebidas(actual["asociaciones"]);

    const cambios: Fila = {};
    if (data.nombre                !== undefined) cambios["nombre"]                  = data.nombre;
    if (data.mesesRefuerzoSugerido !== undefined) cambios["meses_refuerzo_sugerido"] = data.mesesRefuerzoSugerido ?? null;

    // Un PUT que sólo trae `especieIds` no tiene columnas propias que escribir;
    // el UPDATE se saltea para no mandarle a PostgREST un patch vacío (que
    // responde 400) y la fila vigente hace de base del DTO.
    let fila: Fila = actual;
    if (Object.keys(cambios).length > 0) {
      const { data: row, error } = await db
        .from("tipos_vacuna").update(cambios)
        .eq("id", id).eq("tenant_id", ctx.tenantId)
        .select("*").single();

      if (error) fallo(error, "No se pudo actualizar el tipo de vacuna");
      fila = (row as Fila) ?? { ...actual, ...cambios };
    }

    if (data.especieIds !== undefined) {
      await sincronizarEspecies(db, id, data.especieIds, ctx.tenantId);
    }

    await auditar(db, ctx, "UPDATE", id, {
      oldValues: { ...actual, especie_ids: especiesEmbebidas(actual["asociaciones"]).map((e) => e.id) },
      newValues: data.especieIds !== undefined ? { ...cambios, especie_ids: data.especieIds } : cambios,
    });

    return { ...tipoVacunaToPublic(fila), especies };
  },

  /**
   * RN-CAT10, RN-CAT8: reemplaza el conjunto de especies a las que aplica la
   * vacuna. Es la operación que consume la pantalla de asociación; `actualizar`
   * hace lo mismo cuando el PUT del formulario ya trae `especieIds`.
   *
   * RN-CAT11: no se consulta `plan_vacunacion`. Las dosis ya programadas o
   * aplicadas no se invalidan porque la clínica corrija el calendario — la regla
   * de aplicabilidad valida al programar, no al leer.
   */
  async asociarEspecies(id: string, dto: AsociarEspeciesDto, ctx: CallerContext): Promise<TipoVacunaPublico> {
    const data = validar<AsociarEspeciesDto>(AsociarEspeciesSchema, dto);
    const db   = getServiceDb();

    const actual = await cargarDelTenant(db, "tipos_vacuna", id, ctx.tenantId, TIPO_VACUNA_COLS);
    if (!actual) throw noEncontrado("Tipo de vacuna");

    const especies = await resolverEspeciesDelTenant(db, data.especieIds, ctx.tenantId);
    await sincronizarEspecies(db, id, data.especieIds, ctx.tenantId);

    await auditar(db, ctx, "UPDATE", id, {
      oldValues: { especie_ids: especiesEmbebidas(actual["asociaciones"]).map((e) => e.id) },
      newValues: { especie_ids: data.especieIds },
    });

    return { ...tipoVacunaToPublic(actual), especies };
  },

  /** RN-CAT4, RN-CAT5, RN-CAT8. */
  async cambiarEstado(id: string, active: boolean, ctx: CallerContext): Promise<TipoVacunaPublico> {
    const db = getServiceDb();

    const actual = await cargarDelTenant(db, "tipos_vacuna", id, ctx.tenantId, TIPO_VACUNA_COLS);
    if (!actual) throw noEncontrado("Tipo de vacuna");

    if (!active) {
      // RN-CAT5: cubre TODAS las dosis, no solo las pendientes. Una dosis
      // aplicada es historia clínica y su tipo tiene que seguir resolviendo.
      await assertNoEnUso(
        db, "plan_vacunacion", "tipo_vacuna_id", id, ctx.tenantId,
        "No se puede dar de baja un tipo de vacuna con dosis registradas",
      );
    }

    const { data: row, error } = await db
      .from("tipos_vacuna").update({ active })
      .eq("id", id).eq("tenant_id", ctx.tenantId)
      .select("*").single();

    if (error) fallo(error, "No se pudo cambiar el estado del tipo de vacuna");

    await auditar(db, ctx, "UPDATE", id, { oldValues: actual, newValues: { active } });

    // La baja no toca las asociaciones (mismo criterio que RN-CAT6 con las
    // razas): se conservan para que reactivar devuelva la vacuna tal como
    // estaba. Por eso el DTO las arrastra desde la fila que ya se leyó.
    return {
      ...tipoVacunaToPublic((row as Fila) ?? { ...actual, active }),
      especies: especiesEmbebidas(actual["asociaciones"]),
    };
  },
};
