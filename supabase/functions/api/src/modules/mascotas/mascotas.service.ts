import type { SupabaseClient } from "@supabase/supabase-js";
import { DomainError, ErrorCode } from "../../shared/errors.ts";
import { recordAudit } from "../../shared/audit.ts";
import { getServiceDb } from "../../shared/db.ts";
import { sanitizeLikeTerm } from "../../shared/sanitize.ts";
import {
  CrearMascotaSchema,
  EditarMascotaSchema,
  CambiarDuenoSchema,
  MarcarFallecidaSchema,
  type CrearMascotaDto,
  type EditarMascotaDto,
  type CambiarDuenoDto,
  type MarcarFallecidaDto,
} from "./mascotas.schemas.ts";

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface CallerContext {
  tenantId:     string;
  callerUserId: string;
  callerName:   string;
  callerRole:   string;
}

export interface MascotaPublica {
  id:            string;
  name:          string;
  clientId:      string;
  ownerName:     string | null;
  especieId:     string;
  especieName:   string | null;
  razaId:        string | null;
  razaName:      string | null;
  sex:           string;
  tamano:        string;
  alimentoDieta: string | null;
  birthDate:     string | null;
  color:         string | null;
  observations:  string | null;
  estado:        string;
  // RN-MF4: marca de fallecimiento (badge/indicador); null mientras está activa.
  deceasedDate:   string | null;
  deceasedReason: string | null;
  // RN-MA3: el último peso vive en el Historial Clínico (Etapa 5); aún no se adjunta.
  ultimoPeso:    number | null;
  createdAt:     string;
}

/** Una línea del historial de cambios de dueño (RN-CD2). */
export interface CambioDuenoPublico {
  id:                 string;
  petId:              string;
  previousClientId:   string;
  previousClientName: string | null;
  newClientId:        string;
  newClientName:      string | null;
  changeDate:         string;
  reason:             string | null;
  notes:              string | null;
}

/** Resultado de una transferencia de dueño (RN-CD). */
export interface CambioDuenoResultado {
  petId:              string;
  previousClientName: string | null;
  newClientName:      string | null;
  changeDate:         string;
}

export interface ListarOpts {
  page:       number;
  limit:      number;
  search?:    string;
  clientId?:  string;
  especieId?: string;
  estado?:    "Activa" | "Fallecida";
  edadCat?:   "cachorro" | "adulto" | "senior";
}

// RN-MA9: fallback de dieta cuando no se informa.
const DIETA_FALLBACK = "Sin indicaciones de dieta";

// Listado/detalle resuelven dueño y catálogos en una sola consulta (embed; sin N+1).
const COLS =
  "id, name, client_id, especie_id, raza_id, sex, tamano, alimento_dieta, birth_date, color, observations, estado, deceased_date, deceased_reason, created_at, " +
  "cliente:clientes(full_name), especie:especies(name), raza:razas(name)";

// ─── Helpers internos ─────────────────────────────────────────────────────────

function embeddedName(value: unknown): string | null {
  if (!value) return null;
  const obj = Array.isArray(value) ? value[0] : value;
  return (obj as { name?: string; full_name?: string })?.name ??
    (obj as { full_name?: string })?.full_name ?? null;
}

/** Mapea una fila snake_case (con embeds) al DTO camelCase. */
function toPublic(row: Record<string, unknown>): MascotaPublica {
  return {
    id:            row["id"] as string,
    name:          row["name"] as string,
    clientId:      row["client_id"] as string,
    ownerName:     embeddedName(row["cliente"]),
    especieId:     row["especie_id"] as string,
    especieName:   embeddedName(row["especie"]),
    razaId:        (row["raza_id"] as string | null) ?? null,
    razaName:      embeddedName(row["raza"]),
    sex:           row["sex"] as string,
    tamano:        row["tamano"] as string,
    alimentoDieta: (row["alimento_dieta"] as string | null) ?? null,
    birthDate:     (row["birth_date"] as string | null) ?? null,
    color:         (row["color"] as string | null) ?? null,
    observations:  (row["observations"] as string | null) ?? null,
    estado:        row["estado"] as string,
    deceasedDate:   (row["deceased_date"] as string | null) ?? null,
    deceasedReason: (row["deceased_reason"] as string | null) ?? null,
    ultimoPeso:    null,
    createdAt:     row["created_at"] as string,
  };
}

/**
 * Mapea el error de un RPC de negocio a DomainError. El RPC lanza
 * `RAISE EXCEPTION` con el MESSAGE igual al código de ErrorCode.
 */
function mapRpcError(error: { message?: string }): DomainError {
  const msg = error.message ?? "";
  if (msg.includes("SAME_OWNER"))        return new DomainError(ErrorCode.SAME_OWNER, 422, "El nuevo dueño debe ser distinto del actual");
  if (msg.includes("PET_DECEASED"))      return new DomainError(ErrorCode.PET_DECEASED, 422, "La mascota está marcada como Fallecida");
  if (msg.includes("MASCOTA_NOT_FOUND")) return new DomainError(ErrorCode.MASCOTA_NOT_FOUND, 404, "Mascota no encontrada en este tenant");
  if (msg.includes("FORBIDDEN"))         return new DomainError(ErrorCode.FORBIDDEN, 403, "Cliente no encontrado en este tenant");
  return new DomainError(ErrorCode.INTERNAL_ERROR, 500, `Cambio de dueño falló: ${msg}`);
}

function validationError(parsed: { error: { issues?: unknown[] } }): never {
  throw new DomainError(
    ErrorCode.VALIDATION_ERROR,
    422,
    "Datos de mascota inválidos",
    parsed.error.issues ?? (parsed.error as { errors?: unknown[] }).errors ?? [],
  );
}

/** El cliente debe existir, pertenecer al tenant y no estar eliminado (FK + aislamiento). */
async function assertClienteDelTenant(
  db: SupabaseClient,
  clientId: string,
  tenantId: string,
): Promise<void> {
  const { data } = await db
    .from("clientes")
    .select("id")
    .eq("id", clientId)
    .eq("tenant_id", tenantId)
    .eq("deleted", false)
    .maybeSingle();

  if (!data) {
    throw new DomainError(ErrorCode.FORBIDDEN, 403, "Cliente no encontrado en este tenant");
  }
}

/** RN-MA2: la raza debe pertenecer a la especie seleccionada (catálogo global). */
async function assertRazaDeEspecie(
  db: SupabaseClient,
  razaId: string,
  especieId: string,
): Promise<void> {
  const { data } = await db
    .from("razas")
    .select("id")
    .eq("id", razaId)
    .eq("especie_id", especieId)
    .maybeSingle();

  if (!data) {
    throw new DomainError(
      ErrorCode.VALIDATION_ERROR,
      422,
      "La raza no pertenece a la especie seleccionada",
    );
  }
}

// ─── MascotasService ────────────────────────────────────────────────────────────

export const MascotasService = {
  /** Registrar Mascota (RN-MA1, RN-MA2, RN-MA8, RN-MA9, RN-MA10, RN-MA7). */
  async crear(dto: CrearMascotaDto, ctx: CallerContext): Promise<MascotaPublica> {
    const parsed = CrearMascotaSchema.safeParse(dto);
    if (!parsed.success) validationError(parsed);
    const data = parsed.data;
    const db   = getServiceDb() as unknown as SupabaseClient;

    // FK + aislamiento: el dueño debe ser un cliente vivo del mismo tenant.
    await assertClienteDelTenant(db, data.clientId, ctx.tenantId);

    // RN-MA2: coherencia raza/especie (solo si se informó raza).
    if (data.razaId) {
      await assertRazaDeEspecie(db, data.razaId, data.especieId);
    }

    const insertPayload = {
      tenant_id:      ctx.tenantId,
      name:           data.name,
      client_id:      data.clientId,
      especie_id:     data.especieId,
      raza_id:        data.razaId ?? null,
      sex:            data.sex,
      tamano:         data.tamano, // RN-MA8: validado por el ENUM del schema.
      alimento_dieta: data.alimentoDieta?.trim() ? data.alimentoDieta : DIETA_FALLBACK, // RN-MA9
      birth_date:     data.birthDate ?? null,
      color:          data.color ?? null,
      observations:   data.observations ?? null,
      // RN-MA10: estado lo fija el DEFAULT 'Activa' del ENUM estado_mascota.
    };

    const { data: row, error } = await db
      .from("mascotas")
      .insert(insertPayload)
      .select(COLS)
      .single();

    if (error || !row) {
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, `No se pudo crear la mascota: ${error?.message ?? ""}`);
    }

    // RN-MA7: auditoría CREATE en módulo pets.
    await recordAudit(db, {
      tenantId:  ctx.tenantId,
      userId:    ctx.callerUserId,
      userName:  ctx.callerName,
      userRole:  ctx.callerRole,
      action:    "CREATE",
      module:    "pets",
      entityId:  (row as unknown as Record<string, unknown>)["id"] as string,
      newValues: insertPayload as Record<string, unknown>,
    });

    return toPublic(row as unknown as Record<string, unknown>);
  },

  /** Editar Mascota (RN-MA4 birthDate inmutable; cambio de dueño fuera de alcance; RN-MA7). */
  async editar(id: string, dto: EditarMascotaDto, ctx: CallerContext): Promise<MascotaPublica> {
    const parsed = EditarMascotaSchema.safeParse(dto);
    if (!parsed.success) validationError(parsed);
    const data = parsed.data;
    const db   = getServiceDb() as unknown as SupabaseClient;

    // La mascota debe existir, pertenecer al tenant y no estar eliminada.
    const { data: actual } = await db
      .from("mascotas")
      .select("*")
      .eq("id", id)
      .eq("tenant_id", ctx.tenantId)
      .eq("deleted", false)
      .maybeSingle();

    if (!actual) {
      throw new DomainError(ErrorCode.MASCOTA_NOT_FOUND, 404, "Mascota no encontrada en este tenant");
    }

    // RN-MA2: si cambia la raza, revalidar contra la especie efectiva.
    if (data.razaId) {
      const especieId = data.especieId ?? (actual as Record<string, unknown>)["especie_id"] as string;
      await assertRazaDeEspecie(db, data.razaId, especieId);
    }

    const updatePayload: Record<string, unknown> = {};
    if (data.name         !== undefined) updatePayload["name"]           = data.name;
    if (data.especieId    !== undefined) updatePayload["especie_id"]     = data.especieId;
    if (data.razaId       !== undefined) updatePayload["raza_id"]        = data.razaId;
    if (data.sex          !== undefined) updatePayload["sex"]            = data.sex;
    if (data.tamano       !== undefined) updatePayload["tamano"]         = data.tamano;
    if (data.alimentoDieta !== undefined) {
      updatePayload["alimento_dieta"] = data.alimentoDieta?.trim() ? data.alimentoDieta : DIETA_FALLBACK; // RN-MA9
    }
    if (data.color        !== undefined) updatePayload["color"]          = data.color;
    if (data.observations !== undefined) updatePayload["observations"]   = data.observations;
    // RN-MA4: birth_date nunca se incluye (el schema lo omite).

    const { data: row, error } = await db
      .from("mascotas")
      .update(updatePayload)
      .eq("id", id)
      .eq("tenant_id", ctx.tenantId)
      .select(COLS)
      .single();

    if (error) {
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, error.message);
    }

    // RN-MA7: auditoría UPDATE en módulo pets.
    await recordAudit(db, {
      tenantId:  ctx.tenantId,
      userId:    ctx.callerUserId,
      userName:  ctx.callerName,
      userRole:  ctx.callerRole,
      action:    "UPDATE",
      module:    "pets",
      entityId:  id,
      oldValues: actual as Record<string, unknown>,
      newValues: updatePayload,
    });

    return toPublic((row ?? { ...(actual as Record<string, unknown>), ...updatePayload }) as unknown as Record<string, unknown>);
  },

  /** Detalle de una mascota del tenant (excluye eliminadas). */
  async obtenerPorId(id: string, tenantId: string): Promise<MascotaPublica | null> {
    const db = getServiceDb();
    const { data } = await db
      .from("mascotas")
      .select(COLS)
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .eq("deleted", false)
      .single();

    return data ? toPublic(data as unknown as Record<string, unknown>) : null;
  },

  /** Listar/buscar mascotas del tenant; excluye eliminadas por defecto (embed del dueño). */
  async listar(tenantId: string, opts: ListarOpts): Promise<{ items: MascotaPublica[]; total: number }> {
    const db     = getServiceDb();
    const offset = (opts.page - 1) * opts.limit;

    let query = db
      .from("mascotas")
      .select(COLS, { count: "exact" })
      .eq("tenant_id", tenantId)
      .eq("deleted", false);

    if (opts.clientId) {
      query = query.eq("client_id", opts.clientId);
    }

    if (opts.especieId) {
      query = query.eq("especie_id", opts.especieId);
    }

    if (opts.estado) {
      query = query.eq("estado", opts.estado);
    }

    if (opts.edadCat) {
      // Convención de presentación UI — no es una RN del Documento Maestro v1.0/v1.1.
      // Cortes: cachorro < 1 año | adulto 1–7 años | senior > 7 años.
      // Mascotas sin birthDate quedan excluidas de este filtro (comportamiento correcto).
      const hoy   = new Date();
      const y1ago = new Date(hoy); y1ago.setFullYear(hoy.getFullYear() - 1);
      const y7ago = new Date(hoy); y7ago.setFullYear(hoy.getFullYear() - 7);
      if (opts.edadCat === "cachorro") {
        query = query.gte("birth_date", y1ago.toISOString().slice(0, 10));
      } else if (opts.edadCat === "adulto") {
        query = query
          .lt("birth_date",  y1ago.toISOString().slice(0, 10))
          .gte("birth_date", y7ago.toISOString().slice(0, 10));
      } else {
        query = query.lt("birth_date", y7ago.toISOString().slice(0, 10));
      }
    }

    if (opts.search) {
      const term = sanitizeLikeTerm(opts.search);
      query = query.ilike("name", `%${term}%`);
    }

    const { data, error, count } = await query
      .order("created_at", { ascending: false })
      .range(offset, offset + opts.limit - 1);

    if (error) {
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, error.message);
    }

    const items = ((data as unknown[]) ?? []).map((r) => toPublic(r as Record<string, unknown>));
    return { items, total: count ?? 0 };
  },

  /** Eliminar Mascota — baja lógica (RN-MA6). */
  async eliminar(id: string, ctx: CallerContext): Promise<{ id: string; deleted: true }> {
    const db = getServiceDb() as unknown as SupabaseClient;

    const { data: actual } = await db
      .from("mascotas")
      .select("id, name, deleted")
      .eq("id", id)
      .eq("tenant_id", ctx.tenantId)
      .eq("deleted", false)
      .maybeSingle();

    if (!actual) {
      throw new DomainError(ErrorCode.MASCOTA_NOT_FOUND, 404, "Mascota no encontrada en este tenant");
    }

    const { error } = await db
      .from("mascotas")
      .update({ deleted: true })
      .eq("id", id)
      .eq("tenant_id", ctx.tenantId)
      .select("id")
      .maybeSingle();

    if (error) {
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, error.message);
    }

    // RN-MA7: auditoría DELETE en módulo pets.
    await recordAudit(db, {
      tenantId:  ctx.tenantId,
      userId:    ctx.callerUserId,
      userName:  ctx.callerName,
      userRole:  ctx.callerRole,
      action:    "DELETE",
      module:    "pets",
      entityId:  id,
      oldValues: actual as Record<string, unknown>,
    });

    return { id, deleted: true };
  },

  /**
   * Guard reutilizable: la mascota debe existir, ser del tenant, no estar
   * eliminada y estar 'Activa'. Lanza MASCOTA_NOT_FOUND / PET_DECEASED.
   * Lo consumirán Historial/Turnos/Guardería (Etapas 5–7) para RN-MF2/RN-EC3.
   */
  async assertMascotaActiva(
    db: SupabaseClient,
    petId: string,
    tenantId: string,
  ): Promise<Record<string, unknown>> {
    const { data } = await db
      .from("mascotas")
      .select("id, name, estado, deceased_date, deceased_reason, deleted")
      .eq("id", petId)
      .eq("tenant_id", tenantId)
      .eq("deleted", false)
      .maybeSingle();

    if (!data) {
      throw new DomainError(ErrorCode.MASCOTA_NOT_FOUND, 404, "Mascota no encontrada en este tenant");
    }
    if ((data as Record<string, unknown>)["estado"] !== "Activa") {
      throw new DomainError(ErrorCode.PET_DECEASED, 422, "La mascota está marcada como Fallecida");
    }
    return data as Record<string, unknown>;
  },

  /** Cambiar Dueño de Mascota — transferencia atómica vía RPC (RN-CD1..CD5). */
  async cambiarDueno(petId: string, dto: CambiarDuenoDto, ctx: CallerContext): Promise<CambioDuenoResultado> {
    const parsed = CambiarDuenoSchema.safeParse(dto);
    if (!parsed.success) validationError(parsed);
    const data = parsed.data;
    const db   = getServiceDb() as unknown as SupabaseClient;

    // RPC SECURITY DEFINER: UPDATE mascotas + INSERT cambios_propietario en una
    // sola transacción, con RN-CD1/RN-CD4 validadas dentro (evita TOCTOU).
    // RN-CD3: no se toca historial_clinico; la propiedad histórica es inmutable.
    const { data: row, error } = await db
      .rpc("cambiar_dueno_mascota", {
        p_tenant_id:     ctx.tenantId, // tenant SIEMPRE del JWT
        p_pet_id:        petId,
        p_new_client_id: data.newClientId,
        p_recorded_by:   ctx.callerUserId,
        p_reason:        data.reason ?? null,
        p_notes:         data.notes ?? null,
      })
      .single();

    if (error) throw mapRpcError(error);

    const r = row as unknown as Record<string, unknown>;

    // RN-CD5: auditoría UPDATE en módulo pets con el detalle del cambio.
    await recordAudit(db, {
      tenantId:  ctx.tenantId,
      userId:    ctx.callerUserId,
      userName:  ctx.callerName,
      userRole:  ctx.callerRole,
      action:    "UPDATE",
      module:    "pets",
      entityId:  petId,
      oldValues: { client_id: r["previous_client_id"] },
      newValues: { client_id: r["new_client_id"], reason: data.reason ?? null, notes: data.notes ?? null },
    });

    return {
      petId,
      previousClientName: (r["previous_client_name"] as string | null) ?? null,
      newClientName:      (r["new_client_name"] as string | null) ?? null,
      changeDate:         r["change_date"] as string,
    };
  },

  /** Historial de cambios de dueño de una mascota (RN-CD2; embed sin N+1). */
  async listarCambiosDueno(petId: string, tenantId: string): Promise<CambioDuenoPublico[]> {
    const db = getServiceDb();

    // La mascota debe ser del tenant (las fallecidas también consultan su historia).
    const { data: pet } = await db
      .from("mascotas")
      .select("id")
      .eq("id", petId)
      .eq("tenant_id", tenantId)
      .eq("deleted", false)
      .maybeSingle();

    if (!pet) {
      throw new DomainError(ErrorCode.MASCOTA_NOT_FOUND, 404, "Mascota no encontrada en este tenant");
    }

    const { data, error } = await db
      .from("cambios_propietario")
      .select(
        "id, pet_id, previous_client_id, new_client_id, change_date, reason, notes, " +
        "previous:clientes!previous_client_id(full_name), new:clientes!new_client_id(full_name)",
      )
      .eq("pet_id", petId)
      .eq("tenant_id", tenantId)
      .order("change_date", { ascending: false });

    if (error) {
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, error.message);
    }

    return ((data as unknown[]) ?? []).map((raw) => {
      const r = raw as Record<string, unknown>;
      return {
        id:                 r["id"] as string,
        petId:              r["pet_id"] as string,
        previousClientId:   r["previous_client_id"] as string,
        previousClientName: embeddedName(r["previous"]),
        newClientId:        r["new_client_id"] as string,
        newClientName:      embeddedName(r["new"]),
        changeDate:         r["change_date"] as string,
        reason:             (r["reason"] as string | null) ?? null,
        notes:              (r["notes"] as string | null) ?? null,
      };
    });
  },

  /** Marcar Mascota como Fallecida — flujo MANUAL (RN-MF1..MF5). NO es eutanasia. */
  async marcarFallecida(petId: string, dto: MarcarFallecidaDto, ctx: CallerContext): Promise<MascotaPublica> {
    const parsed = MarcarFallecidaSchema.safeParse(dto); // RN-MF1: motivo obligatorio
    if (!parsed.success) validationError(parsed);
    const data = parsed.data;
    const db   = getServiceDb() as unknown as SupabaseClient;

    // Debe existir, ser del tenant y estar Activa (re-marcar una fallecida → PET_DECEASED).
    const actual = await MascotasService.assertMascotaActiva(db, petId, ctx.tenantId);

    const deceasedDate = data.deceasedDate ?? new Date().toISOString().slice(0, 10);
    const updatePayload = {
      estado:          "Fallecida",
      deceased_date:   deceasedDate,
      deceased_reason: data.deceasedReason,
    };

    const { data: row, error } = await db
      .from("mascotas")
      .update(updatePayload)
      .eq("id", petId)
      .eq("tenant_id", ctx.tenantId)
      .eq("deleted", false)
      .select(COLS)
      .single();

    if (error) {
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, error.message);
    }

    // RN-MF5: auditoría UPDATE en módulo pets con la marca de fallecimiento.
    await recordAudit(db, {
      tenantId:  ctx.tenantId,
      userId:    ctx.callerUserId,
      userName:  ctx.callerName,
      userRole:  ctx.callerRole,
      action:    "UPDATE",
      module:    "pets",
      entityId:  petId,
      oldValues: actual,
      newValues: { ...updatePayload, deceased_notes: data.deceasedNotes ?? null },
    });

    return toPublic(row as unknown as Record<string, unknown>);
  },
};
