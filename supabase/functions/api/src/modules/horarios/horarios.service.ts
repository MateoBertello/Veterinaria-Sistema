import { DomainError, ErrorCode } from "../../shared/errors.ts";
import { recordAudit } from "../../shared/audit.ts";
import { getServiceDb } from "../../shared/db.ts";
import {
  CrearFranjaSchema,
  type CrearFranjaDto,
} from "./horarios.schemas.ts";

// ─── Tipos públicos ───────────────────────────────────────────────────────────

export interface CallerContext {
  tenantId:     string;
  callerUserId: string;
  callerName:   string;
  callerRole:   string;
  /**
   * RN-HOR7: `true` para quien administra la clínica (`manage_users`), que
   * gestiona el horario de cualquier profesional. Con `false` —el veterinario
   * con `manage_schedules`— solo puede tocar el suyo. La lectura no distingue:
   * ver la agenda del resto es parte de coordinarse.
   */
  canManageAll: boolean;
}

export interface HorarioPublico {
  id:        string;
  doctorId:  string;
  dayOfWeek: number;
  startTime: string; // "HH:MM"
  endTime:   string; // "HH:MM"
  active:    boolean;
}

export interface DoctorHorariosResumen {
  doctorId:  string;
  name:      string;
  available: boolean;
  franjas:   HorarioPublico[];
}

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

function toPublic(row: Record<string, unknown>): HorarioPublico {
  return {
    id:        row["id"]          as string,
    doctorId:  row["doctor_id"]   as string,
    dayOfWeek: row["day_of_week"] as number,
    startTime: fmtHHMM(row["start_time"] as string),
    endTime:   fmtHHMM(row["end_time"]   as string),
    active:    row["active"]      as boolean,
  };
}

/** Dos intervalos [s1,e1) y [s2,e2) (en minutos) se solapan. */
function seSolapan(s1: number, e1: number, s2: number, e2: number): boolean {
  return s1 < e2 && s2 < e1;
}

// ─── HorarioService ──────────────────────────────────────────────────────────────

export const HorarioService = {
  /** Verifica que el doctor exista en el tenant (RN-HOR4) y devuelve su fila. */
  async _doctorDelTenant(
    db: ReturnType<typeof getServiceDb>,
    doctorId: string,
    tenantId: string,
  ): Promise<Record<string, unknown>> {
    const { data } = await db
      .from("doctores")
      .select("id, tenant_id, user_id, available")
      .eq("id", doctorId)
      .eq("tenant_id", tenantId)
      .single();

    if (!data) {
      // RN-HOR4: sólo profesionales (Doctor) del tenant tienen horarios.
      throw new DomainError(ErrorCode.FORBIDDEN, 403, "Doctor no encontrado en este tenant");
    }
    return data as unknown as Record<string, unknown>;
  },

  /**
   * RN-HOR7 (pertenencia): quien no administra la clínica solo puede modificar
   * el horario de SU propio perfil profesional. Se valida sobre la fila del
   * doctor ya cargada, así no agrega una consulta.
   */
  _assertPuedeGestionar(doctor: Record<string, unknown>, ctx: CallerContext): void {
    if (ctx.canManageAll) return;

    if ((doctor["user_id"] as string | null) !== ctx.callerUserId) {
      throw new DomainError(
        ErrorCode.FORBIDDEN,
        403,
        "Solo podés gestionar tu propio horario",
      );
    }
  },

  /**
   * RN-HOR8 (baja lógica del profesional): un doctor con `available=false` no
   * puede recibir franjas nuevas ni reactivar las que tenía — no tiene sentido
   * ofrecerlo para turnos nuevos. La baja no es destructiva: conserva sus
   * franjas y se pueden listar, desactivar o eliminar sin restricción, así que
   * este chequeo solo se invoca desde crear y desde reactivar.
   */
  _assertDisponible(doctor: Record<string, unknown>): void {
    if (!(doctor["available"] as boolean)) {
      throw new DomainError(
        ErrorCode.DOCTOR_INACTIVE,
        422,
        "El profesional está dado de baja: no se le pueden asignar franjas nuevas",
      );
    }
  },

  /** Igual que `_assertPuedeGestionar`, para operaciones que parten de una franja. */
  async _assertPuedeGestionarFranja(
    db: ReturnType<typeof getServiceDb>,
    doctorId: string,
    ctx: CallerContext,
  ): Promise<void> {
    if (ctx.canManageAll) return;
    const doctor = await this._doctorDelTenant(db, doctorId, ctx.tenantId);
    this._assertPuedeGestionar(doctor, ctx);
  },

  /** Franjas de un profesional (activas + inactivas), ordenadas por día y hora. */
  async listarPorDoctor(doctorId: string, ctx: CallerContext): Promise<HorarioPublico[]> {
    const db = getServiceDb();
    await this._doctorDelTenant(db, doctorId, ctx.tenantId); // RN-HOR4

    const { data, error } = await db
      .from("horarios_doctor")
      .select("*")
      .eq("tenant_id", ctx.tenantId)
      .eq("doctor_id", doctorId)
      .order("day_of_week", { ascending: true })
      .order("start_time", { ascending: true });

    if (error) {
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, error.message);
    }

    return ((data as unknown[]) ?? []).map((r) => toPublic(r as Record<string, unknown>));
  },

  /**
   * Crear franja (RN-HOR1, RN-HOR2, RN-HOR4, RN-HOR6).
   * - RN-HOR1: startTime < endTime → si no, 422 INVALID_RANGE.
   * - RN-HOR2: si la franja es activa, no puede solaparse con otra activa del
   *   mismo doctor y día → 409 SCHEDULE_OVERLAP.
   */
  async crearFranja(
    doctorId: string,
    dto: CrearFranjaDto,
    ctx: CallerContext,
  ): Promise<HorarioPublico> {
    const parsed = CrearFranjaSchema.safeParse(dto);
    if (!parsed.success) {
      throw new DomainError(
        ErrorCode.VALIDATION_ERROR,
        422,
        "Datos de franja inválidos",
        parsed.error.issues,
      );
    }
    const data = parsed.data;

    const db = getServiceDb();
    const doctor = await this._doctorDelTenant(db, doctorId, ctx.tenantId); // RN-HOR4
    this._assertPuedeGestionar(doctor, ctx);                                // RN-HOR7
    this._assertDisponible(doctor);                                        // RN-HOR8

    const inicio = toMinutes(data.startTime);
    const fin    = toMinutes(data.endTime);

    // RN-HOR1: rango válido.
    if (inicio >= fin) {
      throw new DomainError(
        ErrorCode.INVALID_RANGE,
        422,
        "La hora de inicio debe ser anterior a la hora de fin",
      );
    }

    // RN-HOR2: sin solapamiento con franjas activas del mismo doctor y día.
    if (data.active) {
      await this._assertSinSolapamiento(db, ctx.tenantId, doctorId, data.dayOfWeek, inicio, fin, null);
    }

    const payload = {
      tenant_id:   ctx.tenantId,
      doctor_id:   doctorId,
      day_of_week: data.dayOfWeek,
      start_time:  data.startTime,
      end_time:    data.endTime,
      active:      data.active,
    };

    const { data: row, error } = await db
      .from("horarios_doctor")
      .insert(payload)
      .select("*")
      .single();

    if (error || !row) {
      throw new DomainError(
        ErrorCode.INTERNAL_ERROR,
        500,
        `No se pudo crear la franja: ${error?.message ?? ""}`,
      );
    }

    // RN-HOR6: auditoría CREATE en módulo system.
    await recordAudit(db as never, {
      tenantId:  ctx.tenantId,
      userId:    ctx.callerUserId,
      userName:  ctx.callerName,
      userRole:  ctx.callerRole,
      action:    "CREATE",
      module:    "system",
      entityId:  (row as unknown as Record<string, unknown>)["id"] as string,
      newValues: payload as Record<string, unknown>,
    });

    return toPublic(row as unknown as Record<string, unknown>);
  },

  /**
   * Activar/desactivar una franja (RN-HOR2 al reactivar, RN-HOR6).
   * Al pasar de inactiva → activa, se revalida el solapamiento.
   */
  async alternarActivo(
    horarioId: string,
    active: boolean,
    ctx: CallerContext,
  ): Promise<HorarioPublico> {
    const db = getServiceDb();

    const { data: actual } = await db
      .from("horarios_doctor")
      .select("*")
      .eq("id", horarioId)
      .eq("tenant_id", ctx.tenantId)
      .single();

    if (!actual) {
      throw new DomainError(ErrorCode.FORBIDDEN, 403, "Franja no encontrada en este tenant");
    }

    const actualRow = actual as unknown as Record<string, unknown>;
    const doctorId  = actualRow["doctor_id"] as string;

    if (active) {
      // Reactivar exige conocer al doctor sí o sí (pertenencia RN-HOR7 y
      // disponibilidad RN-HOR8), así que se carga una única vez.
      const doctor = await this._doctorDelTenant(db, doctorId, ctx.tenantId);
      this._assertPuedeGestionar(doctor, ctx); // RN-HOR7
      this._assertDisponible(doctor);          // RN-HOR8

      // RN-HOR2: al activar, revalidar solapamiento (excluyéndose a sí misma).
      const inicio = toMinutes(actualRow["start_time"] as string);
      const fin    = toMinutes(actualRow["end_time"]   as string);
      await this._assertSinSolapamiento(
        db,
        ctx.tenantId,
        doctorId,
        actualRow["day_of_week"] as number,
        inicio,
        fin,
        horarioId,
      );
    } else {
      // Desactivar no exige disponibilidad (RN-HOR8): la baja no es destructiva.
      await this._assertPuedeGestionarFranja(db, doctorId, ctx); // RN-HOR7
    }

    const { data: row, error } = await db
      .from("horarios_doctor")
      .update({ active })
      .eq("id", horarioId)
      .eq("tenant_id", ctx.tenantId)
      .select("*")
      .single();

    if (error) {
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, error.message);
    }

    // RN-HOR6: auditoría UPDATE en módulo system.
    await recordAudit(db as never, {
      tenantId:  ctx.tenantId,
      userId:    ctx.callerUserId,
      userName:  ctx.callerName,
      userRole:  ctx.callerRole,
      action:    "UPDATE",
      module:    "system",
      entityId:  horarioId,
      oldValues: actualRow,
      newValues: { active },
    });

    return toPublic((row ?? { ...actualRow, active }) as unknown as Record<string, unknown>);
  },

  /** Eliminar una franja (RN-HOR6). */
  async eliminar(horarioId: string, ctx: CallerContext): Promise<void> {
    const db = getServiceDb();

    const { data: actual } = await db
      .from("horarios_doctor")
      .select("*")
      .eq("id", horarioId)
      .eq("tenant_id", ctx.tenantId)
      .single();

    if (!actual) {
      throw new DomainError(ErrorCode.FORBIDDEN, 403, "Franja no encontrada en este tenant");
    }

    // RN-HOR7: la franja tiene que ser del propio profesional (salvo admin).
    await this._assertPuedeGestionarFranja(
      db,
      (actual as unknown as Record<string, unknown>)["doctor_id"] as string,
      ctx,
    );

    const { error } = await db
      .from("horarios_doctor")
      .delete()
      .eq("id", horarioId)
      .eq("tenant_id", ctx.tenantId);

    if (error) {
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, error.message);
    }

    // RN-HOR6: auditoría DELETE en módulo system.
    await recordAudit(db as never, {
      tenantId:  ctx.tenantId,
      userId:    ctx.callerUserId,
      userName:  ctx.callerName,
      userRole:  ctx.callerRole,
      action:    "DELETE",
      module:    "system",
      entityId:  horarioId,
      oldValues: actual as unknown as Record<string, unknown>,
    });
  },

  /**
   * Resumen global de disponibilidad: todos los doctores del tenant con sus
   * franjas, en UNA sola consulta (embed) para evitar N+1.
   */
  async resumen(ctx: CallerContext): Promise<DoctorHorariosResumen[]> {
    const db = getServiceDb();

    const { data, error } = await db
      .from("doctores")
      .select(
        "id, name, available, franjas:horarios_doctor!doctor_id(id, doctor_id, day_of_week, start_time, end_time, active)",
      )
      .eq("tenant_id", ctx.tenantId)
      .order("name", { ascending: true });

    if (error) {
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, error.message);
    }

    return ((data as unknown[]) ?? []).map((r) => {
      const row = r as Record<string, unknown>;
      const franjas = ((row["franjas"] as unknown[]) ?? []).map((f) =>
        toPublic(f as Record<string, unknown>),
      );
      // Orden estable día/hora (el embed no garantiza orden).
      franjas.sort((a, b) =>
        a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime),
      );
      return {
        doctorId:  row["id"]        as string,
        name:      row["name"]      as string,
        available: row["available"] as boolean,
        franjas,
      };
    });
  },

  /**
   * RN-HOR3 — generación de slots para Turnos. Las franjas activas se dividen en
   * intervalos según la duración del servicio. La implementación y su consumo
   * desde TurnoService llegan en la Etapa 6; aquí se deja sólo el enganche.
   */
  async slotsDisponibles(
    _doctorId: string,
    _fecha: string,
    _duracionMinutos: number,
  ): Promise<never[]> {
    // TODO E6: derivar slots de las franjas activas del día (RN-HOR3 / RN-TU2).
    return [];
  },

  /** RN-HOR2: lanza SCHEDULE_OVERLAP si la franja se solapa con otra activa. */
  async _assertSinSolapamiento(
    db: ReturnType<typeof getServiceDb>,
    tenantId: string,
    doctorId: string,
    dayOfWeek: number,
    inicio: number,
    fin: number,
    excluirId: string | null,
  ): Promise<void> {
    const { data } = await db
      .from("horarios_doctor")
      .select("id, start_time, end_time")
      .eq("tenant_id", tenantId)
      .eq("doctor_id", doctorId)
      .eq("day_of_week", dayOfWeek)
      .eq("active", true);

    const filas = (data as unknown[]) ?? [];
    for (const f of filas) {
      const row = f as Record<string, unknown>;
      if (excluirId && row["id"] === excluirId) continue;
      const s = toMinutes(row["start_time"] as string);
      const e = toMinutes(row["end_time"]   as string);
      if (seSolapan(inicio, fin, s, e)) {
        throw new DomainError(
          ErrorCode.SCHEDULE_OVERLAP,
          409,
          "La franja se solapa con otra franja activa del mismo profesional y día",
        );
      }
    }
  },
};
