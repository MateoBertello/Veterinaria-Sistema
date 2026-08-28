import { DomainError, ErrorCode } from "../../shared/errors.ts";
import { recordAudit } from "../../shared/audit.ts";
import { getServiceDb } from "../../shared/db.ts";
import { assertProfesionalAsignable } from "../../shared/profesional.ts";
import type { ProgramarDosisDto, EditarDosisDto, MarcarAplicadaDto } from "./vacunacion.schemas.ts";

// ─── DTOs públicos ────────────────────────────────────────────────────────────

export interface CallerContext {
  tenantId:     string;
  callerUserId: string;
  callerName:   string;
  callerRole:   string;
}

export interface DosisPublica {
  id:                   string;
  petId:                string;
  tipoVacunaId:         string;
  tipoVacunaNombre:     string | null;
  eventoOrigenId:       string | null;
  eventoAplicacionId:   string | null;
  fechaEstimada:        string;
  estado:               "Pendiente" | "Aplicada" | "Cancelada";
  estadoVisual:         "Proxima" | "Vencida" | "Aplicada" | "Cancelada";
  notas:                string | null;
  createdAt:            string;
}

export interface CancelarDosisResponse {
  id:     string;
  estado: "Cancelada";
}

/**
 * Un tipo de vacuna que SÍ corresponde a una mascota concreta (RN-PV11).
 *
 * Es lo que consume el combo de "Programar dosis". Qué vacuna aplica es una
 * regla de negocio —sale de `especie_tipo_vacuna`—, no una decisión de
 * presentación: por eso la resuelve el backend y el frontend solo la pinta.
 */
export interface TipoVacunaAplicable {
  id:                    string;
  nombre:                string;
  mesesRefuerzoSugerido: number | null;
}

// ─── Helpers privados ─────────────────────────────────────────────────────────

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** RN-PV1: estadoVisual se deriva del estado persistido + la fecha estimada. */
function deriveEstadoVisual(
  estado: string,
  fechaEstimada: string,
): "Proxima" | "Vencida" | "Aplicada" | "Cancelada" {
  if (estado === "Aplicada")  return "Aplicada";
  if (estado === "Cancelada") return "Cancelada";
  return fechaEstimada >= today() ? "Proxima" : "Vencida";
}

/** Mapea las RAISE EXCEPTION del RPC marcar_dosis_aplicada a DomainError tipado. */
function mapAplicarRpcError(error: { message?: string }): DomainError {
  const msg = error.message ?? "";
  if (msg.includes("VACCINE_PLAN_NOT_FOUND"))
    return new DomainError(ErrorCode.VACCINE_PLAN_NOT_FOUND, 404, "Dosis no encontrada");
  if (msg.includes("VACCINE_PLAN_ALREADY_APPLIED"))
    return new DomainError(ErrorCode.VACCINE_PLAN_ALREADY_APPLIED, 422, "Solo se pueden aplicar dosis en estado Pendiente");
  if (msg.includes("PET_DECEASED"))
    return new DomainError(ErrorCode.PET_DECEASED, 422, "No se pueden aplicar dosis a una mascota fallecida");
  if (msg.includes("FORBIDDEN"))
    return new DomainError(ErrorCode.FORBIDDEN, 403, "El profesional no pertenece a este tenant");
  if (msg.includes("MASCOTA_NOT_FOUND"))
    return new DomainError(ErrorCode.MASCOTA_NOT_FOUND, 404, "Mascota no encontrada en este tenant");
  return new DomainError(ErrorCode.INTERNAL_ERROR, 500, `No se pudo marcar la dosis como aplicada: ${msg}`);
}

/**
 * Mascota + su especie + las vacunas asociadas a esa especie, en UN solo
 * `select`. Es la consulta que responde las dos preguntas del módulo:
 * "¿qué vacunas le puedo poner a este animal?" (el endpoint de aplicables) y
 * "¿esta vacuna le corresponde?" (la guarda RN-PV11 de programarDosis).
 *
 * LAS PISTAS DE EMBED NOMBRAN LA CONSTRAINT, NUNCA LA COLUMNA. Las FKs de
 * `mascotas → especies` y de `especie_tipo_vacuna` hacia sus dos padres son
 * COMPUESTAS sobre (fk_id, tenant_id). Una pista que nombra una columna
 * —`especies!especie_id(...)`— deja de resolver en cuanto la FK es compuesta:
 * PostgREST devuelve PGRST200 y el endpoint responde 500. Ya rompió ocho
 * consultas de este módulo y del historial, y no lo vio ninguna suite unit,
 * porque el mock de supabase-js acepta cualquier string. Se verifica corriendo
 * integración contra una base migrada.
 *
 * PUNTO DE EXTENSIÓN (ver el encabezado de 20260828000001_vacunas_por_especie):
 * hoy la aplicabilidad es sólo por especie. Si algún día aparece una vacuna que
 * depende de la RAZA, se suma una tabla aditiva `raza_tipo_vacuna` y su embed
 * cuelga acá, de `mascotas.raza_id`; la unión de los dos conjuntos se resuelve
 * en `aplicablesDeLaFila()`, unas líneas más abajo. Nada más se toca.
 */
const MASCOTA_CON_VACUNAS_APLICABLES =
  "id, estado, especie_id, " +
  "especie:especies!mascotas_especie_tenant_fkey(" +
    "id, name, " +
    "aplicables:especie_tipo_vacuna!especie_tipo_vacuna_especie_fkey(" +
      "tipo:tipos_vacuna!especie_tipo_vacuna_tipo_fkey(id, nombre, meses_refuerzo_sugerido, active)" +
    ")" +
  ")";

/** El embed a-uno llega como objeto o como arreglo según la versión de supabase-js. */
// deno-lint-ignore no-explicit-any
function unwrapEmbed(valor: any): any {
  if (!valor) return undefined;
  return Array.isArray(valor) ? valor[0] : valor;
}

/**
 * Aplana la fila de `MASCOTA_CON_VACUNAS_APLICABLES` a la lista de vacunas que
 * le corresponden a esa mascota, ya ordenada por nombre.
 *
 * El `active` se filtra acá y no en la consulta a propósito: sobre un embed no
 * inner, un filtro por una columna del nivel más profundo anula el objeto en vez
 * de descartar la fila, y quedarían huecos `null` en la lista. La lista es un
 * catálogo por especie —un puñado de filas—, así que filtrar en memoria no
 * cambia nada de costo y sí quita una fuente de sorpresas.
 */
// deno-lint-ignore no-explicit-any
function aplicablesDeLaFila(fila: any): TipoVacunaAplicable[] {
  const especie = unwrapEmbed(fila?.especie);
  const rel: unknown[] = Array.isArray(especie?.aplicables) ? especie.aplicables : [];

  return rel
    // deno-lint-ignore no-explicit-any
    .map((r: any) => unwrapEmbed(r?.tipo))
    .filter((t) => t && t.active === true)
    // deno-lint-ignore no-explicit-any
    .map((t: any): TipoVacunaAplicable => ({
      id:                    t.id,
      nombre:                t.nombre,
      mesesRefuerzoSugerido: t.meses_refuerzo_sugerido ?? null,
    }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}

// deno-lint-ignore no-explicit-any
function mapDosisRow(row: any): DosisPublica {
  return {
    id:                 row.id,
    petId:              row.pet_id,
    tipoVacunaId:       row.tipo_vacuna_id,
    tipoVacunaNombre:   row.tipo?.nombre ?? null,
    eventoOrigenId:     row.evento_origen_id     ?? null,
    eventoAplicacionId: row.evento_aplicacion_id ?? null,
    fechaEstimada:      row.fecha_estimada,
    estado:             row.estado,
    estadoVisual:       deriveEstadoVisual(row.estado, row.fecha_estimada),
    notas:              row.notas ?? null,
    createdAt:          row.created_at,
  };
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class VacunacionService {
  /**
   * RN-PV1: timeline de dosis ordenado por fecha_estimada ASC.
   * estadoVisual se deriva server-side; no se persiste.
   */
  static async listarPlanVacunacion(
    petId:    string,
    tenantId: string,
    opts:     { page: number; limit: number },
  ): Promise<{ items: DosisPublica[]; total: number }> {
    const db = getServiceDb();

    const { data: mascota } = await db
      .from("mascotas")
      .select("id")
      .eq("id", petId)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (!mascota) {
      throw new DomainError(ErrorCode.MASCOTA_NOT_FOUND, 404, "Mascota no encontrada");
    }

    const from = (opts.page - 1) * opts.limit;
    const to   = from + opts.limit - 1;

    const { data, error, count } = await db
      .from("plan_vacunacion")
      .select("*, tipo:tipos_vacuna!plan_vacunacion_tipo_vacuna_tenant_fkey(nombre)", { count: "exact" })
      .eq("pet_id", petId)
      .eq("tenant_id", tenantId)
      .order("fecha_estimada", { ascending: true })
      .range(from, to);

    if (error) {
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, "Error al consultar plan de vacunación");
    }

    // deno-lint-ignore no-explicit-any
    return { items: (data ?? []).map((r: any) => mapDosisRow(r)), total: count ?? 0 };
  }

  /**
   * Las vacunas que le corresponden a UNA mascota (RN-PV11).
   *
   * Qué vacuna aplica sale de `especie_tipo_vacuna` y es regla de negocio, no
   * presentación: si el frontend armara la unión, cada pantalla podría armarla
   * distinto y la del combo terminaría discrepando con la que valida el POST.
   * Por eso hay endpoint, y por eso `programarDosis` valida contra lo mismo.
   *
   * Una sola consulta: mascota → especie → vacunas asociadas.
   */
  static async tiposVacunaAplicables(
    petId:    string,
    tenantId: string,
  ): Promise<TipoVacunaAplicable[]> {
    const db = getServiceDb();

    const { data: mascota, error } = await db
      .from("mascotas")
      .select(MASCOTA_CON_VACUNAS_APLICABLES)
      .eq("id", petId)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (error) {
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, "Error al consultar las vacunas aplicables");
    }
    if (!mascota) {
      throw new DomainError(ErrorCode.MASCOTA_NOT_FOUND, 404, "Mascota no encontrada");
    }

    return aplicablesDeLaFila(mascota);
  }

  /**
   * Programar una nueva dosis (RN-PV2, RN-PV3, RN-PV4, RN-PV9, RN-PV11).
   * Orden de guardas: MASCOTA_NOT_FOUND → PET_DECEASED → PAST_DATE →
   * VACCINE_TYPE_NOT_FOUND → VACCINE_NOT_APPLICABLE_TO_SPECIES.
   */
  static async programarDosis(
    petId: string,
    dto:   ProgramarDosisDto,
    ctx:   CallerContext,
  ): Promise<DosisPublica> {
    const db = getServiceDb();

    // UNA consulta para todo lo que hay que saber de la mascota: que exista en
    // esta clínica, que no esté fallecida, y qué vacunas le corresponden. Antes
    // eran dos viajes secuenciales (mascota, después catálogo) y validaban
    // menos.
    const { data: mascota } = await db
      .from("mascotas")
      .select(MASCOTA_CON_VACUNAS_APLICABLES)
      .eq("id", petId)
      .eq("tenant_id", ctx.tenantId)
      .maybeSingle();

    if (!mascota) {
      throw new DomainError(ErrorCode.MASCOTA_NOT_FOUND, 404, "Mascota no encontrada");
    }

    // deno-lint-ignore no-explicit-any
    if ((mascota as any).estado === "Fallecida") {
      throw new DomainError(ErrorCode.PET_DECEASED, 422, "No se pueden programar dosis para una mascota fallecida");
    }

    // RN-PV2: fecha_estimada debe ser >= hoy.
    if (dto.fechaEstimada < today()) {
      throw new DomainError(ErrorCode.PAST_DATE, 422, "La fecha estimada no puede ser anterior a hoy");
    }

    // RN-PV3 + RN-PV11 de una sola vez: la lista ya viene filtrada por tenant
    // (la mascota lo está), por especie (viene por la relación) y por `active`.
    // Que el tipo pedido esté ahí es exactamente la condición que hay que
    // cumplir para programar.
    const aplicables = aplicablesDeLaFila(mascota);
    if (!aplicables.some((t) => t.id === dto.tipoVacunaId)) {
      throw await this._porQueNoAplica(db, dto.tipoVacunaId, ctx.tenantId, mascota);
    }

    const payload = {
      tenant_id:        ctx.tenantId,
      pet_id:           petId,
      tipo_vacuna_id:   dto.tipoVacunaId,
      fecha_estimada:   dto.fechaEstimada,
      estado:           "Pendiente",
      notas:            dto.notas            ?? null,
      evento_origen_id: dto.eventoOrigenId   ?? null,
      created_by:       ctx.callerUserId,
    };

    const { data: row, error } = await db
      .from("plan_vacunacion")
      .insert(payload)
      .select("*, tipo:tipos_vacuna!plan_vacunacion_tipo_vacuna_tenant_fkey(nombre)")
      .single();

    if (error || !row) {
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, "Error al registrar la dosis");
    }

    // deno-lint-ignore no-explicit-any
    const dosis = mapDosisRow(row as any);

    await recordAudit(db, {
      tenantId:  ctx.tenantId,
      userId:    ctx.callerUserId,
      userName:  ctx.callerName,
      userRole:  ctx.callerRole,
      module:    "medical_records",
      action:    "CREATE",
      entityId:  dosis.id,
      newValues: payload,
    });

    return dosis;
  }

  /**
   * Elige entre los dos rechazos posibles cuando la vacuna pedida no está en la
   * lista de aplicables: o no existe en el catálogo de la clínica (RN-PV3), o
   * existe pero no corresponde a la especie de la mascota (RN-PV11).
   *
   * Es UNA consulta EXTRA, y sólo la paga el camino que ya está rechazando el
   * pedido: al happy path no le agrega ningún viaje. Distinguir importa porque
   * los dos errores se arreglan distinto — uno cargando la vacuna en el
   * catálogo, el otro asociándola a la especie— y un mensaje único mandaría a
   * la mitad de la gente a buscar donde no es.
   */
  private static async _porQueNoAplica(
    db:           ReturnType<typeof getServiceDb>,
    tipoVacunaId: string,
    tenantId:     string,
    // deno-lint-ignore no-explicit-any
    mascota:      any,
  ): Promise<DomainError> {
    const { data: tipo } = await db
      .from("tipos_vacuna")
      .select("nombre")
      .eq("id", tipoVacunaId)
      .eq("tenant_id", tenantId)
      .eq("active", true)
      .maybeSingle();

    if (!tipo) {
      return new DomainError(ErrorCode.VACCINE_TYPE_NOT_FOUND, 422, "Tipo de vacuna no encontrado en el catálogo");
    }

    const especie = unwrapEmbed(mascota?.especie)?.name ?? "esta especie";
    return new DomainError(
      ErrorCode.VACCINE_NOT_APPLICABLE_TO_SPECIES,
      422,
      // deno-lint-ignore no-explicit-any
      `La vacuna "${(tipo as any).nombre}" no está asociada a ${especie}. Asociala desde el catálogo de tipos de vacuna si corresponde aplicarla.`,
    );
  }

  /**
   * Editar una dosis en estado Pendiente (RN-PV2, RN-PV5, RN-PV9).
   */
  static async editarDosis(
    id:  string,
    dto: EditarDosisDto,
    ctx: CallerContext,
  ): Promise<DosisPublica> {
    const db = getServiceDb();

    const { data: actual } = await db
      .from("plan_vacunacion")
      .select("id, estado, fecha_estimada, notas, tipo_vacuna_id, pet_id, evento_origen_id, evento_aplicacion_id, created_at")
      .eq("id", id)
      .eq("tenant_id", ctx.tenantId)
      .maybeSingle();

    if (!actual) {
      throw new DomainError(ErrorCode.VACCINE_PLAN_NOT_FOUND, 404, "Dosis no encontrada");
    }

    // deno-lint-ignore no-explicit-any
    const a = actual as any;
    if (a.estado !== "Pendiente") {
      throw new DomainError(ErrorCode.VACCINE_PLAN_ALREADY_APPLIED, 422, "Solo se pueden editar dosis en estado Pendiente");
    }

    // RN-PV2: si se envía nueva fecha, no puede ser en el pasado.
    if (dto.fechaEstimada !== undefined && dto.fechaEstimada < today()) {
      throw new DomainError(ErrorCode.PAST_DATE, 422, "La fecha estimada no puede ser anterior a hoy");
    }

    const prevValues = {
      fecha_estimada: a.fecha_estimada,
      notas:          a.notas,
    };

    const updates: Record<string, unknown> = {};
    if (dto.fechaEstimada !== undefined) updates["fecha_estimada"] = dto.fechaEstimada;
    if (dto.notas         !== undefined) updates["notas"]          = dto.notas;

    const { data: row, error } = await db
      .from("plan_vacunacion")
      .update(updates)
      .eq("id", id)
      .eq("tenant_id", ctx.tenantId)
      .select("*, tipo:tipos_vacuna!plan_vacunacion_tipo_vacuna_tenant_fkey(nombre)")
      .single();

    if (error || !row) {
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, "Error al actualizar la dosis");
    }

    // deno-lint-ignore no-explicit-any
    const dosis = mapDosisRow(row as any);

    await recordAudit(db, {
      tenantId:  ctx.tenantId,
      userId:    ctx.callerUserId,
      userName:  ctx.callerName,
      userRole:  ctx.callerRole,
      module:    "medical_records",
      action:    "UPDATE",
      entityId:  id,
      oldValues: prevValues,
      newValues: updates,
    });

    return dosis;
  }

  /**
   * Cancelar una dosis en estado Pendiente (RN-PV5, RN-PV9).
   */
  static async cancelarDosis(
    id:    string,
    notas: string | undefined,
    ctx:   CallerContext,
  ): Promise<CancelarDosisResponse> {
    const db = getServiceDb();

    const { data: actual } = await db
      .from("plan_vacunacion")
      .select("id, estado")
      .eq("id", id)
      .eq("tenant_id", ctx.tenantId)
      .maybeSingle();

    if (!actual) {
      throw new DomainError(ErrorCode.VACCINE_PLAN_NOT_FOUND, 404, "Dosis no encontrada");
    }

    // deno-lint-ignore no-explicit-any
    if ((actual as any).estado !== "Pendiente") {
      throw new DomainError(ErrorCode.VACCINE_PLAN_ALREADY_APPLIED, 422, "Solo se pueden cancelar dosis en estado Pendiente");
    }

    const updates: Record<string, unknown> = { estado: "Cancelada" };
    if (notas !== undefined) updates["notas"] = notas;

    const { data: row, error } = await db
      .from("plan_vacunacion")
      .update(updates)
      .eq("id", id)
      .eq("tenant_id", ctx.tenantId)
      .select("id, estado")
      .single();

    if (error || !row) {
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, "Error al cancelar la dosis");
    }

    await recordAudit(db, {
      tenantId:  ctx.tenantId,
      userId:    ctx.callerUserId,
      userName:  ctx.callerName,
      userRole:  ctx.callerRole,
      module:    "medical_records",
      action:    "UPDATE",
      entityId:  id,
      oldValues: { estado: "Pendiente" },
      newValues: { estado: "Cancelada" },
    });

    // deno-lint-ignore no-explicit-any
    return { id: (row as any).id, estado: "Cancelada" };
  }

  /**
   * Marcar una dosis Pendiente como Aplicada (RN-PV5, RN-PV9). Transacción
   * plan+evento ATÓMICA dentro del RPC marcar_dosis_aplicada (igual que la
   * eutanasia): crea el evento clínico 'Vacunación', enlaza la dosis y asienta
   * la auditoría en una sola transacción. El Service sólo orquesta y mapea.
   * Guardas en el RPC: VACCINE_PLAN_NOT_FOUND → ALREADY_APPLIED → PET_DECEASED → FORBIDDEN.
   */
  static async marcarDosisAplicada(
    id:  string,
    dto: MarcarAplicadaDto,
    ctx: CallerContext,
  ): Promise<DosisPublica> {
    const fecha = dto.date ?? today();

    // La aplicación ya ocurrió: la fecha no puede ser futura. Se usa
    // VALIDATION_ERROR para no inventar un código nuevo.
    if (fecha > today()) {
      throw new DomainError(ErrorCode.VALIDATION_ERROR, 422, "La fecha de aplicación no puede ser futura");
    }

    const db = getServiceDb();

    // RN-HOR8: un profesional dado de baja no firma la aplicación de una dosis
    // (el RPC crea a su nombre un evento clínico 'Vacunación'). Se valida antes
    // del RPC para no abrir la transacción y tener que abortarla.
    await assertProfesionalAsignable(db, ctx.tenantId, dto.professionalId);

    const { error } = await db
      .rpc("marcar_dosis_aplicada", {
        p_tenant_id:       ctx.tenantId,
        p_dosis_id:        id,
        p_professional_id: dto.professionalId,
        p_user_id:         ctx.callerUserId,
        p_date:            fecha,
        p_weight_kg:       dto.weightKg     ?? null,
        p_temperature_c:   dto.temperatureC ?? null,
        p_notes:           dto.notes        ?? null,
      })
      .single();

    if (error) throw mapAplicarRpcError(error as { message?: string });

    // Relectura single-row (no N+1) para devolver el DTO completo con el nombre
    // de la vacuna embebido y estadoVisual derivado.
    const { data: row, error: readErr } = await db
      .from("plan_vacunacion")
      .select("*, tipo:tipos_vacuna!plan_vacunacion_tipo_vacuna_tenant_fkey(nombre)")
      .eq("id", id)
      .eq("tenant_id", ctx.tenantId)
      .single();

    if (readErr || !row) {
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, "Error al releer la dosis aplicada");
    }

    // deno-lint-ignore no-explicit-any
    return mapDosisRow(row as any);
  }
}
