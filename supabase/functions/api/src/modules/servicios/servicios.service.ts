import { DomainError, ErrorCode } from "../../shared/errors.ts";
import { recordAudit } from "../../shared/audit.ts";
import { getServiceDb } from "../../shared/db.ts";
import { sanitizeLikeTerm } from "../../shared/sanitize.ts";
import {
  CrearServicioSchema,
  ActualizarServicioSchema,
  type CrearServicioDto,
  type ActualizarServicioDto,
  type ListarServiciosOpts,
} from "./servicios.schemas.ts";

// ─── Tipos públicos ───────────────────────────────────────────────────────────

export interface CallerContext {
  tenantId:     string;
  callerUserId: string;
  callerName:   string;
  callerRole:   string;
}

export interface ServicioPublico {
  id:                  string;
  nombre:              string;
  tipo:                string;
  duracionMinutos:     number;
  requiereProfesional: boolean;
  descripcion:         string | null;
  activo:              boolean;
  createdAt:           string;
  precio:              number | null;
  alicuotaIva:         number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toPublic(row: Record<string, unknown>): ServicioPublico {
  return {
    id:                  row["id"]                  as string,
    nombre:              row["nombre"]               as string,
    tipo:                row["tipo"]                 as string,
    duracionMinutos:     row["duracion_minutos"]     as number,
    requiereProfesional: row["requiere_profesional"] as boolean,
    descripcion:         (row["descripcion"]         as string | null) ?? null,
    activo:              row["activo"]               as boolean,
    createdAt:           row["created_at"]           as string,
    precio:              row["precio"] != null ? Number(row["precio"]) : null,
    alicuotaIva:         Number(row["alicuota_iva"]),
  };
}

/** RN-SV1: validación defense-in-depth (el Controller ya validó con Zod). */
function assertDuracion(duracionMinutos: number): void {
  if (
    !Number.isInteger(duracionMinutos) ||
    duracionMinutos < 5 ||
    duracionMinutos > 480 ||
    duracionMinutos % 5 !== 0
  ) {
    throw new DomainError(
      ErrorCode.VALIDATION_ERROR,
      422,
      "duracionMinutos debe ser un entero entre 5 y 480 y múltiplo de 5",
    );
  }
}

// ─── ServicioService ──────────────────────────────────────────────────────────

export const ServicioService = {
  /** Registrar Servicio (RN-SV1, RN-SV2, RN-SV5, RN-SV6, RN-SV7). */
  async crear(dto: CrearServicioDto, ctx: CallerContext): Promise<ServicioPublico> {
    const parsed = CrearServicioSchema.safeParse(dto);
    if (!parsed.success) {
      throw new DomainError(
        ErrorCode.VALIDATION_ERROR,
        422,
        "Datos de servicio inválidos",
        parsed.error.issues,
      );
    }
    const data = parsed.data;

    // RN-SV1 (defense-in-depth: también validado por Zod en el Controller).
    assertDuracion(data.duracionMinutos);

    const db = getServiceDb();

    // RN-SV2: pre-query de nombre activo en el tenant (índice UNIQUE parcial WHERE activo).
    const { data: existente } = await db
      .from("servicios")
      .select("id")
      .eq("tenant_id", ctx.tenantId)
      .eq("activo", true)
      .ilike("nombre", data.nombre)
      .maybeSingle();

    if (existente) {
      throw new DomainError(
        ErrorCode.SERVICE_IN_USE,
        409,
        `Ya existe un servicio activo con el nombre "${data.nombre}" en este tenant`,
      );
    }

    const payload = {
      tenant_id:            ctx.tenantId, // RN-SV5: siempre del JWT
      nombre:               data.nombre,
      tipo:                 data.tipo,
      duracion_minutos:     data.duracionMinutos,
      requiere_profesional: data.requiereProfesional, // RN-SV4: persiste el flag tal cual
      descripcion:          data.descripcion ?? null,
      activo:               true,
      precio:               data.precio ?? null,
      alicuota_iva:         data.alicuotaIva,
    };

    const { data: row, error } = await db
      .from("servicios")
      .insert(payload)
      .select("*")
      .single();

    if (error || !row) {
      throw new DomainError(
        ErrorCode.INTERNAL_ERROR,
        500,
        `No se pudo crear el servicio: ${error?.message ?? ""}`,
      );
    }

    // RN-SV7: auditoría CREATE en módulo services.
    await recordAudit(db as never, {
      tenantId:  ctx.tenantId,
      userId:    ctx.callerUserId,
      userName:  ctx.callerName,
      userRole:  ctx.callerRole,
      action:    "CREATE",
      module:    "services",
      entityId:  (row as unknown as Record<string, unknown>)["id"] as string,
      newValues: payload as Record<string, unknown>,
    });

    return toPublic(row as unknown as Record<string, unknown>);
  },

  /** Editar Servicio (RN-SV1, RN-SV2 si cambia nombre, RN-SV7). */
  async actualizar(id: string, dto: ActualizarServicioDto, ctx: CallerContext): Promise<ServicioPublico> {
    const parsed = ActualizarServicioSchema.safeParse(dto);
    if (!parsed.success) {
      throw new DomainError(
        ErrorCode.VALIDATION_ERROR,
        422,
        "Datos de servicio inválidos",
        parsed.error.issues,
      );
    }
    const data = parsed.data;

    if (data.duracionMinutos !== undefined) {
      assertDuracion(data.duracionMinutos); // RN-SV1
    }

    const db = getServiceDb();

    // El servicio debe existir y pertenecer al tenant.
    const { data: actual } = await db
      .from("servicios")
      .select("*")
      .eq("id", id)
      .eq("tenant_id", ctx.tenantId)
      .single();

    if (!actual) {
      throw new DomainError(ErrorCode.SERVICE_NOT_FOUND, 404, "Servicio no encontrado en este tenant");
    }

    const actualRow = actual as unknown as Record<string, unknown>;

    // RN-SV2: si cambia el nombre, verificar que no colisione con otro activo.
    if (data.nombre !== undefined && data.nombre !== actualRow["nombre"]) {
      const { data: colision } = await db
        .from("servicios")
        .select("id")
        .eq("tenant_id", ctx.tenantId)
        .eq("activo", true)
        .ilike("nombre", data.nombre)
        .maybeSingle();

      if (colision) {
        throw new DomainError(
          ErrorCode.SERVICE_IN_USE,
          409,
          `Ya existe un servicio activo con el nombre "${data.nombre}" en este tenant`,
        );
      }
    }

    const updatePayload: Record<string, unknown> = {};
    if (data.nombre              !== undefined) updatePayload["nombre"]               = data.nombre;
    if (data.tipo                !== undefined) updatePayload["tipo"]                 = data.tipo;
    if (data.duracionMinutos     !== undefined) updatePayload["duracion_minutos"]     = data.duracionMinutos;
    if (data.requiereProfesional !== undefined) updatePayload["requiere_profesional"] = data.requiereProfesional;
    if (data.descripcion         !== undefined) updatePayload["descripcion"]          = data.descripcion ?? null;
    if (data.precio              !== undefined) updatePayload["precio"]               = data.precio;
    if (data.alicuotaIva         !== undefined) updatePayload["alicuota_iva"]          = data.alicuotaIva;

    const { data: row, error } = await db
      .from("servicios")
      .update(updatePayload)
      .eq("id", id)
      .eq("tenant_id", ctx.tenantId)
      .select("*")
      .single();

    if (error) {
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, error.message);
    }

    // RN-SV7: auditoría UPDATE.
    await recordAudit(db as never, {
      tenantId:  ctx.tenantId,
      userId:    ctx.callerUserId,
      userName:  ctx.callerName,
      userRole:  ctx.callerRole,
      action:    "UPDATE",
      module:    "services",
      entityId:  id,
      oldValues: actualRow,
      newValues: updatePayload,
    });

    return toPublic(
      (row ?? { ...actualRow, ...updatePayload }) as unknown as Record<string, unknown>,
    );
  },

  /**
   * Activar / Desactivar Servicio (RN-SV3, RN-SV7).
   *
   * RN-SV3: si se desactiva (activo=false) y el servicio tiene turnos con fecha
   * futura, se rechaza la operación.
   *
   * TODO E6: con el módulo Turnos implementado (Etapa 6), la tabla `turnos`
   * tendrá datos reales. El guard ya consulta la tabla; en E1 está vacía, por
   * lo que en integración la baja procede sin conflicto. El unit test la mockea
   * con datos para probar la rama de error de RN-SV3.
   */
  async cambiarEstado(id: string, activo: boolean, ctx: CallerContext): Promise<ServicioPublico> {
    const db = getServiceDb();

    const { data: actual } = await db
      .from("servicios")
      .select("*")
      .eq("id", id)
      .eq("tenant_id", ctx.tenantId)
      .single();

    if (!actual) {
      throw new DomainError(ErrorCode.SERVICE_NOT_FOUND, 404, "Servicio no encontrado en este tenant");
    }

    // RN-SV3: guard de baja protegida (tabla turnos vacía hasta E6).
    // El filtro por tenant_id es explícito y NO redundante: esta consulta corre
    // con service role (RLS bypasseada), así que el aislamiento lo escribe la
    // query o no lo escribe nadie. Sin él, un turno de otra clínica que apunte
    // al mismo servicio_id bloquearía la baja acá — y de paso confirmaría su
    // existencia.
    if (!activo) {
      const hoy = new Date().toISOString().slice(0, 10);
      const { data: turnosFuturos, count } = await db
        .from("turnos")
        .select("id", { count: "exact" })
        .eq("tenant_id", ctx.tenantId)
        .eq("servicio_id", id)
        .gte("date", hoy)
        .range(0, 0);

      const hayTurnosFuturos = (count ?? 0) > 0 || (turnosFuturos?.length ?? 0) > 0;
      if (hayTurnosFuturos) {
        throw new DomainError(
          ErrorCode.VALIDATION_ERROR,
          422,
          "No se puede desactivar un servicio con turnos futuros programados",
          [{ field: "activo", message: "Existen turnos futuros que referencian este servicio" }],
        );
      }
    }

    const { data: row, error } = await db
      .from("servicios")
      .update({ activo })
      .eq("id", id)
      .eq("tenant_id", ctx.tenantId)
      .select("*")
      .single();

    if (error) {
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, error.message);
    }

    // RN-SV7: auditoría UPDATE.
    await recordAudit(db as never, {
      tenantId:  ctx.tenantId,
      userId:    ctx.callerUserId,
      userName:  ctx.callerName,
      userRole:  ctx.callerRole,
      action:    "UPDATE",
      module:    "services",
      entityId:  id,
      oldValues: actual as unknown as Record<string, unknown>,
      newValues: { activo },
    });

    return toPublic(
      (row ?? { ...(actual as unknown as Record<string, unknown>), activo }) as unknown as Record<string, unknown>,
    );
  },

  /** Detalle de un servicio del tenant. */
  async obtenerPorId(id: string, tenantId: string): Promise<ServicioPublico | null> {
    const db = getServiceDb();
    const { data } = await db
      .from("servicios")
      .select("*")
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .single();

    return data ? toPublic(data as unknown as Record<string, unknown>) : null;
  },

  /** Listar y paginar servicios del tenant, con filtros opcionales. */
  async buscarPaginado(
    opts: ListarServiciosOpts,
    tenantId: string,
  ): Promise<{ items: ServicioPublico[]; total: number }> {
    const db     = getServiceDb();
    const offset = (opts.page - 1) * opts.limit;

    let query = db
      .from("servicios")
      .select("*", { count: "exact" })
      .eq("tenant_id", tenantId);

    if (opts.activo !== undefined) {
      query = query.eq("activo", opts.activo);
    }
    if (opts.tipo) {
      query = query.eq("tipo", opts.tipo);
    }
    if (opts.search) {
      const term = sanitizeLikeTerm(opts.search);
      query = query.ilike("nombre", `%${term}%`);
    }

    const { data, error, count } = await query
      .order("created_at", { ascending: false })
      .range(offset, offset + opts.limit - 1);

    if (error) {
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, error.message);
    }

    const items = ((data as unknown[]) ?? []).map((r) =>
      toPublic(r as Record<string, unknown>),
    );
    return { items, total: count ?? 0 };
  },

  /**
   * Listar solo servicios activos del tenant.
   * Consumido por TurnoService (Etapa 6) para poblar el Combobox de Servicio
   * y resolver la duración del turno server-side (RN-TU9).
   */
  async listarActivos(tenantId: string): Promise<ServicioPublico[]> {
    const db = getServiceDb();
    const { data, error } = await db
      .from("servicios")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("activo", true)
      .order("nombre", { ascending: true });

    if (error) {
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, error.message);
    }

    return ((data as unknown[]) ?? []).map((r) =>
      toPublic(r as Record<string, unknown>),
    );
  },
};
