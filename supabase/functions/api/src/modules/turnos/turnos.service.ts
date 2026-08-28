import { DomainError, ErrorCode } from "../../shared/errors.ts";
import { recordAudit } from "../../shared/audit.ts";
import { getServiceDb } from "../../shared/db.ts";
import {
  CrearTurnoSchema,
  type CrearTurnoDto,
  type ModificarTurnoDto,
  type CancelarTurnoDto,
  type CambiarEstadoDto,
} from "./turnos.schemas.ts";

// ─── Tipos públicos ───────────────────────────────────────────────────────────

export interface CallerContext {
  tenantId:     string;
  callerUserId: string;
  callerName:   string;
  callerRole:   string;
}

export interface TurnoPublico {
  id:                  string;
  date:                string;
  startTime:           string; // "HH:MM"
  endTime:             string; // "HH:MM"
  status:              string;
  reason:              string;
  notes:               string | null;
  cancellationReason:  string | null;
  cancelledAt:         string | null;
  servicio:            { id: string; nombre: string; tipo: string; duracionMinutos: number } | null;
  doctor:              { id: string; name: string } | null;
  mascota:             { id: string; name: string } | null;
  cliente:             { id: string; fullName: string } | null;
  accionesDisponibles: string[];
}

/** Estados terminales del ciclo de vida (RN-ES3). */
const ESTADOS_TERMINALES = new Set(["Completado", "Cancelado"]);

/** Transiciones de estado válidas (RN-ES1). */
const TRANSICIONES_VALIDAS: Record<string, string[]> = {
  Programado:  ["Confirmado"],
  Confirmado:  ["Completado"],
  Completado:  [],
  Cancelado:   [],
};

export interface SlotDisponible {
  startTime: string; // "HH:MM"
  endTime:   string; // "HH:MM"
}

// Embed para resolver servicio + doctor + mascota + cliente en UNA consulta (sin N+1).
const TURNO_SELECT =
  "id, date, start_time, end_time, status, reason, notes, cancellation_reason, cancelled_at, " +
  "servicio:servicios(id, nombre, tipo, duracion_minutos), " +
  "doctor:doctores(id, name), " +
  "mascota:mascotas(id, name), " +
  "cliente:clientes(id, full_name)";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Normaliza un TIME ("HH:MM" o "HH:MM:SS") a "HH:MM". */
function fmtHHMM(t: string): string {
  return t.slice(0, 5);
}

/** Minutos desde medianoche de una hora "HH:MM[:SS]". */
function toMinutes(t: string): number {
  const [h, m] = t.split(":");
  return Number(h) * 60 + Number(m);
}

/** Convierte minutos desde medianoche a "HH:MM". */
function fromMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Dos intervalos [s1,e1) y [s2,e2) (en minutos) se solapan. */
function seSolapan(s1: number, e1: number, s2: number, e2: number): boolean {
  return s1 < e2 && s2 < e1;
}

/** Día de la semana (0=Dom … 6=Sáb) de una fecha "YYYY-MM-DD", en UTC para evitar drift. */
function diaSemana(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/**
 * Fecha ("YYYY-MM-DD") y hora ("minutos desde medianoche") de "ahora", en UTC.
 *
 * El sistema no tiene zona horaria de clínica configurada: `vacunacion.service.ts`
 * (`today()`) y `web/src/components/turnos/fechas.ts` ya usan UTC de punta a punta
 * ("Todo en UTC para evitar corrimientos por zona horaria"). Se sigue el mismo
 * criterio acá para que frontend y backend coincidan en qué es "hoy"/"ahora"; si
 * la clínica opera en otra zona, es una decisión de producto pendiente, no algo
 * para inventar en este Service.
 */
function ahoraUTC(): { fecha: string; horaMin: number } {
  const iso = new Date().toISOString(); // "YYYY-MM-DDTHH:MM:SS.sssZ"
  return { fecha: iso.slice(0, 10), horaMin: toMinutes(iso.slice(11, 16)) };
}

/**
 * RN-TU1: no se agenda ni se reprograma a una fecha/hora ya pasada. Compartida por
 * `crearTurno` y `modificarTurno` para que la regla no vuelva a divergir entre las
 * dos rutas (el bug original: solo se comparaba la fecha, nunca la hora).
 */
function assertFechaHoraFutura(date: string, startTime: string, mensaje: string): void {
  const { fecha: hoy, horaMin: ahoraMin } = ahoraUTC();
  if (date < hoy || (date === hoy && toMinutes(startTime) <= ahoraMin)) {
    throw new DomainError(ErrorCode.PAST_DATE, 422, mensaje);
  }
}

function unwrapEmbed<T>(v: unknown): T | null {
  // PostgREST devuelve el embed como objeto o como array de un elemento según la relación.
  if (Array.isArray(v)) return (v[0] as T) ?? null;
  return (v as T) ?? null;
}

function toPublic(row: Record<string, unknown>, accionesDisponibles: string[] = []): TurnoPublico {
  const svc = unwrapEmbed<Record<string, unknown>>(row["servicio"]);
  const doc = unwrapEmbed<Record<string, unknown>>(row["doctor"]);
  const pet = unwrapEmbed<Record<string, unknown>>(row["mascota"]);
  const cli = unwrapEmbed<Record<string, unknown>>(row["cliente"]);

  return {
    id:                 row["id"]         as string,
    date:               row["date"]       as string,
    startTime:          fmtHHMM(row["start_time"] as string),
    endTime:            fmtHHMM(row["end_time"]   as string),
    status:             row["status"]     as string,
    reason:             row["reason"]     as string,
    notes:              (row["notes"]     as string | null) ?? null,
    cancellationReason: (row["cancellation_reason"] as string | null) ?? null,
    cancelledAt:        (row["cancelled_at"]        as string | null) ?? null,
    servicio:  svc
      ? {
          id:              svc["id"]               as string,
          nombre:          svc["nombre"]           as string,
          tipo:            svc["tipo"]             as string,
          duracionMinutos: svc["duracion_minutos"] as number,
        }
      : null,
    doctor:              doc ? { id: doc["id"] as string, name: doc["name"] as string } : null,
    mascota:             pet ? { id: pet["id"] as string, name: pet["name"] as string } : null,
    cliente:             cli ? { id: cli["id"] as string, fullName: cli["full_name"] as string } : null,
    accionesDisponibles,
  };
}

// ─── TurnoService ──────────────────────────────────────────────────────────────

export const TurnoService = {
  /**
   * Agendar Turno (RN-TU1, RN-TU3, RN-TU4, RN-TU5, RN-TU6, RN-TU8, RN-TU9, RN-TU10).
   *
   * - RN-TU9: servicio activo del tenant; `endTime` se calcula server-side
   *   (start + duración) — el cliente no lo envía.
   * - RN-TU10: si el servicio `requiere_profesional`, `doctorId` es obligatorio.
   * - RN-TU2: si hay doctor, el bloque debe caber en una franja activa del día.
   * - RN-TU3/TU4: la verdad sobre solapamiento/duplicado la dicta la base
   *   (constraint EXCLUDE `excl_turnos_solapados` + UNIQUE); se mapea el error
   *   de Postgres a TURNO_SOLAPADO / DUPLICATE_APPOINTMENT (sin pre-check: evita
   *   condiciones de carrera TOCTOU).
   */
  async crearTurno(dto: CrearTurnoDto, ctx: CallerContext): Promise<TurnoPublico> {
    const parsed = CrearTurnoSchema.safeParse(dto);
    if (!parsed.success) {
      throw new DomainError(
        ErrorCode.VALIDATION_ERROR,
        422,
        "Datos del turno inválidos",
        parsed.error.issues,
      );
    }
    const data = parsed.data;
    const db = getServiceDb();

    // RN-TU9: servicio activo del tenant; resuelve la duración server-side.
    const { data: servicio } = await db
      .from("servicios")
      .select("id, duracion_minutos, requiere_profesional, activo")
      .eq("id", data.servicioId)
      .eq("tenant_id", ctx.tenantId)
      .maybeSingle();

    const svc = servicio as unknown as Record<string, unknown> | null;
    if (!svc || svc["activo"] !== true) {
      throw new DomainError(
        ErrorCode.SERVICE_NOT_FOUND,
        422,
        "El servicio no existe o no está activo en este tenant",
      );
    }

    // RN-TU10: doctor obligatorio si el servicio lo requiere (RN-SV4).
    if (svc["requiere_profesional"] === true && !data.doctorId) {
      throw new DomainError(
        ErrorCode.VALIDATION_ERROR,
        422,
        "Este servicio requiere seleccionar un profesional",
        [{ field: "doctorId", message: "doctorId es obligatorio para este servicio" }],
      );
    }

    // RN-TU1: no se agenda en fecha/hora ya pasada.
    assertFechaHoraFutura(data.date, data.startTime, "No se puede agendar en una fecha u hora ya pasada");

    // RN-TU6: la mascota debe existir en el tenant y estar viva (estado='Activa').
    const { data: mascota } = await db
      .from("mascotas")
      .select("id, estado")
      .eq("id", data.petId)
      .eq("tenant_id", ctx.tenantId)
      .maybeSingle();

    const pet = mascota as unknown as Record<string, unknown> | null;
    if (!pet) {
      throw new DomainError(ErrorCode.MASCOTA_NOT_FOUND, 404, "Mascota no encontrada en este tenant");
    }
    if (pet["estado"] !== "Activa") {
      throw new DomainError(
        ErrorCode.PET_DECEASED,
        409,
        "No se puede agendar un turno para una mascota fallecida",
      );
    }

    // endTime server-side (RN-TU9): start + duración del servicio.
    const duracion = svc["duracion_minutos"] as number;
    const inicioMin = toMinutes(data.startTime);
    const finMin    = inicioMin + duracion;
    if (finMin > 24 * 60) {
      throw new DomainError(
        ErrorCode.VALIDATION_ERROR,
        422,
        "La duración del servicio excede el final del día",
      );
    }
    const endTime = fromMinutes(finMin);

    // RN-TU2: si hay doctor, el bloque [start, end) debe caber en una franja activa.
    if (data.doctorId) {
      await this._assertBloqueEnFranja(db, ctx.tenantId, data.doctorId, data.date, inicioMin, finMin);
    }

    const payload = {
      tenant_id:   ctx.tenantId, // RN-TU: tenant siempre del JWT
      client_id:   data.clientId,
      pet_id:      data.petId,
      servicio_id: data.servicioId,
      doctor_id:   data.doctorId ?? null,
      date:        data.date,
      start_time:  data.startTime,
      end_time:    endTime,
      status:      "Confirmado", // RN-TU5: auto-confirmación
      reason:      data.reason,
      notes:       data.notes ?? null,
    };

    const { data: row, error } = await db
      .from("turnos")
      .insert(payload)
      .select(TURNO_SELECT)
      .single();

    if (error || !row) {
      // RN-TU3: solapamiento del mismo profesional (constraint EXCLUDE).
      if (error?.code === "23P01") {
        throw new DomainError(
          ErrorCode.TURNO_SOLAPADO,
          409,
          "El profesional ya tiene un turno que se solapa con este horario",
        );
      }
      // RN-TU4: duplicado exacto cliente+mascota+fecha+hora (constraint UNIQUE).
      if (error?.code === "23505") {
        throw new DomainError(
          ErrorCode.DUPLICATE_APPOINTMENT,
          409,
          "Ya existe un turno para esta mascota en la misma fecha y horario",
        );
      }
      throw new DomainError(
        ErrorCode.INTERNAL_ERROR,
        500,
        `No se pudo agendar el turno: ${error?.message ?? ""}`,
      );
    }

    // RN-TU8: auditoría CREATE en módulo appointments.
    await recordAudit(db as never, {
      tenantId:  ctx.tenantId,
      userId:    ctx.callerUserId,
      userName:  ctx.callerName,
      userRole:  ctx.callerRole,
      action:    "CREATE",
      module:    "appointments",
      entityId:  (row as unknown as Record<string, unknown>)["id"] as string,
      newValues: payload as Record<string, unknown>,
    });

    return toPublic(row as unknown as Record<string, unknown>);
  },

  // ─── Lectura ────────────────────────────────────────────────────────────────

  /** Obtiene un turno por ID con acciones habilitadas según estado y rol (RN-MC1). */
  async obtenerTurno(id: string, ctx: CallerContext): Promise<TurnoPublico> {
    const db = getServiceDb();

    const { data: row } = await db
      .from("turnos")
      .select(TURNO_SELECT)
      .eq("id", id)
      .eq("tenant_id", ctx.tenantId)
      .maybeSingle();

    if (!row) {
      throw new DomainError(ErrorCode.TURNO_NOT_FOUND, 404, "Turno no encontrado");
    }

    const isAdmin = await this._getIsAdmin(db, ctx.tenantId, ctx.callerUserId);
    const status  = (row as unknown as Record<string, unknown>)["status"] as string;
    return toPublic(row as unknown as Record<string, unknown>, this._accionesDisponibles(status, isAdmin));
  },

  /** Lista turnos del tenant. Sin filtros devuelve la agenda activa (excluye terminales). */
  async listarTurnos(
    params: { date?: string; status?: string },
    ctx: CallerContext,
  ): Promise<TurnoPublico[]> {
    const db = getServiceDb();

    let q = db
      .from("turnos")
      .select(TURNO_SELECT)
      .eq("tenant_id", ctx.tenantId)
      .order("date")
      .order("start_time");

    if (params.date)   q = q.eq("date", params.date);
    if (params.status) {
      q = q.eq("status", params.status);
    } else {
      q = q.in("status", ["Programado", "Confirmado"]);
    }

    const { data: rows, error } = await q;
    if (error) {
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, `Error listando turnos: ${error.message}`);
    }

    return ((rows as unknown[]) ?? []).map((r) =>
      toPublic(r as Record<string, unknown>),
    );
  },

  // ─── Modificar / Cancelar / Eliminar ────────────────────────────────────────

  /**
   * Modificar Turno (RN-MC1, RN-MC2, RN-MC7).
   * - Solo editable si status ∉ {Completado, Cancelado} (RN-MC1).
   * - Si cambia servicio/date/startTime/doctorId revalida RN-TU1/TU3/TU9/TU10 con
   *   la duración vigente del servicio (RN-MC2 — no se confía en el endTime viejo).
   */
  async modificarTurno(
    id: string,
    dto: ModificarTurnoDto,
    ctx: CallerContext,
  ): Promise<TurnoPublico> {
    const db = getServiceDb();

    const { data: current } = await db
      .from("turnos")
      .select("id, status, servicio_id, doctor_id, date, start_time, end_time, tenant_id")
      .eq("id", id)
      .eq("tenant_id", ctx.tenantId)
      .maybeSingle();

    const cur = current as unknown as Record<string, unknown> | null;
    if (!cur) {
      throw new DomainError(ErrorCode.TURNO_NOT_FOUND, 404, "Turno no encontrado");
    }
    // RN-MC1: estados terminales no se editan.
    if (ESTADOS_TERMINALES.has(cur["status"] as string)) {
      throw new DomainError(
        ErrorCode.APPOINTMENT_LOCKED,
        422,
        "El turno no puede modificarse en su estado actual",
      );
    }

    const prevValues = { ...cur };

    // Determinar valores efectivos tras el merge.
    const efectivoServicioId = dto.servicioId ?? (cur["servicio_id"] as string);
    const efectivaDate       = dto.date       ?? (cur["date"]       as string);
    const efectivoStartTime  = dto.startTime  ?? fmtHHMM(cur["start_time"] as string);
    const efectivoDoctorId   = dto.doctorId !== undefined
      ? dto.doctorId
      : (cur["doctor_id"] as string | null);

    // RN-MC2: revalidar si cambió algo que afecta el slot.
    const cambiaSched = dto.servicioId || dto.date || dto.startTime || dto.doctorId !== undefined;
    let efectivoEndTime = fmtHHMM(cur["end_time"] as string);

    if (cambiaSched) {
      // RN-TU9: resolver duración vigente del servicio (server-side).
      const { data: svcData } = await db
        .from("servicios")
        .select("id, duracion_minutos, requiere_profesional, activo")
        .eq("id", efectivoServicioId)
        .eq("tenant_id", ctx.tenantId)
        .maybeSingle();

      const svc = svcData as unknown as Record<string, unknown> | null;
      if (!svc || svc["activo"] !== true) {
        throw new DomainError(ErrorCode.SERVICE_NOT_FOUND, 422, "El servicio no existe o no está activo");
      }

      // RN-TU10: doctor obligatorio si el servicio lo requiere.
      if (svc["requiere_profesional"] === true && !efectivoDoctorId) {
        throw new DomainError(
          ErrorCode.VALIDATION_ERROR,
          422,
          "Este servicio requiere seleccionar un profesional",
          [{ field: "doctorId", message: "doctorId es obligatorio para este servicio" }],
        );
      }

      // RN-TU1: no se reprograma a una fecha/hora ya pasada (incluye un turno
      // vencido sin cerrar: solo puede moverse a un horario efectivamente futuro).
      assertFechaHoraFutura(
        efectivaDate,
        efectivoStartTime,
        "No se puede mover el turno a una fecha u hora ya pasada",
      );

      const duracion  = svc["duracion_minutos"] as number;
      const inicioMin = toMinutes(efectivoStartTime);
      const finMin    = inicioMin + duracion;
      if (finMin > 24 * 60) {
        throw new DomainError(ErrorCode.VALIDATION_ERROR, 422, "La duración del servicio excede el final del día");
      }
      efectivoEndTime = fromMinutes(finMin);

      // RN-TU2: bloque debe caber en franja si hay doctor.
      if (efectivoDoctorId) {
        await this._assertBloqueEnFranja(db, ctx.tenantId, efectivoDoctorId, efectivaDate, inicioMin, finMin);
      }
    }

    const patch: Record<string, unknown> = {};
    if (dto.servicioId !== undefined) patch["servicio_id"] = dto.servicioId;
    if (dto.clientId   !== undefined) patch["client_id"]   = dto.clientId;
    if (dto.petId      !== undefined) patch["pet_id"]      = dto.petId;
    if (dto.doctorId   !== undefined) patch["doctor_id"]   = dto.doctorId;
    if (dto.date       !== undefined) patch["date"]        = dto.date;
    if (dto.startTime  !== undefined) patch["start_time"]  = dto.startTime;
    if (dto.reason     !== undefined) patch["reason"]      = dto.reason;
    if (dto.notes      !== undefined) patch["notes"]       = dto.notes;
    if (cambiaSched)                  patch["end_time"]    = efectivoEndTime;

    const { data: updated, error } = await db
      .from("turnos")
      .update(patch)
      .eq("id", id)
      .eq("tenant_id", ctx.tenantId)
      .select(TURNO_SELECT)
      .single();

    if (error || !updated) {
      if (error?.code === "23P01") {
        throw new DomainError(ErrorCode.TURNO_SOLAPADO, 409, "El profesional ya tiene un turno solapado");
      }
      if (error?.code === "23505") {
        throw new DomainError(ErrorCode.DUPLICATE_APPOINTMENT, 409, "Ya existe un turno duplicado");
      }
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, `No se pudo modificar: ${error?.message ?? ""}`);
    }

    // RN-MC7: auditoría UPDATE.
    await recordAudit(db as never, {
      tenantId:   ctx.tenantId,
      userId:     ctx.callerUserId,
      userName:   ctx.callerName,
      userRole:   ctx.callerRole,
      action:     "UPDATE",
      module:     "appointments",
      entityId:   id,
      oldValues:    prevValues,
      newValues:  patch,
    });

    return toPublic(updated as unknown as Record<string, unknown>);
  },

  /**
   * Cancelar Turno (RN-MC3, RN-MC7).
   * - Solo cancelable si status ∉ {Completado, Cancelado} (RN-ES3 / RN-MC1).
   */
  async cancelarTurno(
    id: string,
    dto: CancelarTurnoDto,
    ctx: CallerContext,
  ): Promise<TurnoPublico> {
    const db = getServiceDb();

    const { data: current } = await db
      .from("turnos")
      .select("id, status, tenant_id")
      .eq("id", id)
      .eq("tenant_id", ctx.tenantId)
      .maybeSingle();

    const cur = current as unknown as Record<string, unknown> | null;
    if (!cur) {
      throw new DomainError(ErrorCode.TURNO_NOT_FOUND, 404, "Turno no encontrado");
    }
    if (ESTADOS_TERMINALES.has(cur["status"] as string)) {
      throw new DomainError(
        ErrorCode.APPOINTMENT_LOCKED,
        422,
        "El turno ya está en un estado terminal y no puede cancelarse",
      );
    }

    const patch = {
      status:              "Cancelado",
      cancellation_reason: dto.cancellationReason,
      cancelled_at:        new Date().toISOString(),
    };

    const { data: updated, error } = await db
      .from("turnos")
      .update(patch)
      .eq("id", id)
      .eq("tenant_id", ctx.tenantId)
      .select(TURNO_SELECT)
      .single();

    if (error || !updated) {
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, `No se pudo cancelar: ${error?.message ?? ""}`);
    }

    // RN-MC7: auditoría CANCEL.
    await recordAudit(db as never, {
      tenantId:   ctx.tenantId,
      userId:     ctx.callerUserId,
      userName:   ctx.callerName,
      userRole:   ctx.callerRole,
      action:     "CANCEL",
      module:     "appointments",
      entityId:   id,
      oldValues: cur,
      newValues:  patch,
    });

    return toPublic(updated as unknown as Record<string, unknown>);
  },

  /**
   * Eliminar Turno definitivamente (RN-MC6, RN-MC7).
   * - Terminales: solo Admin puede eliminar (RN-MC6).
   * - No terminales: cualquier usuario con manage_appointments puede eliminar.
   */
  async eliminarTurno(id: string, ctx: CallerContext): Promise<void> {
    const db = getServiceDb();

    const { data: current } = await db
      .from("turnos")
      .select("id, status, tenant_id")
      .eq("id", id)
      .eq("tenant_id", ctx.tenantId)
      .maybeSingle();

    const cur = current as unknown as Record<string, unknown> | null;
    if (!cur) {
      throw new DomainError(ErrorCode.TURNO_NOT_FOUND, 404, "Turno no encontrado");
    }

    // RN-MC6: estado terminal → solo Admin.
    if (ESTADOS_TERMINALES.has(cur["status"] as string)) {
      const isAdmin = await this._getIsAdmin(db, ctx.tenantId, ctx.callerUserId);
      if (!isAdmin) {
        throw new DomainError(
          ErrorCode.APPOINTMENT_LOCKED,
          403,
          "Solo un Administrador puede eliminar un turno en estado terminal",
        );
      }
    }

    const prevValues = { ...cur };

    const { error } = await db
      .from("turnos")
      .delete()
      .eq("id", id)
      .eq("tenant_id", ctx.tenantId);

    if (error) {
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, `No se pudo eliminar: ${error.message}`);
    }

    // RN-MC7: auditoría DELETE.
    await recordAudit(db as never, {
      tenantId:   ctx.tenantId,
      userId:     ctx.callerUserId,
      userName:   ctx.callerName,
      userRole:   ctx.callerRole,
      action:     "DELETE",
      module:     "appointments",
      entityId:   id,
      oldValues:    prevValues,
    });
  },

  // ─── Gestionar Estado ───────────────────────────────────────────────────────

  /**
   * Cambiar estado del turno (RN-ES1..ES5).
   * - Máquina de estados: Programado→Confirmado, Confirmado→Completado.
   * - Terminales (Completado, Cancelado) no admiten cambio.
   * - Cancelado se gestiona por /cancelar, no por este endpoint.
   */
  async cambiarEstado(
    id: string,
    dto: CambiarEstadoDto,
    ctx: CallerContext,
  ): Promise<TurnoPublico> {
    const db = getServiceDb();

    const { data: current } = await db
      .from("turnos")
      .select("id, status, tenant_id")
      .eq("id", id)
      .eq("tenant_id", ctx.tenantId)
      .maybeSingle();

    const cur = current as unknown as Record<string, unknown> | null;
    if (!cur) {
      throw new DomainError(ErrorCode.TURNO_NOT_FOUND, 404, "Turno no encontrado");
    }

    const currentStatus = cur["status"] as string;
    const allowed = TRANSICIONES_VALIDAS[currentStatus] ?? [];

    if (!allowed.includes(dto.status)) {
      throw new DomainError(
        ErrorCode.INVALID_TRANSITION,
        422,
        `Transición inválida: ${currentStatus} → ${dto.status}`,
      );
    }

    const { data: updated, error } = await db
      .from("turnos")
      .update({ status: dto.status })
      .eq("id", id)
      .eq("tenant_id", ctx.tenantId)
      .select(TURNO_SELECT)
      .single();

    if (error || !updated) {
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, `No se pudo cambiar estado: ${error?.message ?? ""}`);
    }

    // RN-ES5: auditoría UPDATE.
    await recordAudit(db as never, {
      tenantId:   ctx.tenantId,
      userId:     ctx.callerUserId,
      userName:   ctx.callerName,
      userRole:   ctx.callerRole,
      action:     "UPDATE",
      module:     "appointments",
      entityId:   id,
      oldValues: { status: currentStatus },
      newValues:  { status: dto.status },
    });

    return toPublic(updated as unknown as Record<string, unknown>);
  },

  /**
   * Slots disponibles para Agendar Turno (RN-TU2): inicios válidos de un servicio
   * para un doctor y fecha, derivados de las franjas activas del día y restando
   * los turnos ya ocupados (en una sola consulta por entidad; sin N+1).
   */
  async slotsDisponibles(
    doctorId: string,
    date: string,
    servicioId: string,
    tenantId: string,
  ): Promise<SlotDisponible[]> {
    const db = getServiceDb();

    // Servicio activo del tenant → duración del slot (RN-TU9).
    const { data: servicio } = await db
      .from("servicios")
      .select("duracion_minutos, activo")
      .eq("id", servicioId)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    const svc = servicio as unknown as Record<string, unknown> | null;
    if (!svc || svc["activo"] !== true) {
      throw new DomainError(
        ErrorCode.SERVICE_NOT_FOUND,
        422,
        "El servicio no existe o no está activo en este tenant",
      );
    }
    const duracion = svc["duracion_minutos"] as number;

    // Franjas activas del doctor para ese día (RN-TU2 / RN-HOR3).
    const { data: franjasData } = await db
      .from("horarios_doctor")
      .select("start_time, end_time")
      .eq("tenant_id", tenantId)
      .eq("doctor_id", doctorId)
      .eq("day_of_week", diaSemana(date))
      .eq("active", true);

    const franjas = ((franjasData as unknown[]) ?? []).map((f) => {
      const r = f as Record<string, unknown>;
      return { inicio: toMinutes(r["start_time"] as string), fin: toMinutes(r["end_time"] as string) };
    });

    // Turnos ya ocupados del doctor ese día (estados que bloquean el slot).
    const { data: ocupadosData } = await db
      .from("turnos")
      .select("start_time, end_time")
      .eq("tenant_id", tenantId)
      .eq("doctor_id", doctorId)
      .eq("date", date)
      .in("status", ["Programado", "Confirmado"]);

    const ocupados = ((ocupadosData as unknown[]) ?? []).map((o) => {
      const r = o as Record<string, unknown>;
      return { inicio: toMinutes(r["start_time"] as string), fin: toMinutes(r["end_time"] as string) };
    });

    const slots: SlotDisponible[] = [];
    for (const franja of franjas) {
      for (let s = franja.inicio; s + duracion <= franja.fin; s += duracion) {
        const e = s + duracion;
        const chocado = ocupados.some((t) => seSolapan(s, e, t.inicio, t.fin));
        if (!chocado) {
          slots.push({ startTime: fromMinutes(s), endTime: fromMinutes(e) });
        }
      }
    }

    slots.sort((a, b) => a.startTime.localeCompare(b.startTime));
    return slots;
  },

  // ─── Helpers privados ───────────────────────────────────────────────────────

  /**
   * Devuelve las acciones habilitadas en el modal de detalle según estado y rol (RN-MC1).
   * Programado/Confirmado → [modificar, cancelar, eliminar]
   * Terminales sin admin  → []
   * Terminales con admin  → [eliminar]
   */
  _accionesDisponibles(status: string, isAdmin: boolean): string[] {
    if (!ESTADOS_TERMINALES.has(status)) {
      return ["modificar", "cancelar", "eliminar"];
    }
    return isAdmin ? ["eliminar"] : [];
  },

  /** Verifica si el usuario es Admin consultando roles en la DB. */
  async _getIsAdmin(
    db: ReturnType<typeof getServiceDb>,
    tenantId: string,
    userId: string,
  ): Promise<boolean> {
    const { data } = await db
      .from("usuarios")
      .select("roles!inner(name)")
      .eq("auth_user_id", userId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    const row = data as { roles: { name: string } | null } | null;
    return row?.roles?.name === "admin";
  },

  /**
   * RN-TU2: el bloque [inicioMin, finMin) debe quedar contenido en alguna franja
   * activa del doctor para ese día; si no hay franja que lo contenga → 422.
   */
  async _assertBloqueEnFranja(
    db: ReturnType<typeof getServiceDb>,
    tenantId: string,
    doctorId: string,
    date: string,
    inicioMin: number,
    finMin: number,
  ): Promise<void> {
    const { data } = await db
      .from("horarios_doctor")
      .select("start_time, end_time")
      .eq("tenant_id", tenantId)
      .eq("doctor_id", doctorId)
      .eq("day_of_week", diaSemana(date))
      .eq("active", true);

    const franjas = (data as unknown[]) ?? [];
    const cabe = franjas.some((f) => {
      const r = f as Record<string, unknown>;
      const s = toMinutes(r["start_time"] as string);
      const e = toMinutes(r["end_time"]   as string);
      return s <= inicioMin && finMin <= e;
    });

    if (!cabe) {
      throw new DomainError(
        ErrorCode.VALIDATION_ERROR,
        422,
        "El horario solicitado está fuera de las franjas de atención del profesional",
        [{ field: "startTime", message: "El bloque del servicio no cabe en ninguna franja activa" }],
      );
    }
  },
};
