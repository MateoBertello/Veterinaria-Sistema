import type { SupabaseClient } from "@supabase/supabase-js";
import { DomainError, ErrorCode } from "../../shared/errors.ts";
import { recordAudit } from "../../shared/audit.ts";
import { getServiceDb } from "../../shared/db.ts";
import { sanitizeLikeTerm } from "../../shared/sanitize.ts";
import { invalidateModuleCache } from "../../middleware/requireModule.ts";
import {
  CrearTenantSchema,
  EditarTenantSchema,
  type CrearTenantDto,
  type EditarTenantDto,
  type ListarTenantsQueryDto,
} from "./tenants.schemas.ts";

// ─── Tipos ──────────────────────────────────────────────────────────────────

export interface SuperAdminContext {
  superAdminId: string;
  superAdminName?: string;
}

/**
 * Metadatos comerciales de un tenant (RN-SA4): NUNCA expone datos de negocio
 * internos del tenant (clientes, mascotas, historial, etc.).
 */
export interface TenantPublico {
  id:            string;
  nombre:        string;
  cuitRut:       string;
  emailContacto: string;
  plan:          string;
  activo:        boolean;
  adminInvitado: boolean;
  createdAt:     string;
}

// ─── Helpers internos ─────────────────────────────────────────────────────────

function toPublicTenant(row: Record<string, unknown>): TenantPublico {
  return {
    id:            row["id"] as string,
    nombre:        row["nombre"] as string,
    cuitRut:       row["cuit_rut"] as string,
    emailContacto: row["email_contacto"] as string,
    plan:          row["plan"] as string,
    activo:        row["activo"] as boolean,
    adminInvitado: (row["admin_invitado"] as boolean) ?? false,
    createdAt:     row["created_at"] as string,
  };
}

/** Detecta violación de unicidad de Postgres (cuit_rut duplicado). */
function isUniqueViolation(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === "23505" ||
    (typeof error.message === "string" && error.message.toLowerCase().includes("duplicate"));
}

// ─── TenantService ────────────────────────────────────────────────────────────

export const TenantService = {
  /**
   * RN-SA1 (unicidad fiscal), RN-SA2 (alta atómica + invitación posterior).
   *
   * El alta del tenant y su aprovisionamiento (on_tenant_created) son atómicos
   * vía el RPC crear_tenant. La invitación del Admin es un paso POSTERIOR,
   * idempotente y reintentable: si falla, el tenant queda creado con
   * admin_invitado=false ("pendiente de invitar admin"), sin borrar nada.
   */
  async crear(dto: CrearTenantDto, ctx: SuperAdminContext): Promise<TenantPublico> {
    const parsed = CrearTenantSchema.safeParse(dto);
    if (!parsed.success) {
      throw new DomainError(
        ErrorCode.VALIDATION_ERROR,
        422,
        "Datos de tenant inválidos",
        parsed.error.issues ?? [],
      );
    }

    const data = parsed.data;
    const db   = getServiceDb();

    // RN-SA1: pre-check de unicidad fiscal (respuesta limpia 409).
    const { data: existente } = await db
      .from("tenants")
      .select("id")
      .eq("cuit_rut", data.cuitRut)
      .single();

    if (existente) {
      throw new DomainError(
        ErrorCode.TENANT_DUPLICATE_TAXID,
        409,
        "Ya existe una clínica con ese CUIT/RUT",
      );
    }

    // RN-SA2: alta atómica (tenant + on_tenant_created) vía RPC.
    const { data: created, error: rpcError } = await db.rpc("crear_tenant", {
      p_nombre:         data.nombre,
      p_cuit_rut:       data.cuitRut,
      p_email_contacto: data.emailContacto,
      p_plan:           data.plan,
    });

    if (rpcError || !created) {
      // Fallback de carrera: la unicidad la garantiza el UNIQUE de la tabla.
      if (isUniqueViolation(rpcError)) {
        throw new DomainError(
          ErrorCode.TENANT_DUPLICATE_TAXID,
          409,
          "Ya existe una clínica con ese CUIT/RUT",
        );
      }
      throw new DomainError(
        ErrorCode.INTERNAL_ERROR,
        500,
        `No se pudo crear la clínica: ${rpcError?.message ?? ""}`,
      );
    }

    // El RPC RETURNS tenants → supabase-js puede devolver fila u objeto único.
    const tenantRow = (Array.isArray(created) ? created[0] : created) as Record<string, unknown>;

    // RN-SA5: auditoría de plataforma.
    await recordAudit(db as unknown as SupabaseClient, {
      tenantId:  null,
      userId:    ctx.superAdminId,
      userName:  ctx.superAdminName ?? "super_admin",
      userRole:  "super_admin",
      action:    "CREATE",
      module:    "platform",
      entityId:  tenantRow["id"] as string,
      newValues: {
        nombre:        data.nombre,
        cuitRut:       data.cuitRut,
        emailContacto: data.emailContacto,
        plan:          data.plan,
      },
    });

    // RN-SA2: invitación del Admin como paso posterior, NO bloqueante.
    // Si falla, el tenant queda con admin_invitado=false y se puede reintentar.
    await TenantService.invitarAdmin(tenantRow["id"] as string).catch(() => {
      // Silenciado a propósito: el alta no se revierte por una invitación fallida.
    });

    // Releer el estado actual (admin_invitado puede haberse marcado en la invitación).
    const { data: fresh } = await db
      .from("tenants")
      .select("id, nombre, cuit_rut, email_contacto, plan, activo, admin_invitado, created_at")
      .eq("id", tenantRow["id"] as string)
      .single();

    return toPublicTenant((fresh ?? tenantRow) as Record<string, unknown>);
  },

  /**
   * RN-SA2: invitación idempotente y reintentable del Admin del tenant.
   * Invita por email vía Supabase Auth y marca admin_invitado=true al éxito.
   * Reusable por el endpoint POST /admin/tenants/:id/invitar-admin.
   */
  async invitarAdmin(tenantId: string): Promise<TenantPublico> {
    const db = getServiceDb();

    const { data: tenant, error: findError } = await db
      .from("tenants")
      .select("id, nombre, cuit_rut, email_contacto, plan, activo, admin_invitado, created_at")
      .eq("id", tenantId)
      .single();

    if (findError || !tenant) {
      throw new DomainError(ErrorCode.TENANT_NOT_FOUND, 404, "Tenant no encontrado");
    }

    // Idempotencia: si ya fue invitado, no se reenvía.
    if ((tenant as { admin_invitado: boolean }).admin_invitado) {
      return toPublicTenant(tenant as Record<string, unknown>);
    }

    const emailContacto = (tenant as { email_contacto: string }).email_contacto;

    const { error: inviteError } = await (db.auth.admin as {
      inviteUserByEmail: (
        email: string,
        opts?: { data?: Record<string, unknown> },
      ) => Promise<{ error: { message: string } | null }>;
    }).inviteUserByEmail(emailContacto, {
      data: { tenant_id: tenantId, rol_inicial: "admin" },
    });

    if (inviteError) {
      throw new DomainError(
        ErrorCode.INTERNAL_ERROR,
        500,
        `No se pudo invitar al administrador: ${inviteError.message}`,
      );
    }

    const { data: updated } = await db
      .from("tenants")
      .update({ admin_invitado: true })
      .eq("id", tenantId)
      .select("id, nombre, cuit_rut, email_contacto, plan, activo, admin_invitado, created_at")
      .single();

    return toPublicTenant((updated ?? { ...tenant, admin_invitado: true }) as Record<string, unknown>);
  },

  /** Edición de datos comerciales. Auditoría UPDATE platform (RN-SA5). */
  async actualizar(
    id: string,
    dto: EditarTenantDto,
    ctx: SuperAdminContext,
  ): Promise<TenantPublico> {
    const parsed = EditarTenantSchema.safeParse(dto);
    if (!parsed.success) {
      throw new DomainError(
        ErrorCode.VALIDATION_ERROR,
        422,
        "Datos de tenant inválidos",
        parsed.error.issues ?? [],
      );
    }

    const data = parsed.data;
    const db   = getServiceDb();

    const { data: actual, error: findError } = await db
      .from("tenants")
      .select("id, nombre, cuit_rut, email_contacto, plan, activo, admin_invitado, created_at")
      .eq("id", id)
      .single();

    if (findError || !actual) {
      throw new DomainError(ErrorCode.TENANT_NOT_FOUND, 404, "Tenant no encontrado");
    }

    const updatePayload: Record<string, unknown> = {};
    if (data.nombre        !== undefined) updatePayload["nombre"]         = data.nombre;
    if (data.emailContacto !== undefined) updatePayload["email_contacto"] = data.emailContacto;
    if (data.plan          !== undefined) updatePayload["plan"]           = data.plan;

    const { data: updated, error: updateError } = await db
      .from("tenants")
      .update(updatePayload)
      .eq("id", id)
      .select("id, nombre, cuit_rut, email_contacto, plan, activo, admin_invitado, created_at")
      .single();

    if (updateError) {
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, updateError.message);
    }

    await recordAudit(db as unknown as SupabaseClient, {
      tenantId:  null,
      userId:    ctx.superAdminId,
      userName:  ctx.superAdminName ?? "super_admin",
      userRole:  "super_admin",
      action:    "UPDATE",
      module:    "platform",
      entityId:  id,
      oldValues: actual as Record<string, unknown>,
      newValues: updatePayload,
    });

    return toPublicTenant(updated as Record<string, unknown>);
  },

  /**
   * RN-SA3 (lado escritura): suspender/reactivar un tenant (baja lógica).
   * Invalida la caché de módulos para que la suspensión surta efecto sin esperar
   * el TTL. Auditoría UPDATE platform (RN-SA5).
   */
  async cambiarEstado(
    id: string,
    activo: boolean,
    ctx: SuperAdminContext,
  ): Promise<TenantPublico> {
    const db = getServiceDb();

    const { data: actual, error: findError } = await db
      .from("tenants")
      .select("id, nombre, cuit_rut, email_contacto, plan, activo, admin_invitado, created_at")
      .eq("id", id)
      .single();

    if (findError || !actual) {
      throw new DomainError(ErrorCode.TENANT_NOT_FOUND, 404, "Tenant no encontrado");
    }

    const { data: updated, error: updateError } = await db
      .from("tenants")
      .update({ activo })
      .eq("id", id)
      .select("id, nombre, cuit_rut, email_contacto, plan, activo, admin_invitado, created_at")
      .single();

    if (updateError) {
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, updateError.message);
    }

    invalidateModuleCache(id);

    await recordAudit(db as unknown as SupabaseClient, {
      tenantId:  null,
      userId:    ctx.superAdminId,
      userName:  ctx.superAdminName ?? "super_admin",
      userRole:  "super_admin",
      action:    "UPDATE",
      module:    "platform",
      entityId:  id,
      oldValues: { activo: (actual as { activo: boolean }).activo },
      newValues: { activo },
    });

    return toPublicTenant(updated as Record<string, unknown>);
  },

  /** RN-SA4: solo metadatos comerciales, nunca datos de negocio del tenant. */
  async obtenerPorId(id: string): Promise<TenantPublico> {
    const db = getServiceDb();

    const { data, error } = await db
      .from("tenants")
      .select("id, nombre, cuit_rut, email_contacto, plan, activo, admin_invitado, created_at")
      .eq("id", id)
      .single();

    if (error || !data) {
      throw new DomainError(ErrorCode.TENANT_NOT_FOUND, 404, "Tenant no encontrado");
    }

    return toPublicTenant(data as Record<string, unknown>);
  },

  /** RN-SA4: listado paginado de metadatos comerciales con filtros. */
  async buscarPaginado(
    filtros: ListarTenantsQueryDto,
  ): Promise<{ items: TenantPublico[]; total: number }> {
    const db     = getServiceDb();
    const offset = (filtros.page - 1) * filtros.limit;

    let query = db
      .from("tenants")
      .select(
        "id, nombre, cuit_rut, email_contacto, plan, activo, admin_invitado, created_at",
        { count: "exact" },
      );

    if (filtros.q) {
      const q = sanitizeLikeTerm(filtros.q);
      query = query.or(`nombre.ilike.%${q}%,cuit_rut.ilike.%${q}%`);
    }
    if (filtros.plan) {
      query = query.eq("plan", filtros.plan);
    }
    if (filtros.estado) {
      query = query.eq("activo", filtros.estado === "activo");
    }

    const { data, error, count } = await query
      .order("created_at", { ascending: false })
      .range(offset, offset + filtros.limit - 1);

    if (error) {
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, error.message);
    }

    const items = ((data as unknown[]) ?? []).map((row) =>
      toPublicTenant(row as Record<string, unknown>),
    );

    return { items, total: count ?? 0 };
  },
};
