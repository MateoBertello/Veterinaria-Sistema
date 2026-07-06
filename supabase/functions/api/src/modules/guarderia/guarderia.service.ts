import { DomainError, ErrorCode } from "../../shared/errors.ts";
import { recordAudit } from "../../shared/audit.ts";
import { getServiceDb } from "../../shared/db.ts";
import { ConfiguracionService } from "../configuracion/configuracion.service.ts";
import {
  CrearEstadiaSchema,
  type CrearEstadiaDto,
  type ModificarEstadiaDto,
} from "./guarderia.schemas.ts";

// ─── DTOs públicos ────────────────────────────────────────────────────────────

/** Contexto del usuario autenticado (mismo shape que el resto de los services). */
export interface CallerContext {
  tenantId:     string;
  callerUserId: string;
  callerName:   string;
  callerRole:   string;
}

export interface EstadiaPublica {
  id:            string;
  clientId:      string;
  petId:         string;
  checkInDate:   string;
  checkOutDate:  string;
  status:        string;          // siempre 'Reservada' al crear (RN-GU5)
  reason:        string;
  notes:         string | null;
  createdAt:     string;
  checkedInAt:   string | null;    // marca de check-in (RN-CK2); null si aún Reservada
  checkedOutAt:  string | null;    // marca de check-out (RN-CK3); null si aún no finalizada
  // Tarjeta de mascota (Addendum v1.1 pantalla 3): tamaño + dieta + dueño.
  petName:       string;
  petTamano:     string;
  petDieta:      string | null;
  clientName:    string;
}

/** Respuesta de cancelación (shape del spec v1.0 §5). */
export interface CancelResponse {
  id:          string;
  status:      string;
  cancelledAt: string;
}

/** Respuesta de check-in (RN-CK2). */
export interface CheckinResponse {
  id:          string;
  status:      string;
  checkedInAt: string;
}

/** Respuesta de check-out (RN-CK3). */
export interface CheckoutResponse {
  id:           string;
  status:       string;
  checkedOutAt: string;
}

/** Ocupación de un día dentro del rango consultado (GET /estadias/cupo). */
export interface CupoDia {
  date:        string;
  ocupados:    number;
  cupo:        number;
  disponible:  number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Lista de fechas "YYYY-MM-DD" en el rango inclusivo [from, to]. */
function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  // Mediodía UTC para evitar corrimientos por DST al iterar por días.
  const cur = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  while (cur <= end) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

/**
 * Mapea los errores de los RPCs de guardería a DomainError. Cubre todos los
 * casos de crear, modificar y cancelar. Para el cupo, el mensaje es
 * `CUPO_GUARDERIA_AGOTADO:<json de días>`; se parsean los días para poblar
 * `details` (RN-GU4 / RN-ME2).
 */
function mapEstadiaRpcError(error: { message?: string }, fallbackMsg = "operación de estadía"): DomainError {
  const msg = error.message ?? "";

  if (msg.includes("CUPO_GUARDERIA_AGOTADO")) {
    let dias: unknown[] = [];
    const colon = msg.indexOf(":", msg.indexOf("CUPO_GUARDERIA_AGOTADO"));
    if (colon !== -1) {
      try {
        const parsed = JSON.parse(msg.slice(colon + 1));
        if (Array.isArray(parsed)) dias = parsed;
      } catch {
        // Si no se pudo parsear, se devuelve sin detalle de días.
      }
    }
    return new DomainError(
      ErrorCode.CUPO_GUARDERIA_AGOTADO,
      409,
      "No hay cupo de guardería disponible en los días seleccionados",
      dias,
    );
  }
  if (msg.includes("INVALID_TRANSITION"))
    return new DomainError(ErrorCode.INVALID_TRANSITION, 422, "La transición de estado no es válida para la estadía en su estado actual");
  if (msg.includes("STAY_LOCKED"))
    return new DomainError(ErrorCode.STAY_LOCKED, 422, "La estadía no puede modificarse en su estado actual");
  if (msg.includes("ESTADIA_NOT_FOUND"))
    return new DomainError(ErrorCode.ESTADIA_NOT_FOUND, 404, "Estadía no encontrada");
  if (msg.includes("STAY_OVERLAP"))
    return new DomainError(ErrorCode.STAY_OVERLAP, 409, "La mascota ya tiene una estadía que se superpone con ese rango");
  if (msg.includes("PET_DECEASED"))
    return new DomainError(ErrorCode.PET_DECEASED, 422, "No se puede registrar una estadía para una mascota fallecida");
  if (msg.includes("MASCOTA_NOT_FOUND"))
    return new DomainError(ErrorCode.MASCOTA_NOT_FOUND, 404, "Mascota no encontrada en este tenant");
  if (msg.includes("CONFIG_NOT_FOUND"))
    return new DomainError(ErrorCode.CONFIG_NOT_FOUND, 404, "Configuración de la clínica no encontrada. Contacte a soporte.");
  return new DomainError(ErrorCode.INTERNAL_ERROR, 500, `No se pudo completar la ${fallbackMsg}: ${msg}`);
}

function toPublic(row: Record<string, unknown>): EstadiaPublica {
  return {
    id:           row["id"]             as string,
    clientId:     row["client_id"]      as string,
    petId:        row["pet_id"]         as string,
    checkInDate:  row["check_in_date"]  as string,
    checkOutDate: row["check_out_date"] as string,
    status:       row["status"]         as string,
    reason:       row["reason"]         as string,
    notes:        (row["notes"]         as string | null) ?? null,
    createdAt:    row["created_at"]     as string,
    checkedInAt:  (row["checked_in_at"]  as string | null) ?? null,
    checkedOutAt: (row["checked_out_at"] as string | null) ?? null,
    petName:      row["pet_name"]       as string,
    petTamano:    row["pet_tamano"]     as string,
    petDieta:     (row["pet_dieta"]     as string | null) ?? null,
    clientName:   row["client_name"]    as string,
  };
}

/**
 * Mapea una fila del listado (GET /estadias) donde la mascota y el cliente vienen
 * embebidos por PostgREST (`mascota:mascotas(...)`, `cliente:clientes(...)`), a
 * `EstadiaPublica`. A diferencia de `toPublic` (que consume el shape plano de los
 * RPCs), acá los datos de la tarjeta llegan anidados.
 */
function toPublicFromEmbed(row: Record<string, unknown>): EstadiaPublica {
  const mascota = (row["mascota"] ?? {}) as Record<string, unknown>;
  const cliente = (row["cliente"] ?? {}) as Record<string, unknown>;
  return {
    id:           row["id"]             as string,
    clientId:     row["client_id"]      as string,
    petId:        row["pet_id"]         as string,
    checkInDate:  row["check_in_date"]  as string,
    checkOutDate: row["check_out_date"] as string,
    status:       row["status"]         as string,
    reason:       row["reason"]         as string,
    notes:        (row["notes"]         as string | null) ?? null,
    createdAt:    row["created_at"]     as string,
    checkedInAt:  (row["checked_in_at"]  as string | null) ?? null,
    checkedOutAt: (row["checked_out_at"] as string | null) ?? null,
    petName:      mascota["name"]           as string,
    petTamano:    mascota["tamano"]         as string,
    petDieta:     (mascota["alimento_dieta"] as string | null) ?? null,
    clientName:   cliente["full_name"]      as string,
  };
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class EstadiaService {
  /**
   * Registrar Estadía (RN-GU1..GU5, RN-GU7).
   *
   * RN-GU1 (rango / fecha pasada) se valida acá con códigos específicos.
   * RN-GU2 (solape), RN-GU3 (mascota válida) y RN-GU4 (cupo) se delegan al RPC
   * `crear_estadia_con_cupo`, que resuelve el cupo con una guarda atómica por
   * tenant (FOR UPDATE sobre configuracion_tenant) — ver la migración: el cupo
   * NO se chequea-antes-de-insertar en el Service para evitar la ventana de
   * carrera que produciría overbooking.
   */
  static async crear(dto: CrearEstadiaDto, ctx: CallerContext): Promise<EstadiaPublica> {
    // Defensa en profundidad: el Controller ya validó el formato con Zod.
    const parsed = CrearEstadiaSchema.safeParse(dto);
    if (!parsed.success) {
      throw new DomainError(
        ErrorCode.VALIDATION_ERROR,
        422,
        "Datos de la estadía inválidos",
        parsed.error.issues,
      );
    }
    const data = parsed.data;

    // RN-GU1: rango válido (egreso ≥ ingreso) e ingreso no anterior a hoy.
    if (data.checkOutDate < data.checkInDate) {
      throw new DomainError(
        ErrorCode.INVALID_RANGE,
        422,
        "La fecha de egreso debe ser posterior o igual a la de ingreso",
      );
    }
    if (data.checkInDate < today()) {
      throw new DomainError(
        ErrorCode.PAST_DATE,
        422,
        "La fecha de ingreso no puede ser anterior a hoy",
      );
    }

    const db = getServiceDb();

    // RN-GU2/GU3/GU4: transacción con guarda de cupo. p_tenant_id SIEMPRE del JWT.
    const { data: row, error } = await db
      .rpc("crear_estadia_con_cupo", {
        p_tenant_id: ctx.tenantId,
        p_client_id: data.clientId,
        p_pet_id:    data.petId,
        p_check_in:  data.checkInDate,
        p_check_out: data.checkOutDate,
        p_reason:    data.reason,
        p_notes:     data.notes ?? null,
      })
      .single();

    if (error) throw mapEstadiaRpcError(error, "registro de estadía");
    if (!row) {
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, "El RPC de estadía no devolvió resultado");
    }

    const estadia = toPublic(row as unknown as Record<string, unknown>);

    // RN-GU7: auditoría CREATE en módulo daycare.
    await recordAudit(db as never, {
      tenantId:  ctx.tenantId,
      userId:    ctx.callerUserId,
      userName:  ctx.callerName,
      userRole:  ctx.callerRole,
      action:    "CREATE",
      module:    "daycare",
      entityId:  estadia.id,
      newValues: {
        clientId:     estadia.clientId,
        petId:        estadia.petId,
        checkInDate:  estadia.checkInDate,
        checkOutDate: estadia.checkOutDate,
        status:       estadia.status,
        reason:       estadia.reason,
      },
    });

    return estadia;
  }

  /**
   * Modificar Estadía (RN-ME1..ME2, ME5-ME6).
   *
   * El controller pre-rellena los valores vigentes antes de llamar a este método,
   * por lo que los cuatro campos de contenido siempre llegan completos (el RPC
   * los requiere NOT NULL). La revalidación de cupo en los nuevos días y la
   * detección de solape ocurren de forma atómica en el RPC `modificar_estadia_con_cupo`,
   * que reutiliza el mismo mutex FOR UPDATE de 7a para evitar overbooking.
   */
  static async actualizar(
    id:  string,
    dto: Required<Pick<ModificarEstadiaDto, "checkInDate" | "checkOutDate" | "reason">> & { notes: string | null },
    ctx: CallerContext,
  ): Promise<EstadiaPublica> {
    // Defensa en profundidad: misma validación de rango que en crear (RN-ME2/GU1).
    if (dto.checkOutDate < dto.checkInDate) {
      throw new DomainError(ErrorCode.INVALID_RANGE, 422, "La fecha de egreso debe ser posterior o igual a la de ingreso");
    }
    if (dto.checkInDate < today()) {
      throw new DomainError(ErrorCode.PAST_DATE, 422, "La fecha de ingreso no puede ser anterior a hoy");
    }

    const db = getServiceDb();

    const { data: row, error } = await db
      .rpc("modificar_estadia_con_cupo", {
        p_tenant_id:  ctx.tenantId,
        p_estadia_id: id,
        p_check_in:   dto.checkInDate,
        p_check_out:  dto.checkOutDate,
        p_reason:     dto.reason,
        p_notes:      dto.notes ?? null,
      })
      .single();

    if (error) throw mapEstadiaRpcError(error, "modificación de estadía");
    if (!row) throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, "El RPC de modificación no devolvió resultado");

    const estadia = toPublic(row as unknown as Record<string, unknown>);

    await recordAudit(db as never, {
      tenantId:  ctx.tenantId,
      userId:    ctx.callerUserId,
      userName:  ctx.callerName,
      userRole:  ctx.callerRole,
      action:    "UPDATE",
      module:    "daycare",
      entityId:  estadia.id,
      newValues: {
        checkInDate:  estadia.checkInDate,
        checkOutDate: estadia.checkOutDate,
        reason:       estadia.reason,
        notes:        estadia.notes,
      },
    });

    return estadia;
  }

  /**
   * Cancelar Estadía (RN-ME1, ME3, ME5-ME6).
   *
   * No requiere guarda de cupo: marcar como Cancelada libera la ocupación de esos
   * días automáticamente (el conteo solo incluye Reservada/EnCurso). La validación
   * de estado y la actualización ocurren de forma atómica en el RPC `cancelar_estadia`.
   */
  static async cancelar(id: string, motivo: string, ctx: CallerContext): Promise<CancelResponse> {
    const db = getServiceDb();

    const { data: row, error } = await db
      .rpc("cancelar_estadia", {
        p_tenant_id:           ctx.tenantId,
        p_estadia_id:          id,
        p_cancellation_reason: motivo,
      })
      .single();

    if (error) throw mapEstadiaRpcError(error, "cancelación de estadía");
    if (!row) throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, "El RPC de cancelación no devolvió resultado");

    const r = row as unknown as Record<string, unknown>;
    const result: CancelResponse = {
      id:          r["id"]           as string,
      status:      r["status"]       as string,
      cancelledAt: r["cancelled_at"] as string,
    };

    await recordAudit(db as never, {
      tenantId:  ctx.tenantId,
      userId:    ctx.callerUserId,
      userName:  ctx.callerName,
      userRole:  ctx.callerRole,
      action:    "UPDATE",
      module:    "daycare",
      entityId:  result.id,
      newValues: { status: "Cancelada", cancellationReason: motivo },
    });

    return result;
  }

  /**
   * Check-in de Estadía (RN-CK1, CK2, CK4, CK6).
   *
   * Transición válida: Reservada → EnCurso. Cualquier otro estado origen →
   * INVALID_TRANSITION (422). El RPC `hacer_checkin` valida el estado y registra
   * checked_in_at de forma atómica (FOR UPDATE sobre la fila de la estadía).
   */
  static async checkin(id: string, ctx: CallerContext): Promise<CheckinResponse> {
    const db = getServiceDb();

    const { data: row, error } = await db
      .rpc("hacer_checkin", {
        p_tenant_id:  ctx.tenantId,
        p_estadia_id: id,
      })
      .single();

    if (error) throw mapEstadiaRpcError(error, "check-in de estadía");
    if (!row) throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, "El RPC de check-in no devolvió resultado");

    const r = row as unknown as Record<string, unknown>;
    const result: CheckinResponse = {
      id:          r["id"]            as string,
      status:      r["status"]        as string,
      checkedInAt: r["checked_in_at"] as string,
    };

    await recordAudit(db as never, {
      tenantId:  ctx.tenantId,
      userId:    ctx.callerUserId,
      userName:  ctx.callerName,
      userRole:  ctx.callerRole,
      action:    "UPDATE",
      module:    "daycare",
      entityId:  result.id,
      newValues: { status: "EnCurso", checkedInAt: result.checkedInAt },
    });

    return result;
  }

  /**
   * Check-out de Estadía (RN-CK1, CK3, CK4, CK6).
   *
   * Transición válida: EnCurso → Finalizada. Cualquier otro estado origen →
   * INVALID_TRANSITION (422). Al pasar a Finalizada el cupo se libera de forma
   * implícita: el conteo de cupo filtra solo Reservada/EnCurso. El RPC
   * `hacer_checkout` valida el estado y registra checked_out_at atómicamente.
   */
  static async checkout(id: string, ctx: CallerContext): Promise<CheckoutResponse> {
    const db = getServiceDb();

    const { data: row, error } = await db
      .rpc("hacer_checkout", {
        p_tenant_id:  ctx.tenantId,
        p_estadia_id: id,
      })
      .single();

    if (error) throw mapEstadiaRpcError(error, "check-out de estadía");
    if (!row) throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, "El RPC de check-out no devolvió resultado");

    const r = row as unknown as Record<string, unknown>;
    const result: CheckoutResponse = {
      id:           r["id"]             as string,
      status:       r["status"]         as string,
      checkedOutAt: r["checked_out_at"] as string,
    };

    await recordAudit(db as never, {
      tenantId:  ctx.tenantId,
      userId:    ctx.callerUserId,
      userName:  ctx.callerName,
      userRole:  ctx.callerRole,
      action:    "UPDATE",
      module:    "daycare",
      entityId:  result.id,
      newValues: { status: "Finalizada", checkedOutAt: result.checkedOutAt },
    });

    return result;
  }

  /**
   * Listado de estadías que ocupan un día dado (GET /estadias?date=).
   *
   * Devuelve las estadías cuya ventana [check_in, check_out] contiene `date`
   * (inclusive), en estados que ocupan o cerraron ese día (Reservada/EnCurso/
   * Finalizada); Cancelada se excluye. Alimenta la vista de ocupación y las
   * acciones de check-in/out.
   *
   * Sin N+1 (CLAUDE.md): UNA sola query con resource embedding trae la tarjeta de
   * mascota (nombre/tamaño/dieta) y el dueño. El aislamiento por tenant lo garantiza
   * el filtro `tenant_id` del Service (getServiceDb usa service_role y no aplica RLS).
   */
  static async listar(date: string, ctx: CallerContext): Promise<EstadiaPublica[]> {
    return await EstadiaService.queryOverlap(date, date, ctx);
  }

  /**
   * Estadías que solapan el rango [dateFrom, dateTo] (GET /estadias?dateFrom=&dateTo=).
   * Alimenta la vista de ocupación mensual: una sola query trae todas las estadías
   * del mes visible y el cliente las agrupa por día (sin N+1).
   */
  static async listarRango(dateFrom: string, dateTo: string, ctx: CallerContext): Promise<EstadiaPublica[]> {
    return await EstadiaService.queryOverlap(dateFrom, dateTo, ctx);
  }

  /**
   * Query base de solape (una sola consulta con embed). Una estadía solapa el rango
   * [from, to] si `check_in_date <= to AND check_out_date >= from` (inclusivo ⇒ una
   * estadía Lun→Vie aparece los 5 días; mismo criterio que `cupo`). Excluye Cancelada.
   * El aislamiento por tenant lo garantiza el filtro `tenant_id` (getServiceDb no aplica RLS).
   */
  private static async queryOverlap(from: string, to: string, ctx: CallerContext): Promise<EstadiaPublica[]> {
    const db = getServiceDb();

    const { data, error } = await db
      .from("estadias")
      .select(
        "id, client_id, pet_id, check_in_date, check_out_date, status, reason, notes, " +
          "checked_in_at, checked_out_at, created_at, " +
          "mascota:mascotas(name, tamano, alimento_dieta), cliente:clientes(full_name)",
      )
      .eq("tenant_id", ctx.tenantId)
      .in("status", ["Reservada", "EnCurso", "Finalizada"])
      .lte("check_in_date", to)
      .gte("check_out_date", from)
      .order("check_in_date", { ascending: true });

    if (error) {
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, "Error al consultar las estadías");
    }

    return ((data ?? []) as unknown as Array<Record<string, unknown>>).map(toPublicFromEmbed);
  }

  /**
   * Ocupación vs. cupo por día en el rango [dateFrom, dateTo] (GET /estadias/cupo).
   * Sin N+1: UNA sola query trae las estadías activas que solapan el rango y la
   * ocupación por día se agrega en memoria (no se consulta por día). El cupo
   * vigente se lee de la configuración del tenant (RN-CF3, sin caché).
   */
  static async cupo(
    dateFrom: string,
    dateTo:   string,
    ctx:      CallerContext,
  ): Promise<CupoDia[]> {
    const cupo = (await ConfiguracionService.valor(ctx.tenantId, "cupoMaximoDiario")) as number;

    const db = getServiceDb();

    // Estadías activas que solapan el rango: check_in ≤ dateTo AND check_out ≥ dateFrom.
    const { data, error } = await db
      .from("estadias")
      .select("check_in_date, check_out_date")
      .eq("tenant_id", ctx.tenantId)
      .in("status", ["Reservada", "EnCurso"])
      .lte("check_in_date", dateTo)
      .gte("check_out_date", dateFrom);

    if (error) {
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, "Error al consultar la ocupación de guardería");
    }

    const rows = (data ?? []) as Array<{ check_in_date: string; check_out_date: string }>;

    return eachDay(dateFrom, dateTo).map((date) => {
      // Rango inclusivo '[]': el día cuenta si check_in ≤ date ≤ check_out.
      const ocupados = rows.filter(
        (r) => r.check_in_date <= date && date <= r.check_out_date,
      ).length;
      return {
        date,
        ocupados,
        cupo,
        disponible: Math.max(0, cupo - ocupados),
      };
    });
  }
}
