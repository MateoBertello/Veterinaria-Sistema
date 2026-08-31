import { getServiceDb } from "../../shared/db.ts";
import { recordAudit } from "../../shared/audit.ts";
import { DomainError, ErrorCode } from "../../shared/errors.ts";
import { assertProductoOperable } from "../productos/productos.service.ts";
import type {
  CrearCompraDto,
  ActualizarCompraDto,
  AgregarItemCompraDto,
  ActualizarItemCompraDto,
  BuscarComprasQuery,
} from "./compras.schemas.ts";

export interface ServiceContext {
  tenantId: string;
  callerUserId: string;
  callerName?: string;
  callerRole?: string;
}

/** RN-CM2: una compra confirmada no se edita. Se anula con contra-asientos. */
export async function assertBorrador(compraId: string, tenantId: string) {
  const db = getServiceDb();
  const { data, error } = await db
    .from("compras")
    .select("id, estado")
    .eq("id", compraId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error) {
    throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, error.message);
  }
  if (!data) {
    throw new DomainError(ErrorCode.PURCHASE_NOT_FOUND, 404, "Compra no encontrada");
  }
  if ((data as { estado: string }).estado !== "borrador") {
    throw new DomainError(
      ErrorCode.PURCHASE_ALREADY_CONFIRMED,
      409,
      "Una compra confirmada no se edita: se anula con contra-asientos",
    );
  }
}

function mapCompraRpcError(rawMessage: string): never {
  const msg = rawMessage.toUpperCase();

  if (msg.includes("PURCHASE_NOT_FOUND")) {
    throw new DomainError(ErrorCode.PURCHASE_NOT_FOUND, 404, "Compra no encontrada");
  }
  if (msg.includes("PURCHASE_ALREADY_CONFIRMED")) {
    throw new DomainError(ErrorCode.PURCHASE_ALREADY_CONFIRMED, 409, "La compra ya fue confirmada o no está en el estado requerido");
  }
  if (msg.includes("SUPPLIER_NOT_FOUND")) {
    throw new DomainError(ErrorCode.SUPPLIER_NOT_FOUND, 404, "Proveedor no encontrado");
  }
  if (msg.includes("SUPPLIER_INACTIVE")) {
    throw new DomainError(ErrorCode.SUPPLIER_INACTIVE, 422, "El proveedor está inactivo");
  }
  if (msg.includes("PURCHASE_WITHOUT_ITEMS")) {
    throw new DomainError(ErrorCode.PURCHASE_WITHOUT_ITEMS, 422, "La compra no tiene ítems");
  }
  if (msg.includes("PRODUCT_NOT_FOUND")) {
    throw new DomainError(ErrorCode.PRODUCT_NOT_FOUND, 404, "Producto no encontrado");
  }
  if (msg.includes("PRODUCT_INACTIVE")) {
    throw new DomainError(ErrorCode.PRODUCT_INACTIVE, 422, "El producto está inactivo");
  }
  if (msg.includes("UNIT_NO_DECIMALS")) {
    throw new DomainError(ErrorCode.UNIT_NO_DECIMALS, 422, "La cantidad viola la escala o decimales de la unidad");
  }
  if (msg.includes("EXPIRY_REQUIRED")) {
    throw new DomainError(ErrorCode.EXPIRY_REQUIRED, 422, "El producto exige fecha de vencimiento");
  }
  if (msg.includes("REASON_REQUIRED")) {
    throw new DomainError(ErrorCode.REASON_REQUIRED, 400, "El motivo es obligatorio (mínimo 10 caracteres)");
  }
  if (msg.includes("PURCHASE_HAS_EXITS")) {
    throw new DomainError(ErrorCode.PURCHASE_HAS_EXITS, 409, "No se puede anular la compra: uno o más lotes ya registraron salidas");
  }

  throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, rawMessage);
}

export class ComprasService {
  /**
   * Buscar compras paginadas con filtros.
   */
  static async buscarPaginado(query: BuscarComprasQuery, tenantId: string) {
    const db = getServiceDb();
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const offset = (page - 1) * limit;

    let q = db
      .from("compras")
      .select(
        `
        id, fecha, comprobante_proveedor_tipo, comprobante_proveedor_numero,
        total_neto, total_iva, total, estado, genera_egreso_caja, observaciones,
        created_at, updated_at,
        proveedor:proveedores(id, razon_social, cuit_rut)
      `,
        { count: "exact" },
      )
      .eq("tenant_id", tenantId);

    if (query.proveedorId) q = q.eq("proveedor_id", query.proveedorId);
    if (query.estado) q = q.eq("estado", query.estado);
    if (query.desde) q = q.gte("fecha", query.desde);
    if (query.hasta) q = q.lte("fecha", query.hasta);

    const { data, error, count } = await q
      .order("fecha", { ascending: false })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, error.message);
    }

    return {
      items: (data ?? []).map((c: any) => ({
        id: c.id,
        fecha: c.fecha,
        comprobanteProveedorTipo: c.comprobante_proveedor_tipo,
        comprobanteProveedorNumero: c.comprobante_proveedor_numero,
        totalNeto: Number(c.total_neto),
        totalIva: Number(c.total_iva),
        total: Number(c.total),
        estado: c.estado,
        generaEgresoCaja: c.genera_egreso_caja,
        observaciones: c.observaciones,
        proveedor: c.proveedor,
        createdAt: c.created_at,
        updatedAt: c.updated_at,
      })),
      total: count ?? 0,
      page,
      limit,
      totalPages: Math.ceil((count ?? 0) / limit),
    };
  }

  /**
   * Obtener una compra por ID con sus ítems.
   */
  static async obtenerPorId(id: string, tenantId: string) {
    const db = getServiceDb();
    const { data, error } = await db
      .from("compras")
      .select(`
        id, fecha, comprobante_proveedor_tipo, comprobante_proveedor_numero,
        total_neto, total_iva, total, estado, genera_egreso_caja, observaciones,
        created_at, updated_at,
        proveedor:proveedores(id, razon_social, cuit_rut),
        items:compras_items(
          id, producto_id, cantidad, costo_unitario_neto, alicuota_iva,
          codigo_lote, fecha_vencimiento, importe_neto, importe_iva, importe_total,
          producto:productos(id, codigo, nombre)
        )
      `)
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (error) {
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, error.message);
    }
    if (!data) {
      throw new DomainError(ErrorCode.PURCHASE_NOT_FOUND, 404, "Compra no encontrada");
    }

    return {
      id: data.id,
      fecha: data.fecha,
      comprobanteProveedorTipo: data.comprobante_proveedor_tipo,
      comprobanteProveedorNumero: data.comprobante_proveedor_numero,
      totalNeto: Number(data.total_neto),
      totalIva: Number(data.total_iva),
      total: Number(data.total),
      estado: data.estado,
      generaEgresoCaja: data.genera_egreso_caja,
      observaciones: data.observaciones,
      proveedor: data.proveedor,
      items: (data.items ?? []).map((it: any) => ({
        id: it.id,
        productoId: it.producto_id,
        producto: it.producto,
        cantidad: Number(it.cantidad),
        costoUnitarioNeto: Number(it.costo_unitario_neto),
        alicuotaIva: Number(it.alicuota_iva),
        codigoLote: it.codigo_lote,
        fechaVencimiento: it.fecha_vencimiento,
        importeNeto: Number(it.importe_neto),
        importeIva: Number(it.importe_iva),
        importeTotal: Number(it.importe_total),
      })),
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  }

  /**
   * Crear borrador de compra.
   */
  static async crear(dto: CrearCompraDto, ctx: ServiceContext) {
    const db = getServiceDb();

    // Validar proveedor existe y activo
    const { data: prov, error: errProv } = await db
      .from("proveedores")
      .select("id, activo")
      .eq("id", dto.proveedorId)
      .eq("tenant_id", ctx.tenantId)
      .maybeSingle();

    if (errProv) throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, errProv.message);
    if (!prov) throw new DomainError(ErrorCode.SUPPLIER_NOT_FOUND, 404, "Proveedor no encontrado");
    if (!prov.activo) throw new DomainError(ErrorCode.SUPPLIER_INACTIVE, 422, "El proveedor está inactivo");

    const { data, error } = await db
      .from("compras")
      .insert({
        tenant_id: ctx.tenantId,
        proveedor_id: dto.proveedorId,
        fecha: dto.fecha,
        comprobante_proveedor_tipo: dto.comprobanteProveedorTipo ?? null,
        comprobante_proveedor_numero: dto.comprobanteProveedorNumero ?? null,
        observaciones: dto.observaciones ?? null,
        genera_egreso_caja: dto.generaEgresoCaja ?? false,
        estado: "borrador",
        usuario_id: ctx.callerUserId,
      })
      .select("id, estado, fecha")
      .single();

    if (error) {
      if (error.code === "23505") {
        throw new DomainError(ErrorCode.SUPPLIER_INVOICE_DUPLICATE, 409, "Ya existe una compra con ese comprobante para este proveedor");
      }
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, error.message);
    }

    await recordAudit(db as unknown as any, {
      tenantId: ctx.tenantId,
      userId: ctx.callerUserId,
      userName: ctx.callerName ?? null,
      userRole: ctx.callerRole ?? null,
      action: "CREATE",
      module: "purchases",
      entityId: data.id,
      newValues: { ...dto, estado: "borrador" },
    });

    return data;
  }

  /**
   * RN-CM2: Actualizar cabecera de compra en borrador.
   */
  static async actualizar(id: string, dto: ActualizarCompraDto, ctx: ServiceContext) {
    await assertBorrador(id, ctx.tenantId);
    const db = getServiceDb();

    if (dto.proveedorId) {
      const { data: prov, error: errProv } = await db
        .from("proveedores")
        .select("id, activo")
        .eq("id", dto.proveedorId)
        .eq("tenant_id", ctx.tenantId)
        .maybeSingle();

      if (errProv) throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, errProv.message);
      if (!prov) throw new DomainError(ErrorCode.SUPPLIER_NOT_FOUND, 404, "Proveedor no encontrado");
      if (!prov.activo) throw new DomainError(ErrorCode.SUPPLIER_INACTIVE, 422, "El proveedor está inactivo");
    }

    const updates: Record<string, any> = { updated_at: new Date().toISOString() };
    if (dto.proveedorId !== undefined) updates.proveedor_id = dto.proveedorId;
    if (dto.fecha !== undefined) updates.fecha = dto.fecha;
    if (dto.comprobanteProveedorTipo !== undefined) updates.comprobante_proveedor_tipo = dto.comprobanteProveedorTipo;
    if (dto.comprobanteProveedorNumero !== undefined) updates.comprobante_proveedor_numero = dto.comprobanteProveedorNumero;
    if (dto.observaciones !== undefined) updates.observaciones = dto.observaciones;
    if (dto.generaEgresoCaja !== undefined) updates.genera_egreso_caja = dto.generaEgresoCaja;

    const { data, error } = await db
      .from("compras")
      .update(updates)
      .eq("id", id)
      .eq("tenant_id", ctx.tenantId)
      .select()
      .single();

    if (error) {
      if (error.code === "23505") {
        throw new DomainError(ErrorCode.SUPPLIER_INVOICE_DUPLICATE, 409, "Ya existe una compra con ese comprobante para este proveedor");
      }
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, error.message);
    }

    await recordAudit(db as unknown as any, {
      tenantId: ctx.tenantId,
      userId: ctx.callerUserId,
      userName: ctx.callerName ?? null,
      userRole: ctx.callerRole ?? null,
      action: "UPDATE",
      module: "purchases",
      entityId: id,
      newValues: updates,
    });

    return data;
  }

  /**
   * RN-CM2: Agregar ítem a compra en borrador.
   */
  static async agregarItem(compraId: string, dto: AgregarItemCompraDto, ctx: ServiceContext) {
    await assertBorrador(compraId, ctx.tenantId);
    await assertProductoOperable(dto.productoId, ctx.tenantId);

    const neto = Math.round(dto.cantidad * dto.costoUnitarioNeto * 100) / 100;
    const iva = Math.round(neto * (dto.alicuotaIva / 100) * 100) / 100;
    const total = Math.round((neto + iva) * 100) / 100;

    const db = getServiceDb();
    const { data, error } = await db
      .from("compras_items")
      .insert({
        tenant_id: ctx.tenantId,
        compra_id: compraId,
        producto_id: dto.productoId,
        cantidad: dto.cantidad,
        costo_unitario_neto: dto.costoUnitarioNeto,
        alicuota_iva: dto.alicuotaIva,
        codigo_lote: dto.codigoLote ?? null,
        fecha_vencimiento: dto.fechaVencimiento ?? null,
        importe_neto: neto,
        importe_iva: iva,
        importe_total: total,
      })
      .select()
      .single();

    if (error) {
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, error.message);
    }

    await this.recalcularTotales(compraId, ctx.tenantId);

    await recordAudit(db as unknown as any, {
      tenantId: ctx.tenantId,
      userId: ctx.callerUserId,
      userName: ctx.callerName ?? null,
      userRole: ctx.callerRole ?? null,
      action: "CREATE",
      module: "purchases",
      entityId: compraId,
      newValues: { itemId: data.id, ...dto },
    });

    return data;
  }

  /**
   * RN-CM2: Actualizar ítem de compra en borrador.
   */
  static async actualizarItem(
    compraId: string,
    itemId: string,
    dto: ActualizarItemCompraDto,
    ctx: ServiceContext,
  ) {
    await assertBorrador(compraId, ctx.tenantId);
    const db = getServiceDb();

    // Obtener item actual
    const { data: itemActual, error: errItem } = await db
      .from("compras_items")
      .select("*")
      .eq("id", itemId)
      .eq("compra_id", compraId)
      .eq("tenant_id", ctx.tenantId)
      .maybeSingle();

    if (errItem) throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, errItem.message);
    if (!itemActual) throw new DomainError(ErrorCode.PURCHASE_NOT_FOUND, 404, "Ítem no encontrado");

    const cantidad = dto.cantidad ?? Number(itemActual.cantidad);
    const costoUnitarioNeto = dto.costoUnitarioNeto ?? Number(itemActual.costo_unitario_neto);
    const alicuotaIva = dto.alicuotaIva ?? Number(itemActual.alicuota_iva);

    const neto = Math.round(cantidad * costoUnitarioNeto * 100) / 100;
    const iva = Math.round(neto * (alicuotaIva / 100) * 100) / 100;
    const total = Math.round((neto + iva) * 100) / 100;

    const updates: Record<string, any> = {
      cantidad,
      costo_unitario_neto: costoUnitarioNeto,
      alicuota_iva: alicuotaIva,
      importe_neto: neto,
      importe_iva: iva,
      importe_total: total,
    };
    if (dto.codigoLote !== undefined) updates.codigo_lote = dto.codigoLote;
    if (dto.fechaVencimiento !== undefined) updates.fecha_vencimiento = dto.fechaVencimiento;

    const { data, error } = await db
      .from("compras_items")
      .update(updates)
      .eq("id", itemId)
      .eq("compra_id", compraId)
      .eq("tenant_id", ctx.tenantId)
      .select()
      .single();

    if (error) {
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, error.message);
    }

    await this.recalcularTotales(compraId, ctx.tenantId);

    await recordAudit(db as unknown as any, {
      tenantId: ctx.tenantId,
      userId: ctx.callerUserId,
      userName: ctx.callerName ?? null,
      userRole: ctx.callerRole ?? null,
      action: "UPDATE",
      module: "purchases",
      entityId: compraId,
      newValues: { itemId, ...updates },
    });

    return data;
  }

  /**
   * RN-CM2: Quitar ítem de compra en borrador.
   */
  static async quitarItem(compraId: string, itemId: string, ctx: ServiceContext) {
    await assertBorrador(compraId, ctx.tenantId);
    const db = getServiceDb();

    const { error } = await db
      .from("compras_items")
      .delete()
      .eq("id", itemId)
      .eq("compra_id", compraId)
      .eq("tenant_id", ctx.tenantId);

    if (error) {
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, error.message);
    }

    await this.recalcularTotales(compraId, ctx.tenantId);

    await recordAudit(db as unknown as any, {
      tenantId: ctx.tenantId,
      userId: ctx.callerUserId,
      userName: ctx.callerName ?? null,
      userRole: ctx.callerRole ?? null,
      action: "DELETE",
      module: "purchases",
      entityId: compraId,
      newValues: { itemId },
    });

    return { deleted: true };
  }

  /**
   * Confirmar compra vía RPC.
   */
  static async confirmar(compraId: string, ctx: ServiceContext) {
    const db = getServiceDb();
    const { data, error } = await db.rpc("confirmar_compra", {
      p_tenant_id: ctx.tenantId,
      p_usuario_id: ctx.callerUserId,
      p_compra_id: compraId,
    });

    if (error) {
      mapCompraRpcError(error.message);
    }

    const row = Array.isArray(data) ? data[0] : data;
    return {
      compraId: row?.compra_id ?? compraId,
      operacionId: row?.operacion_id,
      lotesCreados: row?.lotes_creados,
      total: Number(row?.total ?? 0),
    };
  }

  /**
   * RN-CM3 / RN-MV9: Anular compra confirmada vía RPC.
   */
  static async anular(compraId: string, motivo: string, ctx: ServiceContext) {
    const db = getServiceDb();
    const { data, error } = await db.rpc("anular_compra", {
      p_tenant_id: ctx.tenantId,
      p_usuario_id: ctx.callerUserId,
      p_compra_id: compraId,
      p_motivo: motivo,
    });

    if (error) {
      mapCompraRpcError(error.message);
    }

    const row = Array.isArray(data) ? data[0] : data;
    return {
      compraId: row?.compra_id ?? compraId,
      operacionId: row?.operacion_id,
      movimientosGenerados: row?.movimientos_generados,
    };
  }

  private static async recalcularTotales(compraId: string, tenantId: string) {
    const db = getServiceDb();
    const { data, error } = await db
      .from("compras_items")
      .select("importe_neto, importe_iva, importe_total")
      .eq("compra_id", compraId)
      .eq("tenant_id", tenantId);

    if (error) {
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, error.message);
    }

    let neto = 0;
    let iva = 0;
    let total = 0;

    for (const it of data ?? []) {
      neto += Number(it.importe_neto);
      iva += Number(it.importe_iva);
      total += Number(it.importe_total);
    }

    await db
      .from("compras")
      .update({
        total_neto: Math.round(neto * 100) / 100,
        total_iva: Math.round(iva * 100) / 100,
        total: Math.round(total * 100) / 100,
        updated_at: new Date().toISOString(),
      })
      .eq("id", compraId)
      .eq("tenant_id", tenantId);
  }
}
