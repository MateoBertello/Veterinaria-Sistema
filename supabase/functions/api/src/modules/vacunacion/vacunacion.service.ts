import { DomainError, ErrorCode } from "../../shared/errors.ts";
import { recordAudit } from "../../shared/audit.ts";
import { getServiceDb } from "../../shared/db.ts";
import type { ProgramarDosisDto, EditarDosisDto } from "./vacunacion.schemas.ts";

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
      .select("*, tipo:tipos_vacuna!tipo_vacuna_id(nombre)", { count: "exact" })
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
   * Programar una nueva dosis (RN-PV2, RN-PV3, RN-PV4, RN-PV9).
   * Orden de guardas: MASCOTA_NOT_FOUND → PET_DECEASED → PAST_DATE → VACCINE_TYPE_NOT_FOUND.
   */
  static async programarDosis(
    petId: string,
    dto:   ProgramarDosisDto,
    ctx:   CallerContext,
  ): Promise<DosisPublica> {
    const db = getServiceDb();

    const { data: mascota } = await db
      .from("mascotas")
      .select("id, estado")
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

    // RN-PV3: tipo de vacuna debe existir en el catálogo global (y estar activo).
    const { data: tipoVacuna } = await db
      .from("tipos_vacuna")
      .select("id")
      .eq("id", dto.tipoVacunaId)
      .eq("active", true)
      .maybeSingle();

    if (!tipoVacuna) {
      throw new DomainError(ErrorCode.VACCINE_TYPE_NOT_FOUND, 422, "Tipo de vacuna no encontrado en el catálogo");
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
      .select("*, tipo:tipos_vacuna!tipo_vacuna_id(nombre)")
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
      .select("*, tipo:tipos_vacuna!tipo_vacuna_id(nombre)")
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
}
