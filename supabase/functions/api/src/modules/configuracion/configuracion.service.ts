import { DomainError, ErrorCode } from "../../shared/errors.ts";
import { recordAudit } from "../../shared/audit.ts";
import { getServiceDb } from "../../shared/db.ts";
import {
  ActualizarConfiguracionSchema,
  type ActualizarConfiguracionDto,
  type ConfiguracionPublica,
} from "./configuracion.schemas.ts";

export interface CallerContext {
  tenantId:     string;
  callerUserId: string;
  callerName:   string;
  callerRole:   string;
}

function toPublic(row: Record<string, unknown>): ConfiguracionPublica {
  return {
    cupoMaximoDiario: row["cupo_maximo_diario"] as number,
    diasAvisoVacuna:  row["dias_aviso_vacuna"]  as number,
    parametrosExtra:  (row["parametros_extra"]  as Record<string, unknown>) ?? {},
    updatedAt:        row["updated_at"]          as string,
  };
}

export const ConfiguracionService = {
  /** RN-CF1: devuelve el singleton de configuración del tenant. */
  async obtener(tenantId: string): Promise<ConfiguracionPublica> {
    const db = getServiceDb();

    const { data: row, error } = await db
      .from("configuracion_tenant")
      .select("*")
      .eq("tenant_id", tenantId)
      .single();

    if (error || !row) {
      // Fallo del seeder Nivel 2 — incidente crítico.
      console.error(
        `[configuracion] CONFIG_NOT_FOUND para tenant ${tenantId} — fallo del seeder on_tenant_created`,
        error?.message,
      );
      throw new DomainError(
        ErrorCode.CONFIG_NOT_FOUND,
        404,
        "Configuración de la clínica no encontrada. Contacte a soporte.",
      );
    }

    return toPublic(row as unknown as Record<string, unknown>);
  },

  /** RN-CF1/CF2/CF5: actualiza el singleton, valida rangos, audita con valores previos/nuevos. */
  async actualizar(
    tenantId: string,
    dto: ActualizarConfiguracionDto,
    ctx: CallerContext,
  ): Promise<ConfiguracionPublica> {
    // Defense-in-depth: re-valida rangos (el Controller ya validó con Zod).
    const parsed = ActualizarConfiguracionSchema.safeParse(dto);
    if (!parsed.success) {
      throw new DomainError(
        ErrorCode.VALIDATION_ERROR,
        422,
        "Datos de configuración inválidos",
        parsed.error.issues,
      );
    }
    const data = parsed.data;

    const db = getServiceDb();

    // SELECT previo para auditoría (RN-CF5: oldValues).
    const { data: oldRow, error: fetchError } = await db
      .from("configuracion_tenant")
      .select("*")
      .eq("tenant_id", tenantId)
      .single();

    if (fetchError || !oldRow) {
      console.error(
        `[configuracion] CONFIG_NOT_FOUND al actualizar tenant ${tenantId}`,
        fetchError?.message,
      );
      throw new DomainError(
        ErrorCode.CONFIG_NOT_FOUND,
        404,
        "Configuración de la clínica no encontrada. Contacte a soporte.",
      );
    }

    const oldPublic = toPublic(oldRow as unknown as Record<string, unknown>);

    const payload: Record<string, unknown> = {
      cupo_maximo_diario: data.cupoMaximoDiario,
      dias_aviso_vacuna:  data.diasAvisoVacuna,
      updated_at:         new Date().toISOString(),
    };
    if (data.parametrosExtra !== undefined) {
      payload["parametros_extra"] = data.parametrosExtra;
    }

    const { data: newRow, error: updateError } = await db
      .from("configuracion_tenant")
      .update(payload)
      .eq("tenant_id", tenantId)
      .select("*")
      .single();

    if (updateError || !newRow) {
      throw new DomainError(
        ErrorCode.INTERNAL_ERROR,
        500,
        `No se pudo actualizar la configuración: ${updateError?.message ?? ""}`,
      );
    }

    const newPublic = toPublic(newRow as unknown as Record<string, unknown>);

    // RN-CF5: auditoría UPDATE en módulo system.
    await recordAudit(db as never, {
      tenantId:  ctx.tenantId,
      userId:    ctx.callerUserId,
      userName:  ctx.callerName,
      userRole:  ctx.callerRole,
      action:    "UPDATE",
      module:    "system",
      entityId:  tenantId,
      oldValues: { cupoMaximoDiario: oldPublic.cupoMaximoDiario, diasAvisoVacuna: oldPublic.diasAvisoVacuna },
      newValues: { cupoMaximoDiario: newPublic.cupoMaximoDiario, diasAvisoVacuna: newPublic.diasAvisoVacuna },
    });

    return newPublic;
  },

  /** API interna para EstadiaService y PlanVacunacionService (RN-CF3: sin caché). */
  async valor(tenantId: string, key: keyof ConfiguracionPublica): Promise<unknown> {
    const cfg = await ConfiguracionService.obtener(tenantId);
    return cfg[key];
  },
};
