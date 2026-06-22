import type { SupabaseClient } from "@supabase/supabase-js";
import { DomainError, ErrorCode } from "../../shared/errors.ts";
import { recordAudit } from "../../shared/audit.ts";
import { getServiceDb } from "../../shared/db.ts";
import {
  CrearClienteSchema,
  EditarClienteSchema,
  type CrearClienteDto,
  type EditarClienteDto,
} from "./clientes.schemas.ts";

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface CallerContext {
  tenantId:     string;
  callerUserId: string;
  callerName:   string;
  callerRole:   string;
}

export interface ClientePublico {
  id:           string;
  fullName:     string;
  dniCuit:      string | null;
  phone:        string | null;
  address:      string | null;
  email:        string | null;
  observations: string | null;
  createdAt:    string;
  createdBy:    string | null;
  // RN-CL8: cantidad de mascotas vivas (deleted=false AND estado='Activa').
  // Habilita pre-deshabilitar "Eliminar" en la UI. Solo viene poblado en el
  // listado (vía embed); en alta/edición/detalle es 0 al no embeber mascotas.
  livePetCount: number;
}

export interface ListarOpts {
  page:   number;
  limit:  number;
  search?: string;
}

// Columnas públicas del cliente (sin flags de baja lógica).
const COLS = "id, full_name, dni_cuit, phone, address, email, observations, created_at, created_by";

// Columnas del listado + conteo embebido de mascotas vivas (sin N+1). El conteo
// se filtra con la MISMA definición que el bloqueo RN-CL8 del DELETE
// (deleted=false AND estado='Activa'); los filtros se aplican en listar().
const COLS_LISTAR = `${COLS}, mascotas:mascotas!client_id(count)`;

/** Lee el conteo embebido de mascotas vivas de una fila del listado. */
function livePetCountOf(row: Record<string, unknown>): number {
  const embed = row["mascotas"] as Array<{ count?: number }> | undefined;
  return embed?.[0]?.count ?? 0;
}

// ─── Helpers internos ─────────────────────────────────────────────────────────

/** Mapea una fila snake_case de la DB al DTO camelCase. */
function toPublic(row: Record<string, unknown>): ClientePublico {
  return {
    id:           row["id"] as string,
    fullName:     row["full_name"] as string,
    dniCuit:      (row["dni_cuit"] as string | null) ?? null,
    phone:        (row["phone"] as string | null) ?? null,
    address:      (row["address"] as string | null) ?? null,
    email:        (row["email"] as string | null) ?? null,
    observations: (row["observations"] as string | null) ?? null,
    createdAt:    row["created_at"] as string,
    createdBy:    (row["created_by"] as string | null) ?? null,
    livePetCount: livePetCountOf(row),
  };
}

function validationError(parsed: { error: { issues?: unknown[] } }): never {
  throw new DomainError(
    ErrorCode.VALIDATION_ERROR,
    422,
    "Datos de cliente inválidos",
    parsed.error.issues ?? (parsed.error as { errors?: unknown[] }).errors ?? [],
  );
}

/** Detecta violación de unicidad de DNI/CUIT proveniente del índice único parcial. */
function isDuplicateDni(message: string): boolean {
  return message.includes("uq_clientes_dni_activo") ||
    message.includes("duplicate") ||
    message.includes("23505");
}

// ─── ClientesService ──────────────────────────────────────────────────────────

export const ClientesService = {
  /** Registrar Cliente (RN-CL1..CL5, RN-CL7). */
  async crear(dto: CrearClienteDto, ctx: CallerContext): Promise<ClientePublico> {
    const parsed = CrearClienteSchema.safeParse(dto);
    if (!parsed.success) validationError(parsed);
    const data = parsed.data;
    const db   = getServiceDb();

    // RN-CL3: unicidad de DNI/CUIT entre clientes no eliminados.
    const { data: dup } = await db
      .from("clientes")
      .select("id")
      .eq("tenant_id", ctx.tenantId)
      .eq("dni_cuit", data.dniCuit)
      .eq("deleted", false)
      .single();

    if (dup) {
      throw new DomainError(ErrorCode.DUPLICATE_DNI, 409, "El DNI/CUIT ya está registrado");
    }

    const { data: row, error } = await db
      .from("clientes")
      .insert({
        tenant_id:    ctx.tenantId,
        full_name:    data.fullName,
        dni_cuit:     data.dniCuit,
        phone:        data.phone,
        address:      data.address,
        email:        data.email ?? null,
        observations: data.observations ?? null,
        created_by:   ctx.callerUserId,
      })
      .select(COLS)
      .single();

    if (error || !row) {
      if (error && isDuplicateDni(error.message)) {
        throw new DomainError(ErrorCode.DUPLICATE_DNI, 409, "El DNI/CUIT ya está registrado");
      }
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, `No se pudo crear el cliente: ${error?.message ?? ""}`);
    }

    // RN-CL7: auditoría CREATE en módulo clients.
    await recordAudit(db as unknown as SupabaseClient, {
      tenantId:  ctx.tenantId,
      userId:    ctx.callerUserId,
      userName:  ctx.callerName,
      userRole:  ctx.callerRole,
      action:    "CREATE",
      module:    "clients",
      entityId:  (row as Record<string, unknown>)["id"] as string,
      newValues: data as Record<string, unknown>,
    });

    return toPublic(row as Record<string, unknown>);
  },

  /** Editar Cliente (RN-CL1..CL5, RN-CL3 excluyendo el propio id, RN-CL7). */
  async editar(id: string, dto: EditarClienteDto, ctx: CallerContext): Promise<ClientePublico> {
    const parsed = EditarClienteSchema.safeParse(dto);
    if (!parsed.success) validationError(parsed);
    const data = parsed.data;
    const db   = getServiceDb();

    // Carga del cliente actual (debe pertenecer al tenant y no estar eliminado).
    const { data: actual } = await db
      .from("clientes")
      .select("*")
      .eq("id", id)
      .eq("tenant_id", ctx.tenantId)
      .eq("deleted", false)
      .single();

    if (!actual) {
      throw new DomainError(ErrorCode.FORBIDDEN, 403, "Cliente no encontrado en este tenant");
    }

    // RN-CL3: si cambia el DNI/CUIT, revalidar unicidad excluyendo el propio registro.
    if (data.dniCuit !== undefined) {
      const { data: dup } = await db
        .from("clientes")
        .select("id")
        .eq("tenant_id", ctx.tenantId)
        .eq("dni_cuit", data.dniCuit)
        .eq("deleted", false)
        .neq("id", id)
        .single();

      if (dup) {
        throw new DomainError(ErrorCode.DUPLICATE_DNI, 409, "El DNI/CUIT ya está registrado");
      }
    }

    const updatePayload: Record<string, unknown> = {};
    if (data.fullName     !== undefined) updatePayload["full_name"]    = data.fullName;
    if (data.dniCuit      !== undefined) updatePayload["dni_cuit"]     = data.dniCuit;
    if (data.phone        !== undefined) updatePayload["phone"]        = data.phone;
    if (data.address      !== undefined) updatePayload["address"]      = data.address;
    if (data.email        !== undefined) updatePayload["email"]        = data.email;
    if (data.observations !== undefined) updatePayload["observations"] = data.observations;

    const { data: row, error } = await db
      .from("clientes")
      .update(updatePayload)
      .eq("id", id)
      .eq("tenant_id", ctx.tenantId)
      .select(COLS)
      .single();

    if (error) {
      if (isDuplicateDni(error.message)) {
        throw new DomainError(ErrorCode.DUPLICATE_DNI, 409, "El DNI/CUIT ya está registrado");
      }
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, error.message);
    }

    // RN-CL7: auditoría UPDATE en módulo clients.
    await recordAudit(db as unknown as SupabaseClient, {
      tenantId:  ctx.tenantId,
      userId:    ctx.callerUserId,
      userName:  ctx.callerName,
      userRole:  ctx.callerRole,
      action:    "UPDATE",
      module:    "clients",
      entityId:  id,
      oldValues: actual as Record<string, unknown>,
      newValues: updatePayload,
    });

    return toPublic((row ?? { ...(actual as Record<string, unknown>), ...updatePayload }) as Record<string, unknown>);
  },

  /** Detalle de un cliente del tenant (excluye eliminados). */
  async obtenerPorId(id: string, tenantId: string): Promise<ClientePublico | null> {
    const db = getServiceDb();
    const { data } = await db
      .from("clientes")
      .select(COLS)
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .eq("deleted", false)
      .single();

    return data ? toPublic(data as Record<string, unknown>) : null;
  },

  /** Listar/buscar clientes del tenant; excluye eliminados por defecto. */
  async listar(tenantId: string, opts: ListarOpts): Promise<{ items: ClientePublico[]; total: number }> {
    const db     = getServiceDb();
    const offset = (opts.page - 1) * opts.limit;

    let query = db
      .from("clientes")
      .select(COLS_LISTAR, { count: "exact" })
      .eq("tenant_id", tenantId)
      .eq("deleted", false)
      // Filtros embebidos del conteo: SOLO mascotas vivas (RN-CL8). Es un LEFT
      // JOIN, así que los clientes sin mascotas vivas siguen apareciendo (count 0).
      .eq("mascotas.deleted", false)
      .eq("mascotas.estado", "Activa");

    // Búsqueda por nombre, DNI/CUIT o teléfono.
    if (opts.search) {
      const term = opts.search.replace(/[%,]/g, " ");
      query = query.or(
        `full_name.ilike.%${term}%,dni_cuit.ilike.%${term}%,phone.ilike.%${term}%`,
      );
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

  /** Eliminar Cliente — baja lógica (RN-CL8, RN-CL9, RN-CL11). */
  async eliminar(id: string, ctx: CallerContext): Promise<{ id: string; deleted: true }> {
    const db = getServiceDb();

    // El cliente debe existir, pertenecer al tenant y no estar ya eliminado.
    const { data: actual } = await db
      .from("clientes")
      .select("id, full_name, deleted")
      .eq("id", id)
      .eq("tenant_id", ctx.tenantId)
      .eq("deleted", false)
      .single();

    if (!actual) {
      throw new DomainError(ErrorCode.FORBIDDEN, 403, "Cliente no encontrado en este tenant");
    }

    // RN-CL8: no eliminar si tiene al menos una mascota viva (activa y no eliminada).
    const { data: mascotaViva } = await db
      .from("mascotas")
      .select("id")
      .eq("tenant_id", ctx.tenantId)
      .eq("client_id", id)
      .eq("deleted", false)
      .eq("estado", "Activa")
      .limit(1)
      .maybeSingle();

    if (mascotaViva) {
      throw new DomainError(
        ErrorCode.CLIENT_HAS_PETS,
        409,
        "No puede eliminar un cliente con mascotas vivas asociadas",
      );
    }

    // RN-CL9: baja lógica (no se borra físicamente).
    const { error } = await db
      .from("clientes")
      .update({
        deleted:    true,
        deleted_at: new Date().toISOString(),
        deleted_by: ctx.callerUserId,
      })
      .eq("id", id)
      .eq("tenant_id", ctx.tenantId)
      .select("id")
      .maybeSingle();

    if (error) {
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, error.message);
    }

    // RN-CL11: auditoría DELETE en módulo clients.
    await recordAudit(db as unknown as SupabaseClient, {
      tenantId:  ctx.tenantId,
      userId:    ctx.callerUserId,
      userName:  ctx.callerName,
      userRole:  ctx.callerRole,
      action:    "DELETE",
      module:    "clients",
      entityId:  id,
      oldValues: actual as Record<string, unknown>,
    });

    return { id, deleted: true };
  },
};
