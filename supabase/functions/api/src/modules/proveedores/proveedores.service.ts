import type { SupabaseClient } from "@supabase/supabase-js";
import { getServiceDb } from "../../shared/db.ts";
import { recordAudit } from "../../shared/audit.ts";
import { DomainError, ErrorCode } from "../../shared/errors.ts";
import type {
  CrearProveedorDto,
  ActualizarProveedorDto,
  ListarProveedoresQuery,
} from "./proveedores.schemas.ts";

export interface Context {
  tenantId:     string;
  callerUserId: string;
  callerName?:  string;
  callerRole?:  string;
}

export interface ProveedorPublico {
  id:              string;
  tenantId:        string;
  razonSocial:     string;
  nombreFantasia:  string | null;
  cuit:            string | null;
  condicionFiscal: string | null;
  telefono:        string | null;
  email:           string | null;
  direccion:       string | null;
  contactoNombre:  string | null;
  observaciones:   string | null;
  clienteId:       string | null;
  activo:          boolean;
  createdAt:       string;
  updatedAt:       string;
}

function toProveedorPublic(r: Record<string, unknown>): ProveedorPublico {
  return {
    id:              r["id"] as string,
    tenantId:        r["tenant_id"] as string,
    razonSocial:     r["razon_social"] as string,
    nombreFantasia:  (r["nombre_fantasia"] as string | null) ?? null,
    cuit:            (r["cuit"] as string | null) ?? null,
    condicionFiscal: (r["condicion_fiscal"] as string | null) ?? null,
    telefono:        (r["telefono"] as string | null) ?? null,
    email:           (r["email"] as string | null) ?? null,
    direccion:       (r["direccion"] as string | null) ?? null,
    contactoNombre:  (r["contacto_nombre"] as string | null) ?? null,
    observaciones:   (r["observaciones"] as string | null) ?? null,
    clienteId:       (r["cliente_id"] as string | null) ?? null,
    activo:          r["activo"] as boolean,
    createdAt:       r["created_at"] as string,
    updatedAt:       r["updated_at"] as string,
  };
}

// ─── Guard Exportado ──────────────────────────────────────────────────────────

/** RN-PRV2: un proveedor inactivo no recibe compras. Sus compras históricas se conservan. */
export async function assertProveedorActivo(proveedorId: string, tenantId: string): Promise<void> {
  const db = getServiceDb();
  const { data } = await db
    .from("proveedores")
    .select("id, activo")
    .eq("id", proveedorId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (!data) {
    throw new DomainError(ErrorCode.SUPPLIER_NOT_FOUND, 404, "Proveedor no encontrado en este tenant");
  }
  if (!(data as { activo: boolean }).activo) {
    throw new DomainError(ErrorCode.SUPPLIER_INACTIVE, 422, "El proveedor está inactivo");
  }
}

// ─── ProveedorService ─────────────────────────────────────────────────────────

export const ProveedorService = {
  async crear(dto: CrearProveedorDto, ctx: Context): Promise<ProveedorPublico> {
    const db = getServiceDb();

    // RN-PRV1: Pre-query razón social duplicada
    const { data: razonExistente } = await db
      .from("proveedores")
      .select("id")
      .eq("tenant_id", ctx.tenantId)
      .ilike("razon_social", dto.razonSocial)
      .maybeSingle();

    if (razonExistente) {
      throw new DomainError(ErrorCode.SUPPLIER_DUPLICATE, 409, "Ya existe un proveedor con esa razón social");
    }

    // RN-PRV1: Pre-query CUIT duplicado si está presente
    if (dto.cuit) {
      const { data: cuitExistente } = await db
        .from("proveedores")
        .select("id")
        .eq("tenant_id", ctx.tenantId)
        .eq("cuit", dto.cuit)
        .maybeSingle();

      if (cuitExistente) {
        throw new DomainError(ErrorCode.SUPPLIER_DUPLICATE, 409, "Ya existe un proveedor con ese CUIT");
      }
    }

    // Validar clienteId si se envía
    if (dto.clienteId) {
      const { data: cli } = await db
        .from("clientes")
        .select("id")
        .eq("id", dto.clienteId)
        .eq("tenant_id", ctx.tenantId)
        .eq("deleted", false)
        .maybeSingle();

      if (!cli) {
        throw new DomainError(
          ErrorCode.VALIDATION_ERROR,
          422,
          "El cliente indicado no existe en esta clínica",
          [{ field: "clienteId", message: "Cliente no encontrado" }],
        );
      }
    }

    const payload = {
      tenant_id:        ctx.tenantId,
      razon_social:     dto.razonSocial,
      nombre_fantasia:  dto.nombreFantasia ?? null,
      cuit:             dto.cuit ?? null,
      condicion_fiscal: dto.condicionFiscal ?? null,
      telefono:         dto.telefono ?? null,
      email:            dto.email ?? null,
      direccion:        dto.direccion ?? null,
      contacto_nombre:  dto.contactoNombre ?? null,
      observaciones:    dto.observaciones ?? null,
      cliente_id:       dto.clienteId ?? null,
    };

    const { data, error } = await db
      .from("proveedores")
      .insert(payload)
      .select()
      .single();

    if (error || !data) {
      if (error?.code === "23505") {
        throw new DomainError(ErrorCode.SUPPLIER_DUPLICATE, 409, "Ya existe un proveedor con esa razón social o CUIT");
      }
      if (error?.code === "23503") {
        throw new DomainError(ErrorCode.VALIDATION_ERROR, 422, "El cliente indicado no existe en esta clínica");
      }
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, error?.message ?? "Error al crear proveedor");
    }

    await recordAudit(db as unknown as SupabaseClient, {
      tenantId:  ctx.tenantId,
      userId:    ctx.callerUserId,
      userName:  ctx.callerName ?? null,
      userRole:  ctx.callerRole ?? null,
      action:    "CREATE",
      module:    "suppliers",
      entityId:  data["id"] as string,
      newValues: dto as Record<string, unknown>,
    });

    return toProveedorPublic(data as Record<string, unknown>);
  },

  async obtenerPorId(id: string, ctx: Context): Promise<ProveedorPublico> {
    const db = getServiceDb();
    const { data, error } = await db
      .from("proveedores")
      .select()
      .eq("tenant_id", ctx.tenantId)
      .eq("id", id)
      .maybeSingle();

    if (error || !data) {
      throw new DomainError(ErrorCode.SUPPLIER_NOT_FOUND, 404, "Proveedor no encontrado");
    }

    return toProveedorPublic(data as Record<string, unknown>);
  },

  async buscarPaginado(
    query: ListarProveedoresQuery,
    ctx: Context,
  ): Promise<{ items: ProveedorPublico[]; total: number; page: number; limit: number }> {
    const db = getServiceDb();
    let q = db
      .from("proveedores")
      .select("*", { count: "exact" })
      .eq("tenant_id", ctx.tenantId);

    if (query.search) {
      q = q.or(
        `razon_social.ilike.%${query.search}%,nombre_fantasia.ilike.%${query.search}%,cuit.ilike.%${query.search}%`,
      );
    }
    if (query.activo !== undefined) {
      q = q.eq("activo", query.activo);
    }

    const from = (query.page - 1) * query.limit;
    const to = from + query.limit - 1;

    const { data, error, count } = await q.order("razon_social", { ascending: true }).range(from, to);

    if (error) {
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, error.message);
    }

    const items = ((data as unknown[]) ?? []).map((r) => toProveedorPublic(r as Record<string, unknown>));
    return { items, total: count ?? 0, page: query.page, limit: query.limit };
  },

  async actualizar(id: string, dto: ActualizarProveedorDto, ctx: Context): Promise<ProveedorPublico> {
    const db = getServiceDb();
    const actual = await ProveedorService.obtenerPorId(id, ctx);

    if (dto.razonSocial && dto.razonSocial !== actual.razonSocial) {
      const { data: razonExistente } = await db
        .from("proveedores")
        .select("id")
        .eq("tenant_id", ctx.tenantId)
        .ilike("razon_social", dto.razonSocial)
        .neq("id", id)
        .maybeSingle();

      if (razonExistente) {
        throw new DomainError(ErrorCode.SUPPLIER_DUPLICATE, 409, "Ya existe un proveedor con esa razón social");
      }
    }

    if (dto.cuit && dto.cuit !== actual.cuit) {
      const { data: cuitExistente } = await db
        .from("proveedores")
        .select("id")
        .eq("tenant_id", ctx.tenantId)
        .eq("cuit", dto.cuit)
        .neq("id", id)
        .maybeSingle();

      if (cuitExistente) {
        throw new DomainError(ErrorCode.SUPPLIER_DUPLICATE, 409, "Ya existe un proveedor con ese CUIT");
      }
    }

    if (dto.clienteId && dto.clienteId !== actual.clienteId) {
      const { data: cli } = await db
        .from("clientes")
        .select("id")
        .eq("id", dto.clienteId)
        .eq("tenant_id", ctx.tenantId)
        .eq("deleted", false)
        .maybeSingle();

      if (!cli) {
        throw new DomainError(
          ErrorCode.VALIDATION_ERROR,
          422,
          "El cliente indicado no existe en esta clínica",
          [{ field: "clienteId", message: "Cliente no encontrado" }],
        );
      }
    }

    const payload: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (dto.razonSocial !== undefined)     payload["razon_social"] = dto.razonSocial;
    if (dto.nombreFantasia !== undefined)  payload["nombre_fantasia"] = dto.nombreFantasia;
    if (dto.cuit !== undefined)            payload["cuit"] = dto.cuit;
    if (dto.condicionFiscal !== undefined) payload["condicion_fiscal"] = dto.condicionFiscal;
    if (dto.telefono !== undefined)        payload["telefono"] = dto.telefono;
    if (dto.email !== undefined)           payload["email"] = dto.email;
    if (dto.direccion !== undefined)       payload["direccion"] = dto.direccion;
    if (dto.contactoNombre !== undefined)  payload["contacto_nombre"] = dto.contactoNombre;
    if (dto.observaciones !== undefined)   payload["observaciones"] = dto.observaciones;
    if (dto.clienteId !== undefined)       payload["cliente_id"] = dto.clienteId;

    const { data, error } = await db
      .from("proveedores")
      .update(payload)
      .eq("tenant_id", ctx.tenantId)
      .eq("id", id)
      .select()
      .single();

    if (error || !data) {
      if (error?.code === "23505") {
        throw new DomainError(ErrorCode.SUPPLIER_DUPLICATE, 409, "Ya existe un proveedor con esa razón social o CUIT");
      }
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, error?.message ?? "Error al actualizar proveedor");
    }

    await recordAudit(db as unknown as SupabaseClient, {
      tenantId:  ctx.tenantId,
      userId:    ctx.callerUserId,
      userName:  ctx.callerName ?? null,
      userRole:  ctx.callerRole ?? null,
      action:    "UPDATE",
      module:    "suppliers",
      entityId:  id,
      oldValues: actual as unknown as Record<string, unknown>,
      newValues: dto as Record<string, unknown>,
    });

    return toProveedorPublic(data as Record<string, unknown>);
  },

  async cambiarEstado(id: string, activo: boolean, ctx: Context): Promise<ProveedorPublico> {
    const db = getServiceDb();
    const actual = await ProveedorService.obtenerPorId(id, ctx);

    const { data, error } = await db
      .from("proveedores")
      .update({ activo, updated_at: new Date().toISOString() })
      .eq("tenant_id", ctx.tenantId)
      .eq("id", id)
      .select()
      .single();

    if (error || !data) {
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, error?.message ?? "Error al cambiar estado de proveedor");
    }

    await recordAudit(db as unknown as SupabaseClient, {
      tenantId:  ctx.tenantId,
      userId:    ctx.callerUserId,
      userName:  ctx.callerName ?? null,
      userRole:  ctx.callerRole ?? null,
      action:    "UPDATE",
      module:    "suppliers",
      entityId:  id,
      oldValues: { activo: actual.activo },
      newValues: { activo },
    });

    return toProveedorPublic(data as Record<string, unknown>);
  },
};
