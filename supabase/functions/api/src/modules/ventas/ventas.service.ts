import { getServiceDb } from "../../shared/db.ts";
import { DomainError, ErrorCode } from "../../shared/errors.ts";
import type {
  RegistrarVentaDto,
  AnularVentaDto,
  ListarVentasQuery,
  ReporteMargenQuery,
  ReporteItemsVendidosQuery,
} from "./ventas.schemas.ts";

export interface Context {
  tenantId:     string;
  callerUserId: string;
  callerName?:  string;
  callerRole?:  string;
  permisos?:    Set<string>;
}

export function mapVentaRpcError(err: { message: string; code?: string } | null): DomainError {
  const msg = err?.message ?? "";

  if (msg.includes("SALE_NOT_FOUND")) {
    return new DomainError(ErrorCode.SALE_NOT_FOUND, 404, "Venta no encontrada");
  }
  if (msg.includes("SALE_ALREADY_ANNULLED")) {
    return new DomainError(ErrorCode.SALE_ALREADY_VOIDED, 409, "La venta ya se encuentra anulada");
  }
  if (msg.includes("SALE_WITHOUT_ITEMS")) {
    return new DomainError(ErrorCode.SALE_WITHOUT_ITEMS, 422, "Una venta debe contener al menos un ítem");
  }
  if (msg.includes("PAYMENT_MISMATCH")) {
    return new DomainError(ErrorCode.PAYMENT_MISMATCH, 422, "Los pagos no coinciden con el total de la venta");
  }
  if (msg.includes("PAYMENT_REFERENCE_REQUIRED")) {
    return new DomainError(ErrorCode.PAYMENT_REFERENCE_REQUIRED, 422, "El medio de pago requiere número de referencia");
  }
  if (msg.includes("CASH_SESSION_REQUIRED")) {
    return new DomainError(ErrorCode.CASH_SESSION_REQUIRED, 409, "Se requiere una sesión de caja abierta");
  }
  if (msg.includes("INSUFFICIENT_STOCK")) {
    return new DomainError(ErrorCode.INSUFFICIENT_STOCK, 409, "Stock insuficiente para satisfacer la venta");
  }
  if (msg.includes("BATCH_EXPIRED")) {
    return new DomainError(ErrorCode.BATCH_EXPIRED, 409, "El lote seleccionado se encuentra vencido");
  }
  if (msg.includes("BATCH_BLOCKED")) {
    return new DomainError(ErrorCode.BATCH_BLOCKED, 409, "El lote seleccionado se encuentra bloqueado");
  }
  if (msg.includes("FEFO_OVERRIDE_WITHOUT_REASON")) {
    return new DomainError(ErrorCode.FEFO_OVERRIDE_WITHOUT_REASON, 422, "Se requiere motivo de al menos 10 caracteres para alterar FEFO");
  }
  if (msg.includes("PRODUCT_NOT_FOUND")) {
    return new DomainError(ErrorCode.PRODUCT_NOT_FOUND, 404, "Producto no encontrado");
  }
  if (msg.includes("SERVICE_NOT_FOUND")) {
    return new DomainError(ErrorCode.SERVICE_NOT_FOUND, 404, "Servicio no encontrado");
  }
  if (msg.includes("PRODUCT_INACTIVE")) {
    return new DomainError(ErrorCode.PRODUCT_INACTIVE, 409, "El ítem seleccionado se encuentra inactivo");
  }
  if (msg.includes("PRODUCT_NOT_SELLABLE")) {
    return new DomainError(ErrorCode.PRODUCT_NOT_SELLABLE, 409, "El producto no está habilitado para la venta");
  }
  if (msg.includes("PRODUCT_WITHOUT_PRICE")) {
    return new DomainError(ErrorCode.PRODUCT_WITHOUT_PRICE, 409, "El producto o servicio no tiene precio configurado");
  }
  if (msg.includes("UNIT_NO_DECIMALS")) {
    return new DomainError(ErrorCode.UNIT_NO_DECIMALS, 422, "La cantidad no respeta los decimales de la unidad");
  }
  if (msg.includes("ANULATION_REASON_REQUIRED")) {
    return new DomainError(ErrorCode.REASON_REQUIRED, 422, "El motivo de anulación debe tener al menos 10 caracteres");
  }
  if (msg.includes("VALIDATION_ERROR")) {
    return new DomainError(ErrorCode.VALIDATION_ERROR, 422, "Datos de venta inválidos");
  }

  return new DomainError(ErrorCode.INTERNAL_ERROR, 500, "Error interno al procesar la venta");
}

export const VentaService = {
  async registrar(dto: RegistrarVentaDto, ctx: Context) {
    const db = getServiceDb();

    const { data, error } = await db.rpc("registrar_venta", {
      p_tenant_id:      ctx.tenantId,
      p_usuario_id:     ctx.callerUserId,
      p_sesion_caja_id: dto.sesionCajaId,
      p_cliente_id:     dto.clienteId ?? null,
      p_condicion_pago: dto.condicionPago,
      p_items:          dto.items,
      p_pagos:          dto.pagos,
      p_descuento:      dto.descuento,
      p_observaciones:  dto.observaciones ?? null,
    });

    if (error || !data || data.length === 0) {
      throw mapVentaRpcError(error);
    }

    const resultado = data[0];
    return {
      ventaId:        resultado.venta_id,
      numeroOperacion: resultado.numero_operacion,
      operacionId:    resultado.operacion_id,
      subtotalNeto:   resultado.subtotal_neto,
      totalIva:       resultado.total_iva,
      total:          resultado.total,
      saldoPendiente: resultado.saldo_pendiente,
    };
  },

  async anular(ventaId: string, dto: AnularVentaDto, ctx: Context) {
    const db = getServiceDb();

    const { data, error } = await db.rpc("anular_venta", {
      p_tenant_id:      ctx.tenantId,
      p_usuario_id:     ctx.callerUserId,
      p_venta_id:       ventaId,
      p_sesion_caja_id: dto.sesionCajaId,
      p_motivo:         dto.motivo,
    });

    if (error || !data || data.length === 0) {
      throw mapVentaRpcError(error);
    }

    const resultado = data[0];
    return {
      ventaId:     resultado.venta_id,
      operacionId: resultado.operacion_id,
      estado:       resultado.estado,
      anuladaAt:   resultado.anulada_at,
    };
  },

  async obtenerPorId(id: string, ctx: Context) {
    const db = getServiceDb();

    const { data, error } = await db
      .from("ventas")
      .select(`
        *,
        cliente:clientes(id, full_name, dni_cuit, condicion_fiscal),
        usuario:usuarios(id, full_name, email),
        items:ventas_items(*),
        pagos:ventas_pagos(*)
      `)
      .eq("tenant_id", ctx.tenantId)
      .eq("id", id)
      .maybeSingle();

    if (error || !data) {
      throw new DomainError(ErrorCode.SALE_NOT_FOUND, 404, "Venta no encontrada");
    }

    // §8.2: Sin view_sales solo puede ver sus propias ventas
    if (ctx.permisos && !ctx.permisos.has("view_sales") && data.usuario_id !== ctx.callerUserId) {
      throw new DomainError(ErrorCode.SALE_NOT_FOUND, 404, "Venta no encontrada");
    }

    return data;
  },

  async buscarPaginado(query: ListarVentasQuery, ctx: Context) {
    const db = getServiceDb();

    let q = db
      .from("ventas")
      .select("*, cliente:clientes(full_name), usuario:usuarios(full_name)", { count: "exact" })
      .eq("tenant_id", ctx.tenantId);

    // §8.2: Sin view_sales el listado se acota al usuario llamador
    if (ctx.permisos && !ctx.permisos.has("view_sales")) {
      q = q.eq("usuario_id", ctx.callerUserId);
    } else if (query.usuarioId) {
      q = q.eq("usuario_id", query.usuarioId);
    }

    if (query.sesionCajaId) {
      q = q.eq("sesion_caja_id", query.sesionCajaId);
    }
    if (query.clienteId) {
      q = q.eq("cliente_id", query.clienteId);
    }
    if (query.estado) {
      q = q.eq("estado", query.estado);
    }
    if (query.desde) {
      q = q.gte("created_at", query.desde);
    }
    if (query.hasta) {
      q = q.lte("created_at", query.hasta);
    }

    const from = (query.page - 1) * query.limit;
    const to = from + query.limit - 1;

    const { data, error, count } = await q.order("created_at", { ascending: false }).range(from, to);

    if (error) {
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, error.message);
    }

    return {
      items: data ?? [],
      total: count ?? 0,
      page:  query.page,
      limit: query.limit,
    };
  },

  async margenPorProducto(query: ReporteMargenQuery, ctx: Context) {
    const db = getServiceDb();

    let q = db
      .from("v_margen_venta")
      .select("*")
      .eq("tenant_id", ctx.tenantId);

    if (query.itemId) {
      q = q.eq("item_id", query.itemId);
    }
    if (query.tipoItem) {
      q = q.eq("tipo_item", query.tipoItem);
    }
    if (query.desde) {
      q = q.gte("vendido_at", query.desde);
    }
    if (query.hasta) {
      q = q.lte("vendido_at", query.hasta);
    }

    const { data, error } = await q.order("vendido_at", { ascending: false });

    if (error) {
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, error.message);
    }

    return data ?? [];
  },

  async itemsVendidos(query: ReporteItemsVendidosQuery, ctx: Context) {
    const db = getServiceDb();

    let q = db
      .from("v_items_vendidos")
      .select("*")
      .eq("tenant_id", ctx.tenantId);

    if (query.itemId) {
      q = q.eq("item_id", query.itemId);
    }
    if (query.tipoItem) {
      q = q.eq("tipo_item", query.tipoItem);
    }
    if (query.desde) {
      q = q.gte("vendido_at", query.desde);
    }
    if (query.hasta) {
      q = q.lte("vendido_at", query.hasta);
    }

    const { data, error } = await q.order("vendido_at", { ascending: false });

    if (error) {
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, error.message);
    }

    return data ?? [];
  },
};
