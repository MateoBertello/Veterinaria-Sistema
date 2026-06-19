import type { SupabaseClient } from "@supabase/supabase-js";
import { DomainError, ErrorCode } from "../../shared/errors.ts";
import { recordAudit } from "../../shared/audit.ts";
import { getServiceDb } from "../../shared/db.ts";
import {
  CrearMascotaSchema,
  EditarMascotaSchema,
  type CrearMascotaDto,
  type EditarMascotaDto,
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
  // RN-MA3: el último peso vive en el Historial Clínico (Etapa 5); aún no se adjunta.
  ultimoPeso:    number | null;
  createdAt:     string;
}

export interface ListarOpts {
  page:      number;
  limit:     number;
  search?:   string;
  clientId?: string;
}

// RN-MA9: fallback de dieta cuando no se informa.
const DIETA_FALLBACK = "Sin indicaciones de dieta";

// Listado/detalle resuelven dueño y catálogos en una sola consulta (embed; sin N+1).
const COLS =
  "id, name, client_id, especie_id, raza_id, sex, tamano, alimento_dieta, birth_date, color, observations, estado, created_at, " +
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
    ultimoPeso:    null,
    createdAt:     row["created_at"] as string,
  };
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

    if (opts.search) {
      const term = opts.search.replace(/[%,]/g, " ");
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
};
