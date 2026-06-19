import type { SupabaseClient } from "@supabase/supabase-js";
import { DomainError, ErrorCode } from "../../shared/errors.ts";
import { recordAudit } from "../../shared/audit.ts";
import { getDb, getServiceDb } from "../../shared/db.ts";
import { invalidateModuleCache } from "../../middleware/requireModule.ts";
import type { ModuloVendible } from "./modulos.schemas.ts";

// ─── Tipos ──────────────────────────────────────────────────────────────────

export interface SuperAdminContext {
  superAdminId:    string;
  superAdminName?: string;
}

/** DTO público de un módulo contratado (camelCase, Addendum §7). */
export interface ModuloContratadoPublico {
  modulo:     ModuloVendible;
  habilitado: boolean;
  fechaAlta:  string | null;
}

// ─── Helpers internos ─────────────────────────────────────────────────────────

const MODULOS_SELECT = "modulo, habilitado, fecha_alta";

function toPublic(row: Record<string, unknown>): ModuloContratadoPublico {
  return {
    modulo:     row["modulo"] as ModuloVendible,
    habilitado: row["habilitado"] as boolean,
    fechaAlta:  (row["fecha_alta"] as string | null) ?? null,
  };
}

// ─── ModuloService ─────────────────────────────────────────────────────────────

export const ModuloService = {
  /**
   * Tenant-facing: módulos del tenant del JWT (RLS activo).
   * Alimenta GET /modulos-habilitados y el sidebar dinámico (RN-G2).
   */
  async habilitadosDelTenant(
    tenantId: string,
    authHeader: string,
  ): Promise<ModuloContratadoPublico[]> {
    const db = getDb(authHeader);

    const { data, error } = await db
      .from("modulos_contratados")
      .select(MODULOS_SELECT)
      .eq("tenant_id", tenantId)
      .order("modulo");

    if (error) {
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, error.message);
    }

    return ((data as unknown[]) ?? []).map((r) => toPublic(r as Record<string, unknown>));
  },

  /**
   * Consola Super Admin: estado de los módulos de un tenant (service role).
   * Alimenta GET /admin/tenants/:id/modulos.
   */
  async listarPorTenant(tenantId: string): Promise<ModuloContratadoPublico[]> {
    const db = getServiceDb();

    const { data, error } = await db
      .from("modulos_contratados")
      .select(MODULOS_SELECT)
      .eq("tenant_id", tenantId)
      .order("modulo");

    if (error) {
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, error.message);
    }

    return ((data as unknown[]) ?? []).map((r) => toPublic(r as Record<string, unknown>));
  },

  /**
   * RN-SM2/SM3/SM4: habilita o deshabilita un módulo vendible de un tenant.
   *
   * - RN-SM2: solo cambia `habilitado` (UPDATE); NUNCA borra la fila ni los datos
   *   del módulo. La `fecha_alta` se sella la primera vez que se habilita.
   * - RN-SM3: invalida la caché de `requireModule` para ese tenant/módulo, de modo
   *   que el cambio surte efecto sin esperar el TTL (efecto inmediato).
   * - RN-SM4: registra auditoría UPDATE en el módulo 'platform'.
   */
  async setModulo(
    tenantId: string,
    modulo: ModuloVendible,
    habilitado: boolean,
    ctx: SuperAdminContext,
  ): Promise<ModuloContratadoPublico> {
    const db = getServiceDb();

    // El tenant debe existir (respuesta limpia 404).
    const { data: tenant, error: tenantError } = await db
      .from("tenants")
      .select("id")
      .eq("id", tenantId)
      .single();

    if (tenantError || !tenant) {
      throw new DomainError(ErrorCode.TENANT_NOT_FOUND, 404, "Tenant no encontrado");
    }

    // Estado previo (auditoría + conservación de fecha_alta — RN-SM2).
    const { data: actual } = await db
      .from("modulos_contratados")
      .select(MODULOS_SELECT)
      .eq("tenant_id", tenantId)
      .eq("modulo", modulo)
      .single();

    const fechaAltaPrevia = (actual?.["fecha_alta"] as string | null) ?? null;

    const updatePayload: Record<string, unknown> = { habilitado };
    // Sella la fecha de alta la primera vez que se habilita; nunca la borra.
    if (habilitado && !fechaAltaPrevia) {
      updatePayload["fecha_alta"] = new Date().toISOString().slice(0, 10);
    }

    const { data: updated, error: updateError } = await db
      .from("modulos_contratados")
      .update(updatePayload)
      .eq("tenant_id", tenantId)
      .eq("modulo", modulo)
      .select(MODULOS_SELECT)
      .single();

    if (updateError || !updated) {
      throw new DomainError(
        ErrorCode.INTERNAL_ERROR,
        500,
        updateError?.message ?? "No se pudo actualizar el módulo",
      );
    }

    // RN-SM3: vigencia inmediata sin esperar el TTL de 60 s.
    invalidateModuleCache(tenantId, modulo);

    // RN-SM4: auditoría de plataforma.
    await recordAudit(db as unknown as SupabaseClient, {
      tenantId:  null,
      userId:    ctx.superAdminId,
      userName:  ctx.superAdminName ?? "super_admin",
      userRole:  "super_admin",
      action:    "UPDATE",
      module:    "platform",
      entityId:  tenantId,
      oldValues: { modulo, habilitado: (actual?.["habilitado"] as boolean | undefined) ?? null },
      newValues: { modulo, habilitado },
    });

    return toPublic(updated as Record<string, unknown>);
  },
};
