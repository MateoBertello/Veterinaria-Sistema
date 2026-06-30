import { DomainError, ErrorCode } from "../../shared/errors.ts";
import { recordAudit } from "../../shared/audit.ts";
import { getServiceDb } from "../../shared/db.ts";
import {
  CanalEmailResend,
  type CanalNotificacion,
} from "../../shared/notificaciones/canal-email.ts";
import {
  ConfigNotificacionTurnosSchema,
  CONFIG_NOTIF_TURNOS_DEFAULT,
  PARAM_KEY_NOTIF_TURNOS,
  type ConfigNotificacionTurnosDto,
  type ResultadoProcesamiento,
} from "./notificaciones.schemas.ts";

// ─── Tipos ──────────────────────────────────────────────────────────────────

export interface CallerContext {
  tenantId:     string;
  callerUserId: string;
  callerName:   string;
  callerRole:   string;
}

/** Canales soportados por la tabla `notificaciones` (CHECK canal). */
export type Canal = "email" | "whatsapp" | "sms";

/** Dependencias inyectables — permiten mockear los canales en tests (sin enviar). */
export interface ProcesarDeps {
  /** Implementación por canal. Por defecto solo `email` (Resend) está disponible. */
  canales?: Partial<Record<Canal, CanalNotificacion>>;
  /** Reloj inyectable para tests deterministas de la ventana (RN-NT1). */
  now?: Date;
}

export interface ProcesarOpts {
  /** Si se indica, procesa SOLO ese tenant (disparo manual). Si no, barre todos los activos (cron). */
  tenantId?: string;
}

/**
 * Aviso genérico a enviar por un canal, independiente del origen (turno/vacunación).
 * Permite que `_enviarAviso` sea la ÚNICA fuente de idempotencia (RN-NT3): un solo
 * INSERT en `notificaciones` con el UNIQUE(tenant, origen, referencia_id, canal).
 */
interface AvisoNotificacion {
  origen:       "turno" | "vacunacion";
  referenciaId: string;
  destino:      string;
  asunto:       string;
  cuerpo:       string;
  resumen:      string;
  auditDetail:  string;
}

interface ContactoCliente {
  fullName: string;
  email:    string | null;
  phone:    string | null;
}

interface TurnoParaNotificar {
  id:        string;
  date:      string;
  startTime: string;
  status:    string;
  cliente:   ContactoCliente;
  mascota:   string | null;
  servicio:  string | null;
}

// Embed: resuelve cliente + mascota + servicio en UNA consulta (sin N+1).
const TURNO_NOTIF_SELECT =
  "id, date, start_time, status, " +
  "cliente:clientes(full_name, email, phone), " +
  "mascota:mascotas(name), " +
  "servicio:servicios(nombre)";

// ─── Helpers puros ────────────────────────────────────────────────────────────

function unwrapEmbed<T>(v: unknown): T | null {
  if (Array.isArray(v)) return (v[0] as T) ?? null;
  return (v as T) ?? null;
}

function mapTurno(row: Record<string, unknown>): TurnoParaNotificar {
  const cli = unwrapEmbed<Record<string, unknown>>(row["cliente"]);
  const pet = unwrapEmbed<Record<string, unknown>>(row["mascota"]);
  const svc = unwrapEmbed<Record<string, unknown>>(row["servicio"]);
  return {
    id:        row["id"]   as string,
    date:      row["date"] as string,
    startTime: (row["start_time"] as string),
    status:    row["status"] as string,
    cliente: {
      fullName: (cli?.["full_name"] as string) ?? "",
      email:    (cli?.["email"]     as string | null) ?? null,
      phone:    (cli?.["phone"]     as string | null) ?? null,
    },
    mascota:  (pet?.["name"]   as string | null) ?? null,
    servicio: (svc?.["nombre"] as string | null) ?? null,
  };
}

/** Fecha "YYYY-MM-DD" de un Date en UTC (consistente con el resto del código). */
function dateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function destinoDeCanal(canal: Canal, cliente: ContactoCliente): string | null {
  if (canal === "email") return cliente.email;
  return cliente.phone; // whatsapp / sms
}

function construirMensaje(turno: TurnoParaNotificar): { asunto: string; cuerpo: string; resumen: string } {
  const mascota = turno.mascota ?? "tu mascota";
  const servicio = turno.servicio ? ` (${turno.servicio})` : "";
  const hhmm = turno.startTime.slice(0, 5);
  const asunto = `Recordatorio de turno — ${mascota}`;
  const cuerpo =
    `<p>Hola ${turno.cliente.fullName || ""},</p>` +
    `<p>Te recordamos el turno de <strong>${mascota}</strong>${servicio} ` +
    `el <strong>${turno.date}</strong> a las <strong>${hhmm}</strong>.</p>`;
  const resumen = `Turno de ${mascota}${servicio} el ${turno.date} ${hhmm}`;
  return { asunto, cuerpo, resumen };
}

// ─── Helpers de Avisos de Vacunación (RN-PV6/PV7) ───────────────────────────────

interface DosisParaNotificar {
  id:            string;
  fechaEstimada: string;
  estado:        string;
  cliente:       ContactoCliente;
  mascota:       string | null;
  tipoVacuna:    string | null;
}

// Embed: resuelve dosis → mascota → dueño (cliente) y tipo de vacuna en UNA consulta
// (sin N+1). FK únicas verificadas: plan_vacunacion.pet_id→mascotas, mascotas.client_id→clientes.
const PLAN_VACUNA_NOTIF_SELECT =
  "id, fecha_estimada, estado, notified_at, " +
  "mascota:mascotas(name, cliente:clientes(full_name, email, phone)), " +
  "tipo:tipos_vacuna(nombre)";

function mapDosis(row: Record<string, unknown>): DosisParaNotificar {
  const pet  = unwrapEmbed<Record<string, unknown>>(row["mascota"]);
  const cli  = unwrapEmbed<Record<string, unknown>>(pet?.["cliente"]);
  const tipo = unwrapEmbed<Record<string, unknown>>(row["tipo"]);
  return {
    id:            row["id"] as string,
    fechaEstimada: row["fecha_estimada"] as string,
    estado:        row["estado"] as string,
    cliente: {
      fullName: (cli?.["full_name"] as string) ?? "",
      email:    (cli?.["email"]     as string | null) ?? null,
      phone:    (cli?.["phone"]     as string | null) ?? null,
    },
    mascota:    (pet?.["name"]    as string | null) ?? null,
    tipoVacuna: (tipo?.["nombre"] as string | null) ?? null,
  };
}

function construirMensajeVacuna(dosis: DosisParaNotificar): { asunto: string; cuerpo: string; resumen: string } {
  const mascota = dosis.mascota ?? "tu mascota";
  const tipo    = dosis.tipoVacuna ?? "vacuna";
  const asunto  = `Recordatorio de vacunación — ${mascota}`;
  const cuerpo =
    `<p>Hola ${dosis.cliente.fullName || ""},</p>` +
    `<p>La vacuna <strong>${tipo}</strong> de <strong>${mascota}</strong> ` +
    `vence el <strong>${dosis.fechaEstimada}</strong>.</p>`;
  const resumen = `La vacuna ${tipo} de ${mascota} vence el ${dosis.fechaEstimada}`;
  return { asunto, cuerpo, resumen };
}

/** Días enteros (b − a) entre dos fechas "YYYY-MM-DD". */
function diffDias(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

// ─── NotificacionService (genérico por canal y por origen) ──────────────────────

export const NotificacionService = {
  /**
   * Lee la configuración de recordatorios del tenant desde
   * `configuracion_tenant.parametros_extra.notificacionesTurnos`, mezclada con
   * los defaults (RN-NT1: 24 h por defecto).
   */
  async obtenerConfig(tenantId: string): Promise<ConfigNotificacionTurnosDto> {
    const db = getServiceDb();
    const { data: row } = await db
      .from("configuracion_tenant")
      .select("parametros_extra")
      .eq("tenant_id", tenantId)
      .maybeSingle();

    const extra = ((row as Record<string, unknown> | null)?.["parametros_extra"] as
      | Record<string, unknown>
      | undefined) ?? {};
    const stored = (extra[PARAM_KEY_NOTIF_TURNOS] as Record<string, unknown> | undefined) ?? {};
    return { ...CONFIG_NOTIF_TURNOS_DEFAULT, ...stored };
  },

  /**
   * Guarda la configuración de recordatorios haciendo *merge* dentro de
   * `parametros_extra` (no pisa otras claves). Audita en módulo `system`.
   */
  async guardarConfig(
    tenantId: string,
    dto: ConfigNotificacionTurnosDto,
    ctx: CallerContext,
  ): Promise<ConfigNotificacionTurnosDto> {
    const parsed = ConfigNotificacionTurnosSchema.safeParse(dto);
    if (!parsed.success) {
      throw new DomainError(
        ErrorCode.VALIDATION_ERROR,
        422,
        "Configuración de notificaciones inválida",
        parsed.error.issues,
      );
    }

    const db = getServiceDb();
    const { data: row, error: fetchError } = await db
      .from("configuracion_tenant")
      .select("parametros_extra")
      .eq("tenant_id", tenantId)
      .single();

    if (fetchError || !row) {
      throw new DomainError(
        ErrorCode.CONFIG_NOT_FOUND,
        404,
        "Configuración de la clínica no encontrada. Contacte a soporte.",
      );
    }

    const extra = ((row as Record<string, unknown>)["parametros_extra"] as
      | Record<string, unknown>
      | undefined) ?? {};
    const oldConfig = (extra[PARAM_KEY_NOTIF_TURNOS] as Record<string, unknown> | undefined) ?? {};
    const merged = { ...extra, [PARAM_KEY_NOTIF_TURNOS]: parsed.data };

    const { error: updateError } = await db
      .from("configuracion_tenant")
      .update({ parametros_extra: merged, updated_at: new Date().toISOString() })
      .eq("tenant_id", tenantId);

    if (updateError) {
      throw new DomainError(
        ErrorCode.INTERNAL_ERROR,
        500,
        `No se pudo guardar la configuración de notificaciones: ${updateError.message}`,
      );
    }

    await recordAudit(db as never, {
      tenantId:  ctx.tenantId,
      userId:    ctx.callerUserId,
      userName:  ctx.callerName,
      userRole:  ctx.callerRole,
      action:    "UPDATE",
      module:    "system",
      entityId:  tenantId,
      oldValues: oldConfig,
      newValues: parsed.data as Record<string, unknown>,
    });

    return parsed.data;
  },

  /**
   * RN-NT1/NT2: decide si un turno debe notificarse en este momento.
   * - RN-NT2: solo turnos activos (Programado/Confirmado); Cancelado/Completado no.
   * - RN-NT1: la ventana es `0 < horasRestantes ≤ antelación` (turno futuro y dentro de antelación).
   */
  debeNotificar(turno: TurnoParaNotificar, config: ConfigNotificacionTurnosDto, now: Date): boolean {
    if (turno.status !== "Programado" && turno.status !== "Confirmado") return false;
    const cuando = new Date(`${turno.date}T${turno.startTime.slice(0, 8).padEnd(8, ":00")}Z`);
    const horasRestantes = (cuando.getTime() - now.getTime()) / 3_600_000;
    return horasRestantes > 0 && horasRestantes <= config.hoursBeforeAppointment;
  },

  /**
   * RN-NT4: canales a usar = activados en config Y con dato de contacto disponible.
   * email → requiere `email`; whatsapp/sms → requieren `phone`.
   */
  canalesDisponibles(cliente: ContactoCliente, config: ConfigNotificacionTurnosDto): Canal[] {
    const canales: Canal[] = [];
    if (config.sendEmail && cliente.email) canales.push("email");
    if (config.sendWhatsApp && cliente.phone) canales.push("whatsapp");
    if (config.sendSMS && cliente.phone) canales.push("sms");
    return canales;
  },

  /**
   * Recordatorios Automáticos de Turnos (Documento Maestro v1.0 §4, RN-NT1..NT6).
   *
   * - `opts.tenantId` presente → disparo manual de un tenant ("Verificar").
   * - `opts.tenantId` ausente → barrido de todos los tenants activos (tarea programada, RN-NT5).
   * - La idempotencia (RN-NT3) se apoya en el UNIQUE de `notificaciones`
   *   (tenant, origen, referencia_id, canal): un INSERT en conflicto = ya procesado → `skipped`.
   * - `deps.canales` permite inyectar/mokear los canales en tests (no se envía mail en CI).
   */
  async procesarRecordatoriosTurnos(
    opts: ProcesarOpts = {},
    deps: ProcesarDeps = {},
  ): Promise<ResultadoProcesamiento> {
    const db = getServiceDb();
    const now = deps.now ?? new Date();
    const canales: Partial<Record<Canal, CanalNotificacion>> =
      deps.canales ?? { email: new CanalEmailResend() };

    const result: ResultadoProcesamiento = { processed: 0, sent: 0, failed: 0, skipped: 0 };

    // Determinar el universo de tenants a procesar.
    let tenantIds: string[];
    if (opts.tenantId) {
      tenantIds = [opts.tenantId];
    } else {
      const { data: tenants } = await db.from("tenants").select("id").eq("activo", true);
      tenantIds = ((tenants as unknown[]) ?? []).map((t) => (t as Record<string, unknown>)["id"] as string);
    }

    for (const tenantId of tenantIds) {
      const config = await this.obtenerConfig(tenantId);
      if (!config.enabled) continue;

      // Acota el barrido: turnos entre hoy y now+antelación (+1 día de colchón por TZ).
      const desde = dateStr(now);
      const hasta = dateStr(new Date(now.getTime() + (config.hoursBeforeAppointment + 24) * 3_600_000));

      const { data: rows, error } = await db
        .from("turnos")
        .select(TURNO_NOTIF_SELECT)
        .eq("tenant_id", tenantId)
        .in("status", ["Programado", "Confirmado"])
        .gte("date", desde)
        .lte("date", hasta);

      if (error) {
        throw new DomainError(
          ErrorCode.INTERNAL_ERROR,
          500,
          `Error consultando turnos a notificar: ${error.message}`,
        );
      }

      for (const raw of ((rows as unknown[]) ?? [])) {
        const turno = mapTurno(raw as Record<string, unknown>);
        if (!this.debeNotificar(turno, config, now)) continue;

        result.processed++;

        const objetivo = this.canalesDisponibles(turno.cliente, config);
        if (objetivo.length === 0) {
          // RN-NT4 / flujo 3a: sin datos de contacto → se marca fallida con motivo.
          await this._registrarFallidaSinContacto(db, tenantId, "turno", turno.id);
          result.failed++;
          continue;
        }

        for (const canal of objetivo) {
          const impl = canales[canal];
          if (!impl) continue; // canal sin proveedor implementado (whatsapp/sms): diferido, no se registra.
          const outcome = await this._enviarPorCanal(db, tenantId, turno, canal, impl, now);
          result[outcome]++;
        }
      }
    }

    return result;
  },

  /**
   * RN-PV7: una dosis entra en la ventana de aviso si está `Pendiente` y
   * `0 ≤ (fechaEstimada − hoy) ≤ diasAvisoVacuna`. Puro (sin DB) para test directo.
   */
  debeAvisarVacuna(dosis: DosisParaNotificar, diasAvisoVacuna: number, now: Date): boolean {
    if (dosis.estado !== "Pendiente") return false;
    const dias = diffDias(dateStr(now), dosis.fechaEstimada);
    return dias >= 0 && dias <= diasAvisoVacuna;
  },

  /**
   * Avisos de Plan de Vacunación (Addendum v1.1, RN-PV6/PV7). Reutiliza la misma
   * infraestructura que los turnos: canales (`_enviarAviso`), registro en
   * `notificaciones` e idempotencia por el UNIQUE con `origen='vacunacion'` (RN-NT3).
   *
   * - `opts.tenantId` presente → disparo manual de un tenant; ausente → barrido de
   *   todos los activos (tarea programada; el scheduler se cablea en E9 junto con turnos).
   * - RN-PV7: la ventana es `diasAvisoVacuna` del tenant (config); cada tenant avisa en
   *   su propia ventana.
   * - RN-PV6: la idempotencia es el UNIQUE de `notificaciones` (dos corridas seguidas no
   *   reenvían: el 2.º INSERT choca → `skipped`). `plan_vacunacion.notified_at` se setea
   *   como marcador denormalizado tras el envío, NO como guardia de dedupe.
   * - Canales según datos de contacto del cliente (RN-NT4), con la misma config de canal
   *   del módulo Turnos. No se mira `enabled` (toggle de recordatorios de turnos): los
   *   avisos de vacuna se gobiernan por `diasAvisoVacuna`.
   */
  async procesarAvisosVacunacion(
    opts: ProcesarOpts = {},
    deps: ProcesarDeps = {},
  ): Promise<ResultadoProcesamiento> {
    const db = getServiceDb();
    const now = deps.now ?? new Date();
    const canales: Partial<Record<Canal, CanalNotificacion>> =
      deps.canales ?? { email: new CanalEmailResend() };

    const result: ResultadoProcesamiento = { processed: 0, sent: 0, failed: 0, skipped: 0 };

    // Determinar el universo de tenants a procesar.
    let tenantIds: string[];
    if (opts.tenantId) {
      tenantIds = [opts.tenantId];
    } else {
      const { data: tenants } = await db.from("tenants").select("id").eq("activo", true);
      tenantIds = ((tenants as unknown[]) ?? []).map((t) => (t as Record<string, unknown>)["id"] as string);
    }

    for (const tenantId of tenantIds) {
      const dias = await this._diasAvisoVacuna(tenantId); // RN-PV7
      const config = await this.obtenerConfig(tenantId);  // flags de canal (RN-NT4)

      // Acota el barrido: dosis pendientes entre hoy y hoy+ventana (usa idx_planvac_tenant_barrido).
      const desde = dateStr(now);
      const hasta = dateStr(new Date(now.getTime() + dias * 86_400_000));

      const { data: rows, error } = await db
        .from("plan_vacunacion")
        .select(PLAN_VACUNA_NOTIF_SELECT)
        .eq("tenant_id", tenantId)
        .eq("estado", "Pendiente")
        .gte("fecha_estimada", desde)
        .lte("fecha_estimada", hasta)
        .order("fecha_estimada", { ascending: true });

      if (error) {
        throw new DomainError(
          ErrorCode.INTERNAL_ERROR,
          500,
          `Error consultando dosis a notificar: ${error.message}`,
        );
      }

      for (const raw of ((rows as unknown[]) ?? [])) {
        const dosis = mapDosis(raw as Record<string, unknown>);
        if (!this.debeAvisarVacuna(dosis, dias, now)) continue;

        result.processed++;

        const objetivo = this.canalesDisponibles(dosis.cliente, config);
        if (objetivo.length === 0) {
          // Sin datos de contacto en ningún canal → fallida con motivo (RN-NT4).
          await this._registrarFallidaSinContacto(db, tenantId, "vacunacion", dosis.id);
          result.failed++;
          continue;
        }

        const mensaje = construirMensajeVacuna(dosis);
        let algunEnviado = false;
        for (const canal of objetivo) {
          const impl = canales[canal];
          if (!impl) continue; // canal sin proveedor (whatsapp/sms): diferido, no se registra.
          const destino = destinoDeCanal(canal, dosis.cliente) as string;
          const outcome = await this._enviarAviso(
            db,
            tenantId,
            {
              origen:       "vacunacion",
              referenciaId: dosis.id,
              destino,
              asunto:       mensaje.asunto,
              cuerpo:       mensaje.cuerpo,
              resumen:      mensaje.resumen,
              auditDetail:  `Aviso de vacunación enviado por ${canal} a ${destino}`,
            },
            canal,
            impl,
            now,
          );
          result[outcome]++;
          if (outcome === "sent") algunEnviado = true;
        }

        // RN-PV6: marcador denormalizado (la dedupe real es el UNIQUE, ya aplicado arriba).
        if (algunEnviado) {
          await db
            .from("plan_vacunacion")
            .update({ notified_at: now.toISOString() })
            .eq("id", dosis.id)
            .eq("tenant_id", tenantId);
        }
      }
    }

    return result;
  },

  // ─── Privados ─────────────────────────────────────────────────────────────

  /**
   * Envía un recordatorio de turno por un canal. Arma el aviso desde el turno y delega
   * el núcleo idempotente en `_enviarAviso` (compartido con los avisos de vacunación).
   */
  async _enviarPorCanal(
    db: ReturnType<typeof getServiceDb>,
    tenantId: string,
    turno: TurnoParaNotificar,
    canal: Canal,
    impl: CanalNotificacion,
    now: Date,
  ): Promise<"sent" | "failed" | "skipped"> {
    const mensaje = construirMensaje(turno);
    const destino = destinoDeCanal(canal, turno.cliente) as string;
    return this._enviarAviso(
      db,
      tenantId,
      {
        origen:       "turno",
        referenciaId: turno.id,
        destino,
        asunto:       mensaje.asunto,
        cuerpo:       mensaje.cuerpo,
        resumen:      mensaje.resumen,
        auditDetail:  `Recordatorio de turno enviado por ${canal} a ${destino}`,
      },
      canal,
      impl,
      now,
    );
  },

  /**
   * Núcleo de envío genérico con idempotencia apoyada en la DB (RN-NT3, RN-PV6):
   * un INSERT en `notificaciones` con UNIQUE(tenant, origen, referencia_id, canal).
   * Si choca (23505) → ya procesado → `skipped`. Si entra → envía, marca `enviada` y
   * audita como evento del sistema (RN-NT6). Error del proveedor → `fallida` con motivo.
   * Devuelve el contador a incrementar: 'sent' | 'failed' | 'skipped'.
   */
  async _enviarAviso(
    db: ReturnType<typeof getServiceDb>,
    tenantId: string,
    aviso: AvisoNotificacion,
    canal: Canal,
    impl: CanalNotificacion,
    now: Date,
  ): Promise<"sent" | "failed" | "skipped"> {
    const { data: ins, error: insError } = await db
      .from("notificaciones")
      .insert({
        tenant_id:     tenantId,
        origen:        aviso.origen,
        referencia_id: aviso.referenciaId,
        canal,
        estado:        "pendiente",
        mensaje:       aviso.resumen,
      })
      .select("id")
      .single();

    if (insError) {
      if (insError.code === "23505") return "skipped"; // ya notificado (RN-NT3/PV6)
      throw new DomainError(
        ErrorCode.INTERNAL_ERROR,
        500,
        `No se pudo registrar la notificación: ${insError.message}`,
      );
    }

    const notifId = (ins as Record<string, unknown>)["id"] as string;

    try {
      await impl.enviar({ destino: aviso.destino, asunto: aviso.asunto, cuerpo: aviso.cuerpo });
      await db
        .from("notificaciones")
        .update({ estado: "enviada", sent_at: now.toISOString() })
        .eq("id", notifId);

      await recordAudit(db as never, {
        tenantId,
        userId:   null,
        userName: "sistema",
        userRole: null,
        action:   "CREATE",
        module:   "system",
        entityId: aviso.referenciaId,
        details:  aviso.auditDetail,
      });
      return "sent";
    } catch (e) {
      const motivo = (e instanceof Error ? e.message : String(e)).slice(0, 500);
      await db
        .from("notificaciones")
        .update({ estado: "fallida", failure_reason: motivo })
        .eq("id", notifId);
      return "failed";
    }
  },

  /** RN-PV7: ventana de aviso del tenant (config). Default 7 si faltara la fila. */
  async _diasAvisoVacuna(tenantId: string): Promise<number> {
    const db = getServiceDb();
    const { data: row } = await db
      .from("configuracion_tenant")
      .select("dias_aviso_vacuna")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    const v = (row as Record<string, unknown> | null)?.["dias_aviso_vacuna"];
    return typeof v === "number" ? v : 7;
  },

  /** RN-NT4 (flujo 3a): registra una notificación fallida cuando no hay ningún canal con contacto. */
  async _registrarFallidaSinContacto(
    db: ReturnType<typeof getServiceDb>,
    tenantId: string,
    origen: "turno" | "vacunacion",
    referenciaId: string,
  ): Promise<void> {
    const { error } = await db.from("notificaciones").insert({
      tenant_id:      tenantId,
      origen,
      referencia_id:  referenciaId,
      canal:          "email",
      estado:         "fallida",
      failure_reason: "El cliente no tiene datos de contacto en ningún canal habilitado",
    });
    // Idempotente: si ya quedó registrada (UNIQUE), se ignora; cualquier otro error no rompe el lote.
    if (error && error.code !== "23505") {
      console.error("[notificaciones] No se pudo registrar fallida sin contacto:", error.message);
    }
  },
};
