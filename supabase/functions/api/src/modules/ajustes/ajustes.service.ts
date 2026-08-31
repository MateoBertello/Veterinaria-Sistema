import { getServiceDb } from "../../shared/db.ts";
import { DomainError, ErrorCode } from "../../shared/errors.ts";
import type {
  AjustarExistenciaDto,
  BloquearLoteDto,
  DesbloquearLoteDto,
  CrearRecuentoDto,
  GuardarDetallesRecuentoDto,
  AplicarRecuentoDto,
  ListarRecuentosQuery,
  RegistrarDevolucionDto,
} from "./ajustes.schemas.ts";

export interface Context {
  tenantId:     string;
  callerUserId: string;
  callerName?:  string;
  callerRole?:  string;
  permisos?:    Set<string>;
}

export function mapAjusteRpcError(err: { message: string; code?: string } | null): DomainError {
  const msg = err?.message ?? "";

  if (msg.includes("REASON_REQUIRED")) {
    return new DomainError(ErrorCode.REASON_REQUIRED, 422, "El motivo es obligatorio y debe tener al menos 10 caracteres");
  }
  if (msg.includes("BATCH_NOT_FOUND")) {
    return new DomainError(ErrorCode.BATCH_NOT_FOUND, 404, "Lote no encontrado");
  }
  if (msg.includes("BATCH_EXPIRED")) {
    return new DomainError(ErrorCode.BATCH_EXPIRED, 409, "La única salida permitida para un lote vencido es merma por vencimiento");
  }
  if (msg.includes("BATCH_BLOCKED")) {
    return new DomainError(ErrorCode.BATCH_BLOCKED, 409, "El lote se encuentra bloqueado");
  }
  if (msg.includes("INSUFFICIENT_STOCK")) {
    return new DomainError(ErrorCode.INSUFFICIENT_STOCK, 409, "La existencia disponible es insuficiente para el ajuste");
  }
  if (msg.includes("UNIT_NO_DECIMALS")) {
    return new DomainError(ErrorCode.UNIT_NO_DECIMALS, 422, "La cantidad no respeta los decimales configurados para la unidad");
  }
  if (msg.includes("INVALID_ADJUSTMENT_TYPE")) {
    return new DomainError(ErrorCode.VALIDATION_ERROR, 422, "Tipo de ajuste inválido");
  }
  if (msg.includes("COUNT_NOT_FOUND")) {
    return new DomainError(ErrorCode.COUNT_NOT_FOUND, 404, "Recuento no encontrado");
  }
  if (msg.includes("COUNT_ALREADY_APPLIED")) {
    return new DomainError(ErrorCode.COUNT_ALREADY_APPLIED, 409, "El recuento ya fue aplicado");
  }
  if (msg.includes("COUNT_WITHOUT_DETAIL")) {
    return new DomainError(ErrorCode.COUNT_WITHOUT_DETAIL, 422, "El recuento no tiene líneas de detalle");
  }
  if (msg.includes("COUNT_STALE")) {
    let details: unknown[] = [];
    try {
      const jsonStr = msg.replace(/^.*?COUNT_STALE:/, "");
      details = JSON.parse(jsonStr);
    } catch {
      // details stays empty
    }
    return new DomainError(ErrorCode.COUNT_STALE, 409, "Existen lotes cuya existencia cambió desde que se abrió el recuento", details);
  }
  if (msg.includes("SALE_NOT_FOUND")) {
    return new DomainError(ErrorCode.SALE_NOT_FOUND, 404, "Venta no encontrada");
  }
  if (msg.includes("SALE_ITEM_NOT_FOUND")) {
    return new DomainError(ErrorCode.SALE_NOT_FOUND, 404, "Ítem de venta no encontrado");
  }
  if (msg.includes("RETURN_EXCEEDS_SOLD")) {
    return new DomainError(ErrorCode.RETURN_EXCEEDS_SOLD, 409, "La cantidad a devolver excede lo vendido en la venta original");
  }
  if (msg.includes("CASH_SESSION_REQUIRED")) {
    return new DomainError(ErrorCode.CASH_SESSION_REQUIRED, 409, "Se requiere una sesión de caja abierta para el reintegro de efectivo");
  }
  if (msg.includes("uq_recuento_borrador")) {
    return new DomainError(ErrorCode.VALIDATION_ERROR, 409, "Ya existe un recuento en estado borrador para este tenant");
  }

  return new DomainError(ErrorCode.INTERNAL_ERROR, 500, err?.message ?? "Error interno al procesar el ajuste");
}

export const AjustesService = {
  /**
   * RN-AJ1, RN-AJ2, RN-AJ7: Ajuste directo de stock sobre un lote.
   */
  async ajustarExistencia(dto: AjustarExistenciaDto, tenantId: string, userId: string) {
    const db = getServiceDb();
    const { data, error } = await db.rpc("ajustar_existencia", {
      p_tenant_id: tenantId,
      p_usuario_id: userId,
      p_lote_id: dto.loteId,
      p_tipo: dto.tipo,
      p_cantidad: dto.cantidad,
      p_motivo: dto.motivo,
    });

    if (error) {
      throw mapAjusteRpcError(error);
    }

    const row = Array.isArray(data) ? data[0] : data;
    return {
      operacionId: row.operacion_id,
      movimientoId: row.movimiento_id,
      existenciaFinal: Number(row.existencia_final),
    };
  },

  /**
   * RN-AJ1, RN-LO7: Bloquear un lote con motivo.
   */
  async bloquearLote(loteId: string, dto: BloquearLoteDto, tenantId: string, userId: string) {
    const db = getServiceDb();
    const { data, error } = await db.rpc("bloquear_lote", {
      p_tenant_id: tenantId,
      p_usuario_id: userId,
      p_lote_id: loteId,
      p_motivo: dto.motivo,
    });

    if (error) {
      throw mapAjusteRpcError(error);
    }

    const row = Array.isArray(data) ? data[0] : data;
    return {
      id: row.id,
      estado: row.estado,
      motivoBloqueo: row.motivo_bloqueo,
    };
  },

  /**
   * RN-AJ1, RN-LO7: Desbloquear un lote conservando motivo histórico de bloqueo.
   */
  async desbloquearLote(loteId: string, dto: DesbloquearLoteDto, tenantId: string, userId: string) {
    const db = getServiceDb();
    const { data, error } = await db.rpc("desbloquear_lote", {
      p_tenant_id: tenantId,
      p_usuario_id: userId,
      p_lote_id: loteId,
      p_motivo: dto.motivo,
    });

    if (error) {
      throw mapAjusteRpcError(error);
    }

    const row = Array.isArray(data) ? data[0] : data;
    return {
      id: row.id,
      estado: row.estado,
      motivoBloqueo: row.motivo_bloqueo,
    };
  },

  /**
   * Crear borrador de recuento de inventario.
   */
  async crearRecuento(dto: CrearRecuentoDto, tenantId: string, userId: string) {
    const db = getServiceDb();
    const { data, error } = await db
      .from("recuentos")
      .insert({
        tenant_id: tenantId,
        usuario_id: userId,
        estado: "borrador",
        observaciones: dto.observaciones ?? null,
      })
      .select("id, numero, estado, observaciones, created_at")
      .single();

    if (error) {
      throw mapAjusteRpcError(error);
    }

    return {
      id: data.id,
      numero: data.numero,
      estado: data.estado,
      observaciones: data.observaciones,
      createdAt: data.created_at,
    };
  },

  /**
   * Listar recuentos con paginación y filtro opcional por estado.
   */
  async listarRecuentos(query: ListarRecuentosQuery, tenantId: string) {
    const db = getServiceDb();
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const offset = (page - 1) * limit;

    let q = db
      .from("recuentos")
      .select(
        `
        id, numero, estado, observaciones, created_at, aplicado_at,
        usuario:usuarios!recuentos_usuario_tenant_fkey(id, full_name),
        aplicado_por:usuarios!recuentos_aplicador_tenant_fkey(id, full_name)
      `,
        { count: "exact" },
      )
      .eq("tenant_id", tenantId);

    if (query.estado) {
      q = q.eq("estado", query.estado);
    }

    const { data, error, count } = await q
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, error.message);
    }

    const recuentos = (data ?? []).map((r: any) => ({
      id: r.id,
      numero: r.numero,
      estado: r.estado,
      observaciones: r.observaciones,
      createdAt: r.created_at,
      aplicadoAt: r.aplicado_at,
      usuario: r.usuario ? { id: r.usuario.id, nombre: r.usuario.full_name } : null,
      aplicadoPor: r.aplicado_por ? { id: r.aplicado_por.id, nombre: r.aplicado_por.full_name } : null,
    }));

    return {
      data: recuentos,
      meta: {
        page,
        limit,
        total: count ?? 0,
      },
    };
  },

  /**
   * Obtener recuento por ID con sus líneas de detalle.
   */
  async obtenerRecuento(recuentoId: string, tenantId: string) {
    const db = getServiceDb();

    const { data: recuento, error: errRec } = await db
      .from("recuentos")
      .select(`
        id, numero, estado, observaciones, created_at, aplicado_at,
        usuario:usuarios!recuentos_usuario_tenant_fkey(id, full_name),
        aplicado_por:usuarios!recuentos_aplicador_tenant_fkey(id, full_name)
      `)
      .eq("id", recuentoId)
      .eq("tenant_id", tenantId)
      .single();

    if (errRec || !recuento) {
      throw new DomainError(ErrorCode.COUNT_NOT_FOUND, 404, "Recuento no encontrado");
    }

    const { data: detalles, error: errDet } = await db
      .from("recuentos_detalle")
      .select(`
        id, lote_id, cantidad_sistema, cantidad_contada, diferencia, motivo,
        lote:lotes!recuentos_detalle_lote_tenant_fkey(
          id, codigo_lote, fecha_vencimiento,
          producto:productos!lotes_producto_tenant_fkey(id, nombre, codigo)
        )
      `)
      .eq("recuento_id", recuentoId)
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: true });

    if (errDet) {
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, errDet.message);
    }

    return {
      id: recuento.id,
      numero: recuento.numero,
      estado: recuento.estado,
      observaciones: recuento.observaciones,
      createdAt: recuento.created_at,
      aplicadoAt: recuento.aplicado_at,
      usuario: (recuento as any).usuario ? { id: (recuento as any).usuario.id, nombre: (recuento as any).usuario.full_name } : null,
      aplicadoPor: (recuento as any).aplicado_por ? { id: (recuento as any).aplicado_por.id, nombre: (recuento as any).aplicado_por.full_name } : null,
      detalles: (detalles ?? []).map((d: any) => ({
        id: d.id,
        loteId: d.lote_id,
        codigoLote: d.lote?.codigo_lote ?? null,
        fechaVencimiento: d.lote?.fecha_vencimiento ?? null,
        producto: d.lote?.producto ? { id: d.lote.producto.id, codigo: d.lote.producto.codigo, nombre: d.lote.producto.nombre } : null,
        cantidadSistema: d.cantidad_sistema !== null ? Number(d.cantidad_sistema) : null,
        cantidadContada: Number(d.cantidad_contada),
        diferencia: d.diferencia !== null ? Number(d.diferencia) : null,
        motivo: d.motivo ?? null,
      })),
    };
  },

  /**
   * Guardar o actualizar detalles de un recuento en borrador.
   */
  async guardarDetallesRecuento(recuentoId: string, dto: GuardarDetallesRecuentoDto, tenantId: string) {
    const db = getServiceDb();

    // 1. Validar que el recuento existe y está en borrador
    const { data: recuento, error: errRec } = await db
      .from("recuentos")
      .select("id, estado")
      .eq("id", recuentoId)
      .eq("tenant_id", tenantId)
      .single();

    if (errRec || !recuento) {
      throw new DomainError(ErrorCode.COUNT_NOT_FOUND, 404, "Recuento no encontrado");
    }
    if (recuento.estado !== "borrador") {
      throw new DomainError(ErrorCode.COUNT_ALREADY_APPLIED, 409, "No se pueden modificar los detalles de un recuento ya aplicado");
    }

    // 2. Eliminar detalles anteriores
    const { error: errDel } = await db
      .from("recuentos_detalle")
      .delete()
      .eq("recuento_id", recuentoId)
      .eq("tenant_id", tenantId);

    if (errDel) {
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, errDel.message);
    }

    // 3. Insertar nuevos detalles
    const rowsToInsert = dto.items.map((item) => ({
      tenant_id: tenantId,
      recuento_id: recuentoId,
      lote_id: item.loteId,
      cantidad_contada: item.cantidadContada,
      cantidad_sistema: item.cantidadSistema ?? null,
      motivo: item.motivo ?? null,
    }));

    const { error: errIns } = await db.from("recuentos_detalle").insert(rowsToInsert);

    if (errIns) {
      throw mapAjusteRpcError(errIns);
    }

    return {
      recuentoId,
      itemsCount: dto.items.length,
    };
  },

  /**
   * RN-AJ3, RN-AJ6: Aplicar recuento de inventario.
   */
  async aplicarRecuento(recuentoId: string, dto: AplicarRecuentoDto, tenantId: string, userId: string) {
    const db = getServiceDb();
    const { data, error } = await db.rpc("aplicar_recuento", {
      p_tenant_id: tenantId,
      p_usuario_id: userId,
      p_recuento_id: recuentoId,
      p_confirmar_desvios: dto.confirmarDesvios,
    });

    if (error) {
      throw mapAjusteRpcError(error);
    }

    const row = Array.isArray(data) ? data[0] : data;
    return {
      recuentoId: row.recuento_id,
      operacionId: row.operacion_id,
      ajustesGenerados: row.ajustes_generados,
      lotesMovidos: row.lotes_movidos ?? null,
    };
  },

  /**
   * Eliminar un recuento en borrador.
   */
  async eliminarRecuento(recuentoId: string, tenantId: string) {
    const db = getServiceDb();

    const { data: recuento, error: errRec } = await db
      .from("recuentos")
      .select("id, estado")
      .eq("id", recuentoId)
      .eq("tenant_id", tenantId)
      .single();

    if (errRec || !recuento) {
      throw new DomainError(ErrorCode.COUNT_NOT_FOUND, 404, "Recuento no encontrado");
    }
    if (recuento.estado !== "borrador") {
      throw new DomainError(ErrorCode.COUNT_ALREADY_APPLIED, 409, "No se puede eliminar un recuento ya aplicado");
    }

    const { error: errDel } = await db
      .from("recuentos")
      .delete()
      .eq("id", recuentoId)
      .eq("tenant_id", tenantId);

    if (errDel) {
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, errDel.message);
    }

    return {
      id: recuentoId,
      deleted: true,
    };
  },

  /**
   * RN-AJ1, RN-AJ4, RN-AJ5: Registrar devolución de venta.
   */
  async registrarDevolucion(dto: RegistrarDevolucionDto, tenantId: string, userId: string) {
    const db = getServiceDb();
    const { data, error } = await db.rpc("registrar_devolucion", {
      p_tenant_id: tenantId,
      p_usuario_id: userId,
      p_venta_id: dto.ventaId,
      p_items: JSON.stringify(dto.items),
      p_motivo: dto.motivo,
      p_reintegra_efectivo: dto.reintegraEfectivo,
      p_sesion_caja_id: dto.sesionCajaId ?? null,
    });

    if (error) {
      throw mapAjusteRpcError(error);
    }

    const row = Array.isArray(data) ? data[0] : data;
    return {
      devolucionId: row.devolucion_id,
      operacionId: row.operacion_id,
      itemsDevueltos: row.items_devueltos,
      reintegroTotal: Number(row.reintegro_total),
    };
  },
};
