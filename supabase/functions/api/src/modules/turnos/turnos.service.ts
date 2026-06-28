import { DomainError, ErrorCode } from "../../shared/errors.ts";
import { recordAudit } from "../../shared/audit.ts";
import { getServiceDb } from "../../shared/db.ts";
import { CrearTurnoSchema, type CrearTurnoDto } from "./turnos.schemas.ts";

// ─── Tipos públicos ───────────────────────────────────────────────────────────

export interface CallerContext {
  tenantId:     string;
  callerUserId: string;
  callerName:   string;
  callerRole:   string;
}

export interface TurnoPublico {
  id:        string;
  date:      string;
  startTime: string; // "HH:MM"
  endTime:   string; // "HH:MM"
  status:    string;
  reason:    string;
  notes:     string | null;
  servicio:  { id: string; nombre: string; tipo: string; duracionMinutos: number } | null;
  doctor:    { id: string; name: string } | null;
  mascota:   { id: string; name: string } | null;
  cliente:   { id: string; fullName: string } | null;
}

export interface SlotDisponible {
  startTime: string; // "HH:MM"
  endTime:   string; // "HH:MM"
}

// Embed para resolver servicio + doctor + mascota + cliente en UNA consulta (sin N+1).
const TURNO_SELECT =
  "id, date, start_time, end_time, status, reason, notes, " +
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

function unwrapEmbed<T>(v: unknown): T | null {
  // PostgREST devuelve el embed como objeto o como array de un elemento según la relación.
  if (Array.isArray(v)) return (v[0] as T) ?? null;
  return (v as T) ?? null;
}

function toPublic(row: Record<string, unknown>): TurnoPublico {
  const svc = unwrapEmbed<Record<string, unknown>>(row["servicio"]);
  const doc = unwrapEmbed<Record<string, unknown>>(row["doctor"]);
  const pet = unwrapEmbed<Record<string, unknown>>(row["mascota"]);
  const cli = unwrapEmbed<Record<string, unknown>>(row["cliente"]);

  return {
    id:        row["id"]         as string,
    date:      row["date"]       as string,
    startTime: fmtHHMM(row["start_time"] as string),
    endTime:   fmtHHMM(row["end_time"]   as string),
    status:    row["status"]     as string,
    reason:    row["reason"]     as string,
    notes:     (row["notes"]     as string | null) ?? null,
    servicio:  svc
      ? {
          id:              svc["id"]               as string,
          nombre:          svc["nombre"]           as string,
          tipo:            svc["tipo"]             as string,
          duracionMinutos: svc["duracion_minutos"] as number,
        }
      : null,
    doctor:   doc ? { id: doc["id"] as string, name: doc["name"] as string } : null,
    mascota:  pet ? { id: pet["id"] as string, name: pet["name"] as string } : null,
    cliente:  cli ? { id: cli["id"] as string, fullName: cli["full_name"] as string } : null,
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

    // RN-TU1: no se agenda en fechas pasadas (comparación lexicográfica de YYYY-MM-DD).
    const hoy = new Date().toISOString().slice(0, 10);
    if (data.date < hoy) {
      throw new DomainError(ErrorCode.PAST_DATE, 422, "No se puede agendar en una fecha pasada");
    }

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
