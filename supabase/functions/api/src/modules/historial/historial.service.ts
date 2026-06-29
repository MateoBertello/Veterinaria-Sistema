import { PDFDocument, StandardFonts } from "pdf-lib";
import * as XLSX from "xlsx";
import { DomainError, ErrorCode } from "../../shared/errors.ts";
import { recordAudit } from "../../shared/audit.ts";
import { getServiceDb } from "../../shared/db.ts";
import {
  CanalEmailResend,
  type CanalNotificacion,
  type MensajeNotificacion,
} from "../../shared/notificaciones/canal-email.ts";
import {
  CrearEventoClinicoSchema,
  RegistrarEutanasiaSchema,
  type CrearEventoClinicoDto,
  type RegistrarEutanasiaDto,
} from "./historial.schemas.ts";

// ─── DTOs públicos ────────────────────────────────────────────────────────────

export interface HistorialItem {
  id:               string;
  date:             string;
  eventType:        string;
  professionalName: string | null;
  weightKg:         number | null;
  temperatureC:     number | null;
  diagnosis:        string | null;
  clientNameAtTime: string;
  isPreviousOwner:  boolean;
  hasAttachments:   boolean;
}

export interface AdjuntoMeta {
  id:       string;
  fileName: string;
  fileType: string;
  fileSize: number;
}

export interface HistorialDetalle {
  id:               string;
  petId:            string;
  date:             string;
  eventType:        string;
  professionalName: string | null;
  weightKg:         number | null;
  temperatureC:     number | null;
  description:      string;
  diagnosis:        string | null;
  treatment:        string | null;
  medication:       string | null;
  notes:            string | null;
  clientNameAtTime: string;
  createdAt:        string;
  adjuntos:         AdjuntoMeta[];
}

export interface ResumenClinico {
  id:          string;
  name:        string;
  estado:      string;
  ownerName:   string | null;
  especieName: string | null;
  razaName:    string | null;
  ultimoPeso:  number | null;
}

/** Contexto del usuario autenticado (mismo shape que servicios.service). */
export interface CallerContext {
  tenantId:     string;
  callerUserId: string;
  callerName:   string;
  callerRole:   string;
}

export interface EventoCreado {
  id:               string;
  petId:            string;
  date:             string;
  eventType:        string;
  clientNameAtTime: string;
  attachmentsCount: number;
  emailSent:        boolean;
}

/**
 * Dependencias inyectables de `crearRegistro`. Permiten mockear el canal de email
 * en los tests (sin enviar mail en CI). Por defecto usa `CanalEmailResend` (la
 * misma infraestructura de la Etapa 6c; no se duplica canal ni envío).
 */
export interface CrearRegistroDeps {
  canalEmail?: CanalNotificacion;
}

export interface AdjuntoFirmado {
  url:      string;
  fileName: string;
  fileType: string;
  fileSize: number;
}

export interface HistorialExport {
  buffer:      Uint8Array;
  contentType: string;
  filename:    string;
}

// ─── Tipos internos para export (no exportados) ──────────────────────────────

interface PetInfo {
  name:        string;
  especieName: string | null;
  razaName:    string | null;
  ownerName:   string | null;
}

interface HistorialRow {
  id:            string;
  date:          string;
  event_type:    string;
  weight_kg:     number | null;
  temperature_c: number | null;
  description:   string;
  diagnosis:     string | null;
  profesional:   { full_name: string } | null;
}

// ─── Helpers privados de export ───────────────────────────────────────────────

function norm(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function trunc(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 3) + "..." : s;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

async function buildPdf(pet: PetInfo, records: HistorialRow[]): Promise<Uint8Array> {
  const doc  = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const PW = 612, PH = 792, MX = 50, MY = 50, LINE = 15;

  let page = doc.addPage([PW, PH]);
  let y    = PH - MY;

  const draw = (text: string, size = 11, isBold = false) => {
    if (y < MY + LINE) {
      page = doc.addPage([PW, PH]);
      y    = PH - MY;
    }
    page.drawText(norm(text), { x: MX, y, size, font: isBold ? bold : font });
    y -= LINE;
  };

  // Encabezado
  draw("HISTORIAL CLINICO", 16, true);
  y -= 4;
  draw(`Mascota: ${pet.name}  |  ${pet.especieName ?? ""}/${pet.razaName ?? ""}`, 12, true);
  draw(`Dueno: ${pet.ownerName ?? "—"}`, 11);
  draw(`Generado: ${today()}   |   Total: ${records.length} registros`, 10);
  y -= 10;

  // Registros
  for (const r of records) {
    if (y < MY + 70) {
      page = doc.addPage([PW, PH]);
      y    = PH - MY;
    }
    draw(`${r.date}  —  ${r.event_type}  —  ${r.profesional?.full_name ?? "—"}`, 11, true);
    const measures: string[] = [];
    if (r.weight_kg    != null) measures.push(`Peso: ${r.weight_kg} kg`);
    if (r.temperature_c != null) measures.push(`Temp: ${r.temperature_c}C`);
    if (measures.length) draw(measures.join("  |  "), 10);
    draw(`Desc: ${trunc(r.description, 90)}`, 10);
    if (r.diagnosis) draw(`Diag: ${trunc(r.diagnosis, 90)}`, 10);
    y -= 8;
  }

  return doc.save();
}

function buildXlsx(records: HistorialRow[]): Uint8Array {
  const headers = [
    "Fecha", "Tipo", "Profesional",
    "Peso (kg)", "Temp. (C)",
    "Descripcion", "Diagnostico",
  ];
  const rows = records.map((r) => [
    r.date,
    r.event_type,
    r.profesional?.full_name ?? "",
    r.weight_kg     ?? "",
    r.temperature_c ?? "",
    r.description,
    r.diagnosis     ?? "",
  ]);
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  XLSX.utils.book_append_sheet(wb, ws, "Historial");
  return new Uint8Array(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as ArrayBuffer);
}

// ─── Eutanasia: forma de respuesta { evento, mascota } (Addendum v1.1) ──────────

export interface EventoEutanasia {
  id:               string;
  petId:            string;
  date:             string;
  eventType:        string;        // siempre 'Eutanasia'
  professionalName: string | null;
  clientNameAtTime: string;
}

export interface MascotaFallecida {
  id:             string;
  name:           string;
  estado:         string;          // siempre 'Fallecida'
  deceasedDate:   string;
  deceasedReason: string;          // siempre 'Eutanasia'
}

export interface EutanasiaResultado {
  evento:         EventoEutanasia;
  mascota:        MascotaFallecida;
  cancelledDoses: number;          // RN-PV4: dosis pendientes canceladas en la transacción
}

// ─── Adjuntos: tipos permitidos (RN-EC4) ────────────────────────────────────────

const BUCKET_ADJUNTOS = "adjuntos-clinicos";
const MAX_FILE_SIZE   = 10 * 1024 * 1024; // 10 MB
const SIGNED_URL_TTL  = 300;              // 5 min
const ALLOWED_FILE_TYPES: Record<string, string> = {
  "image/jpeg":      "jpg",
  "image/png":       "png",
  "image/gif":       "gif",
  "application/pdf": "pdf",
};

/**
 * Mapea el error de un RPC de eutanasia a DomainError. El RPC lanza
 * `RAISE EXCEPTION` con el MESSAGE igual al código de ErrorCode.
 */
function mapEutanasiaRpcError(error: { message?: string }): DomainError {
  const msg = error.message ?? "";
  if (msg.includes("EUTHANASIA_CONFIRMATION_REQUIRED"))
    return new DomainError(ErrorCode.EUTHANASIA_CONFIRMATION_REQUIRED, 422, "Se requiere confirmación explícita de la eutanasia");
  if (msg.includes("PET_DECEASED"))
    return new DomainError(ErrorCode.PET_DECEASED, 422, "La mascota ya está marcada como Fallecida");
  if (msg.includes("MASCOTA_NOT_FOUND"))
    return new DomainError(ErrorCode.MASCOTA_NOT_FOUND, 404, "Mascota no encontrada en este tenant");
  if (msg.includes("FORBIDDEN"))
    return new DomainError(ErrorCode.FORBIDDEN, 403, "El profesional no pertenece a este tenant");
  return new DomainError(ErrorCode.INTERNAL_ERROR, 500, `No se pudo registrar la eutanasia: ${msg}`);
}

// ─── Resumen clínico por email (RN-EC9) ────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Datos del evento recién creado necesarios para componer el resumen. */
interface ResumenClinicoInput {
  email:       string;
  clientName:  string;
  petName:     string | null;
  eventType:   string;
  date:        string;
  description: string;
  diagnosis:   string | null;
  treatment:   string | null;
  notes:       string | null;
}

/**
 * Compone el `MensajeNotificacion` del resumen clínico para el cliente (RN-EC9).
 * No envía nada: solo arma el contenido que consume el canal de la Etapa 6c.
 */
function construirResumenClinico(input: ResumenClinicoInput): MensajeNotificacion {
  const mascota = input.petName ?? "tu mascota";
  const asunto  = `Resumen de ${input.eventType} — ${mascota}`;

  const filas: string[] = [
    `<p>Hola ${escapeHtml(input.clientName)},</p>`,
    `<p>Te compartimos el resumen del evento clínico de <strong>${escapeHtml(mascota)}</strong>:</p>`,
    `<ul>`,
    `<li><strong>Tipo:</strong> ${escapeHtml(input.eventType)}</li>`,
    `<li><strong>Fecha:</strong> ${escapeHtml(input.date)}</li>`,
    `<li><strong>Descripción:</strong> ${escapeHtml(input.description)}</li>`,
  ];
  if (input.diagnosis) filas.push(`<li><strong>Diagnóstico:</strong> ${escapeHtml(input.diagnosis)}</li>`);
  if (input.treatment) filas.push(`<li><strong>Tratamiento:</strong> ${escapeHtml(input.treatment)}</li>`);
  if (input.notes)     filas.push(`<li><strong>Notas:</strong> ${escapeHtml(input.notes)}</li>`);
  filas.push(`</ul>`);

  return { destino: input.email, asunto, cuerpo: filas.join("") };
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class HistorialService {
  /**
   * RN-HC1: eventos ordenados por fecha descendente.
   * RN-HC3: isPreviousOwner derivado comparando client_id_at_time con dueño actual.
   * Sin N+1: una sola query con embeds de profesional, mascota (client_id) y count de adjuntos.
   */
  static async listarHistorial(
    petId:    string,
    tenantId: string,
    opts:     { page: number; limit: number },
  ): Promise<{ items: HistorialItem[]; total: number }> {
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
      .from("historial_clinico")
      .select(
        `id, date, event_type, weight_kg, temperature_c,
         diagnosis, description, client_name_at_time, client_id_at_time,
         profesional:usuarios!professional_id(full_name),
         mascota:mascotas!pet_id(client_id),
         adjuntos:adjuntos_medicos(count)`,
        { count: "exact" },
      )
      .eq("tenant_id", tenantId)
      .eq("pet_id", petId)
      .eq("deleted", false)
      .order("date", { ascending: false })
      .range(from, to);

    if (error) {
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, "Error al consultar historial");
    }

    // deno-lint-ignore no-explicit-any
    const items: HistorialItem[] = (data ?? []).map((row: any) => ({
      id:               row.id,
      date:             row.date,
      eventType:        row.event_type,
      professionalName: row.profesional?.full_name ?? null,
      weightKg:         row.weight_kg ?? null,
      temperatureC:     row.temperature_c ?? null,
      diagnosis:        row.diagnosis ?? null,
      clientNameAtTime: row.client_name_at_time,
      isPreviousOwner:  row.client_id_at_time !== row.mascota?.client_id,
      hasAttachments:   (row.adjuntos?.[0]?.count ?? 0) > 0,
    }));

    return { items, total: count ?? 0 };
  }

  /**
   * Devuelve el detalle completo de un evento clínico.
   * El aislamiento de tenant se garantiza via filtro explícito (getServiceDb bypasea RLS).
   */
  static async obtenerEventoPorId(
    id:       string,
    tenantId: string,
  ): Promise<HistorialDetalle> {
    const db = getServiceDb();

    const { data, error } = await db
      .from("historial_clinico")
      .select(
        `id, pet_id, date, event_type, weight_kg, temperature_c,
         description, diagnosis, treatment, medication, notes,
         client_name_at_time, created_at,
         profesional:usuarios!professional_id(full_name),
         adjuntos:adjuntos_medicos(id, file_name, file_type, file_size)`,
      )
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .eq("deleted", false)
      .maybeSingle();

    if (error) {
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, "Error al consultar evento clínico");
    }
    if (!data) {
      throw new DomainError(ErrorCode.HISTORIAL_NOT_FOUND, 404, "Registro clínico no encontrado");
    }

    // deno-lint-ignore no-explicit-any
    return {
      id:               data.id,
      petId:            data.pet_id,
      date:             data.date,
      eventType:        data.event_type,
      professionalName: (data as any).profesional?.full_name ?? null,
      weightKg:         data.weight_kg ?? null,
      temperatureC:     data.temperature_c ?? null,
      description:      data.description,
      diagnosis:        data.diagnosis ?? null,
      treatment:        data.treatment ?? null,
      medication:       data.medication ?? null,
      notes:            data.notes ?? null,
      clientNameAtTime: data.client_name_at_time,
      createdAt:        data.created_at,
      // deno-lint-ignore no-explicit-any
      adjuntos: ((data as any).adjuntos ?? []).map((a: any) => ({
        id:       a.id,
        fileName: a.file_name,
        fileType: a.file_type,
        fileSize: a.file_size,
      })),
    };
  }

  /**
   * RN-HC2: ultimoPeso derivado del evento más reciente que tenga weight_kg.
   * Usa 2 queries escalares (no N+1): mascota + último peso.
   */
  static async resumenClinico(
    petId:    string,
    tenantId: string,
  ): Promise<ResumenClinico> {
    const db = getServiceDb();

    const { data: mascota } = await db
      .from("mascotas")
      .select(
        `id, name, estado,
         cliente:clientes!client_id(full_name),
         especie:especies!especie_id(name),
         raza:razas!raza_id(name)`,
      )
      .eq("id", petId)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (!mascota) {
      throw new DomainError(ErrorCode.MASCOTA_NOT_FOUND, 404, "Mascota no encontrada");
    }

    // RN-HC2: último registro clínico con peso registrado
    const { data: lastWeightRow } = await db
      .from("historial_clinico")
      .select("weight_kg")
      .eq("pet_id", petId)
      .eq("tenant_id", tenantId)
      .eq("deleted", false)
      .not("weight_kg", "is", null)
      .order("date", { ascending: false })
      .limit(1)
      .maybeSingle();

    // deno-lint-ignore no-explicit-any
    const m = mascota as any;
    return {
      id:          m.id,
      name:        m.name,
      estado:      m.estado,
      ownerName:   m.cliente?.full_name ?? null,
      especieName: m.especie?.name ?? null,
      razaName:    m.raza?.name ?? null,
      // deno-lint-ignore no-explicit-any
      ultimoPeso:  (lastWeightRow as any)?.weight_kg ?? null,
    };
  }

  /**
   * Registrar Evento Clínico (RN-EC1, RN-EC3, RN-EC5, RN-EC6, RN-EC8, RN-EC9).
   * Eutanasia y proximaDosis quedan fuera de esta sesión (ver schema).
   */
  static async crearRegistro(
    petId: string,
    dto:   CrearEventoClinicoDto,
    ctx:   CallerContext,
    deps:  CrearRegistroDeps = {},
  ): Promise<EventoCreado> {
    // RN-EC1/RN-EC6: defense-in-depth (el Controller ya validó con Zod).
    const parsed = CrearEventoClinicoSchema.safeParse(dto);
    if (!parsed.success) {
      throw new DomainError(
        ErrorCode.VALIDATION_ERROR,
        422,
        "Datos del evento clínico inválidos",
        parsed.error.issues,
      );
    }
    const data = parsed.data;

    const db = getServiceDb();

    // Una sola query: mascota del tenant + dueño actual (RN-EC5, sin N+1).
    const { data: mascota } = await db
      .from("mascotas")
      .select("id, name, estado, client_id, cliente:clientes!client_id(full_name, email)")
      .eq("id", petId)
      .eq("tenant_id", ctx.tenantId)
      .maybeSingle();

    if (!mascota) {
      throw new DomainError(ErrorCode.MASCOTA_NOT_FOUND, 404, "Mascota no encontrada");
    }

    // deno-lint-ignore no-explicit-any
    const m = mascota as any;

    // RN-EC3: no se permiten registros en mascotas fallecidas.
    if (m.estado === "Fallecida") {
      throw new DomainError(
        ErrorCode.PET_DECEASED,
        422,
        "No se pueden agregar eventos clínicos a una mascota fallecida",
      );
    }

    const clientNameAtTime = m.cliente?.full_name ?? null;
    if (!m.client_id || !clientNameAtTime) {
      throw new DomainError(
        ErrorCode.INTERNAL_ERROR,
        500,
        "La mascota no tiene un dueño vigente para registrar el evento",
      );
    }

    const payload = {
      tenant_id:           ctx.tenantId,
      pet_id:              petId,
      professional_id:     data.professionalId,
      date:                data.date,
      event_type:          data.eventType,
      description:         data.description,
      weight_kg:           data.weightKg     ?? null,
      temperature_c:       data.temperatureC ?? null,
      diagnosis:           data.diagnosis    ?? null,
      treatment:           data.treatment    ?? null,
      medication:          data.medication   ?? null,
      notes:               data.notes        ?? null,
      client_id_at_time:   m.client_id,        // RN-EC5
      client_name_at_time: clientNameAtTime,   // RN-EC5
    };

    const { data: row, error } = await db
      .from("historial_clinico")
      .insert(payload)
      .select("id, date, event_type")
      .single();

    if (error || !row) {
      throw new DomainError(
        ErrorCode.INTERNAL_ERROR,
        500,
        `No se pudo registrar el evento clínico: ${error?.message ?? ""}`,
      );
    }

    // deno-lint-ignore no-explicit-any
    const created = row as any;

    // RN-EC8: auditoría CREATE en módulo medical_records.
    await recordAudit(db as never, {
      tenantId:  ctx.tenantId,
      userId:    ctx.callerUserId,
      userName:  ctx.callerName,
      userRole:  ctx.callerRole,
      action:    "CREATE",
      module:    "medical_records",
      entityId:  created.id,
      newValues: payload as Record<string, unknown>,
    });

    // RN-EC9: envío real del resumen al cliente, reutilizando el canal de la Etapa 6c.
    // Best-effort: el evento clínico YA está registrado (insert + auditoría arriba),
    // así que un email caído NUNCA tumba el flujo clínico. `emailSent` refleja la
    // ENTREGA lograda (true solo si el canal devolvió OK).
    let emailSent = false;
    if (data.sendEmailToClient === true && m.cliente?.email) {
      const canalEmail = deps.canalEmail ?? new CanalEmailResend();
      try {
        await canalEmail.enviar(
          construirResumenClinico({
            email:       m.cliente.email,
            clientName:  clientNameAtTime,
            petName:     m.name ?? null,
            eventType:   data.eventType,
            date:        data.date,
            description: data.description,
            diagnosis:   data.diagnosis ?? null,
            treatment:   data.treatment ?? null,
            notes:       data.notes ?? null,
          }),
        );
        emailSent = true;

        // Auditoría del envío exitoso (tenant del JWT), sin intervención del usuario.
        await recordAudit(db as never, {
          tenantId: ctx.tenantId,
          userId:   ctx.callerUserId,
          userName: ctx.callerName,
          userRole: ctx.callerRole,
          action:   "CREATE",
          module:   "medical_records",
          entityId: created.id,
          details:  `Resumen clínico enviado por email a ${m.cliente.email}`,
        });
      } catch (e) {
        // Mismo criterio que el procesador de turnos: el fallo de email no rompe el
        // flujo; se registra para observabilidad y se deja emailSent en false.
        const motivo = (e instanceof Error ? e.message : String(e)).slice(0, 500);
        console.error("[historial] Falló el envío del resumen clínico:", motivo);
      }
    }

    return {
      id:               created.id,
      petId,
      date:             created.date,
      eventType:        created.event_type,
      clientNameAtTime,
      attachmentsCount: 0,
      emailSent,
    };
  }

  /**
   * Registrar Eutanasia — la ÚNICA operación irreversible (CLAUDE.md regla 8).
   *
   * RN-EC10: exige confirmación explícita (código EUTHANASIA_CONFIRMATION_REQUIRED).
   * RN-EC11: TODO (evento + estado='Fallecida' + cancelación de dosis pendientes
   *          RN-PV4) se persiste en UNA sola transacción vía RPC `registrar_eutanasia`.
   *          El Service NO escribe por partes: delega la transacción completa al RPC,
   *          por lo que un fallo no puede dejar la mascota "media muerta" (rollback total).
   * RN-EC12: no existe método inverso; revertir 'Fallecida' es soporte manual.
   */
  static async registrarEutanasia(
    petId: string,
    dto:   RegistrarEutanasiaDto,
    ctx:   CallerContext,
  ): Promise<EutanasiaResultado> {
    const parsed = RegistrarEutanasiaSchema.safeParse(dto);
    if (!parsed.success) {
      throw new DomainError(
        ErrorCode.VALIDATION_ERROR,
        422,
        "Datos de eutanasia inválidos",
        parsed.error.issues,
      );
    }
    const data = parsed.data;

    // RN-EC10: la confirmación de UI no sustituye la validación de backend.
    // Se valida ANTES de tocar la base (no se inicia ninguna transacción sin flag).
    if (data.euthanasiaConfirmed !== true) {
      throw new DomainError(
        ErrorCode.EUTHANASIA_CONFIRMATION_REQUIRED,
        422,
        "Se requiere confirmación explícita para registrar una eutanasia",
      );
    }

    const db = getServiceDb();

    // RN-EC11: transacción atómica única. p_tenant_id SIEMPRE del JWT (regla 1).
    // RN-S3: el asiento de auditoría se hace DENTRO del RPC (atómico con la
    // operación irreversible, no best-effort); por eso se pasa p_user_id (el
    // usuario que ejecuta) y aquí NO se llama a recordAudit.
    const { data: row, error } = await db
      .rpc("registrar_eutanasia", {
        p_tenant_id:       ctx.tenantId,
        p_pet_id:          petId,
        p_professional_id: data.professionalId,
        p_user_id:         ctx.callerUserId,
        p_date:            data.date,
        p_description:     data.description,
        p_confirmed:       true,
        p_weight_kg:       data.weightKg     ?? null,
        p_temperature_c:   data.temperatureC ?? null,
        p_diagnosis:       data.diagnosis    ?? null,
        p_notes:           data.notes        ?? null,
      })
      .single();

    if (error) throw mapEutanasiaRpcError(error);
    if (!row) {
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, "El RPC de eutanasia no devolvió resultado");
    }

    // deno-lint-ignore no-explicit-any
    const r = row as any;

    return {
      evento: {
        id:               r.event_id,
        petId:            r.pet_id,
        date:             r.date,
        eventType:        r.event_type,
        professionalName: r.professional_name ?? null,
        clientNameAtTime: r.client_name_at_time,
      },
      mascota: {
        id:             r.pet_id,
        name:           r.mascota_name,
        estado:         r.mascota_estado,
        deceasedDate:   r.deceased_date,
        deceasedReason: r.deceased_reason,
      },
      cancelledDoses: r.cancelled_doses ?? 0,
    };
  }

  /**
   * Adjuntar archivo a un evento clínico (RN-EC4).
   * Sube a Supabase Storage (bucket privado) con path por tenant y registra el
   * metadato en `adjuntos_medicos`.
   */
  static async adjuntarArchivo(
    recordId: string,
    file:     File,
    ctx:      CallerContext,
  ): Promise<AdjuntoMeta> {
    // RN-EC4: tipo permitido.
    const ext = ALLOWED_FILE_TYPES[file.type];
    if (!ext) {
      throw new DomainError(
        ErrorCode.INVALID_FILE_TYPE,
        422,
        "Tipo de archivo no permitido. Solo JPG, PNG, GIF o PDF",
      );
    }
    // RN-EC4: tamaño máximo 10 MB.
    if (file.size > MAX_FILE_SIZE) {
      throw new DomainError(
        ErrorCode.FILE_TOO_LARGE,
        422,
        "El archivo supera el tamaño máximo permitido de 10 MB",
      );
    }

    const db = getServiceDb();

    // El registro debe existir y pertenecer al tenant (aislamiento).
    const { data: evento } = await db
      .from("historial_clinico")
      .select("id")
      .eq("id", recordId)
      .eq("tenant_id", ctx.tenantId)
      .eq("deleted", false)
      .maybeSingle();

    if (!evento) {
      throw new DomainError(ErrorCode.HISTORIAL_NOT_FOUND, 404, "Registro clínico no encontrado");
    }

    // Path con prefijo de tenant: lo exigen las policies de storage.objects.
    const storagePath = `${ctx.tenantId}/${recordId}/${crypto.randomUUID()}.${ext}`;

    const { error: uploadError } = await db.storage
      .from(BUCKET_ADJUNTOS)
      .upload(storagePath, file, { contentType: file.type, upsert: false });

    if (uploadError) {
      throw new DomainError(
        ErrorCode.INTERNAL_ERROR,
        500,
        `No se pudo subir el adjunto: ${uploadError.message}`,
      );
    }

    const adjuntoPayload = {
      tenant_id:         ctx.tenantId,
      medical_record_id: recordId,
      file_name:         file.name,
      file_type:         file.type,
      file_size:         file.size,
      storage_path:      storagePath,
    };

    const { data: row, error } = await db
      .from("adjuntos_medicos")
      .insert(adjuntoPayload)
      .select("id, file_name, file_type, file_size")
      .single();

    if (error || !row) {
      // Limpieza best-effort: si falla el insert, borrar el objeto subido.
      await db.storage.from(BUCKET_ADJUNTOS).remove([storagePath]);
      throw new DomainError(
        ErrorCode.INTERNAL_ERROR,
        500,
        `No se pudo registrar el adjunto: ${error?.message ?? ""}`,
      );
    }

    // deno-lint-ignore no-explicit-any
    const a = row as any;

    await recordAudit(db as never, {
      tenantId:  ctx.tenantId,
      userId:    ctx.callerUserId,
      userName:  ctx.callerName,
      userRole:  ctx.callerRole,
      action:    "CREATE",
      module:    "medical_records",
      entityId:  a.id,
      newValues: adjuntoPayload as Record<string, unknown>,
    });

    return {
      id:       a.id,
      fileName: a.file_name,
      fileType: a.file_type,
      fileSize: a.file_size,
    };
  }

  /**
   * Genera una signed URL para descargar un adjunto (RN-EC4: bucket privado).
   * Verifica que el adjunto pertenezca al tenant antes de firmar (aislamiento).
   */
  static async generarSignedUrlAdjunto(
    adjuntoId: string,
    ctx:       CallerContext,
  ): Promise<AdjuntoFirmado> {
    const db = getServiceDb();

    const { data: adjunto } = await db
      .from("adjuntos_medicos")
      .select("storage_path, file_name, file_type, file_size")
      .eq("id", adjuntoId)
      .eq("tenant_id", ctx.tenantId)
      .eq("deleted", false)
      .maybeSingle();

    if (!adjunto) {
      throw new DomainError(ErrorCode.HISTORIAL_NOT_FOUND, 404, "Adjunto no encontrado");
    }

    // deno-lint-ignore no-explicit-any
    const a = adjunto as any;

    const { data: signed, error } = await db.storage
      .from(BUCKET_ADJUNTOS)
      .createSignedUrl(a.storage_path, SIGNED_URL_TTL);

    if (error || !signed?.signedUrl) {
      throw new DomainError(
        ErrorCode.INTERNAL_ERROR,
        500,
        `No se pudo generar la URL del adjunto: ${error?.message ?? ""}`,
      );
    }

    return {
      url:      signed.signedUrl,
      fileName: a.file_name,
      fileType: a.file_type,
      fileSize: a.file_size,
    };
  }

  /**
   * Exportar historial clínico como PDF o XLSX (RN-EX1..EX5).
   * RN-EX1: lanza EMPTY_HISTORY si no hay registros.
   * RN-EX2/EX3: genera PDF con maquetado o XLSX con columnas fijas.
   * RN-EX4: registra auditoría EXPORT en medical_records.
   * RN-EX5: permiso view_medical_history lo aplica el controller (middleware).
   */
  static async exportarHistorial(
    petId:  string,
    format: "pdf" | "xlsx",
    ctx:    CallerContext,
  ): Promise<HistorialExport> {
    const db = getServiceDb();

    // Una sola query para datos de la mascota (con especie, raza y dueño actual).
    const { data: mascota } = await db
      .from("mascotas")
      .select(
        "id, name, especie:especies!especie_id(name), raza:razas!raza_id(name), cliente:clientes!client_id(full_name)",
      )
      .eq("id", petId)
      .eq("tenant_id", ctx.tenantId)
      .maybeSingle();

    if (!mascota) {
      throw new DomainError(ErrorCode.MASCOTA_NOT_FOUND, 404, "Mascota no encontrada");
    }

    // deno-lint-ignore no-explicit-any
    const m = mascota as any;
    const pet: PetInfo = {
      name:        m.name,
      especieName: m.especie?.name ?? null,
      razaName:    m.raza?.name    ?? null,
      ownerName:   m.cliente?.full_name ?? null,
    };

    // Todos los registros del historial (sin paginación, export completo).
    // Sin N+1: query única con embed de profesional.
    const { data: records, error } = await db
      .from("historial_clinico")
      .select(
        "id, date, event_type, weight_kg, temperature_c, description, diagnosis, profesional:usuarios!professional_id(full_name)",
      )
      .eq("tenant_id", ctx.tenantId)
      .eq("pet_id", petId)
      .eq("deleted", false)
      .order("date", { ascending: false });

    if (error) {
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, "Error al consultar el historial");
    }

    // RN-EX1: no exportar historial vacío.
    if (!records || records.length === 0) {
      throw new DomainError(ErrorCode.EMPTY_HISTORY, 400, "El historial está vacío; no hay nada para exportar");
    }

    const rows = records as unknown as HistorialRow[];
    const date = today();

    let buffer:      Uint8Array;
    let contentType: string;
    let filename:    string;

    if (format === "pdf") {
      buffer      = await buildPdf(pet, rows);
      contentType = "application/pdf";
      filename    = `historial-${petId}-${date}.pdf`;
    } else {
      buffer      = buildXlsx(rows);
      contentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      filename    = `historial-${petId}-${date}.xlsx`;
    }

    // RN-EX4: auditoría EXPORT.
    await recordAudit(db as never, {
      tenantId:  ctx.tenantId,
      userId:    ctx.callerUserId,
      userName:  ctx.callerName,
      userRole:  ctx.callerRole,
      action:    "EXPORT",
      module:    "medical_records",
      entityId:  petId,
    });

    return { buffer, contentType, filename };
  }
}
