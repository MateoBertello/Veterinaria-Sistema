import { getServiceDb } from "../../shared/db.ts";
import { DomainError, ErrorCode } from "../../shared/errors.ts";
import type {
  ListarLotesQuery,
  KardexQuery,
  ListarMovimientosQuery,
  ListarExistenciasQuery,
} from "./stock.schemas.ts";

export class StockService {
  /**
   * RN-LO4, RN-LO5, RN-LO7: Listado de lotes elegibles según FEFO.
   * - RN-LO4: Lotes vencidos rechazados para todo rol (sin excepciones).
   * - RN-LO5: Orden determinístico (vencimiento asc nulls last, fecha_ingreso asc, id asc).
   * - RN-LO7: Solo lotes con estado 'disponible' (bloqueados y cuarentena excluidos).
   * - Sin N+1: Un solo select con embed.
   */
  static async listarCandidatosFefo(
    productoId: string,
    _cantidad: number,
    tenantId: string,
  ) {
    const hoy = new Date().toISOString().split("T")[0];
    const db = getServiceDb();

    const { data, error } = await db
      .from("existencias_lote")
      .select(`
        lote_id, cantidad,
        lote:lotes!inner(
          id, codigo_lote, fecha_vencimiento, fecha_ingreso,
          estado, costo_unitario_efectivo
        )
      `)
      .eq("tenant_id", tenantId)
      .eq("producto_id", productoId)
      .gt("cantidad", 0)
      .eq("lotes.estado", "disponible")
      .or(`fecha_vencimiento.is.null,fecha_vencimiento.gte.${hoy}`, { foreignTable: "lotes" })
      .order("fecha_vencimiento", { foreignTable: "lotes", ascending: true, nullsFirst: false })
      .order("fecha_ingreso", { foreignTable: "lotes", ascending: true })
      .order("id", { foreignTable: "lotes", ascending: true });

    if (error) {
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, error.message);
    }

    return (data ?? []).map((row: any) => ({
      loteId: row.lote_id,
      codigoLote: row.lote?.codigo_lote ?? null,
      fechaVencimiento: row.lote?.fecha_vencimiento ?? null,
      fechaIngreso: row.lote?.fecha_ingreso,
      estado: row.lote?.estado,
      costoUnitarioEfectivo: Number(row.lote?.costo_unitario_efectivo ?? 0),
      cantidadDisponible: Number(row.cantidad),
    }));
  }

  /**
   * RN-MV6: Kárdex por lote con saldo acumulado.
   * El costo del movimiento es el costo EFECTIVO congelado cuando ocurrió.
   * NO se recalcula ni se une con productos.costo_reposicion.
   */
  static async kardexPorLote(loteId: string, tenantId: string, query: KardexQuery) {
    const db = getServiceDb();
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const offset = (page - 1) * limit;

    const { data, error, count } = await db
      .from("movimientos_stock")
      .select("id, created_at, tipo, cantidad, cantidad_con_signo, costo_unitario, costo_total, motivo", {
        count: "exact",
      })
      .eq("tenant_id", tenantId)
      .eq("lote_id", loteId)
      .order("created_at", { ascending: true })
      .range(offset, offset + limit - 1);

    if (error) {
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, error.message);
    }

    let saldo = 0;
    const movimientosConSaldo = (data ?? []).map((m: any) => {
      saldo += Number(m.cantidad_con_signo ?? 0);
      return {
        id: m.id,
        fecha: m.created_at,
        tipo: m.tipo,
        cantidad: Number(m.cantidad),
        cantidadConSigno: Number(m.cantidad_con_signo),
        costoUnitario: Number(m.costo_unitario),
        costoTotal: Number(m.costo_total),
        motivo: m.motivo ?? null,
        saldoAcumulado: saldo,
      };
    });

    return {
      data: movimientosConSaldo,
      meta: {
        total: count ?? 0,
        page,
        limit,
        totalPages: Math.ceil((count ?? 0) / limit),
      },
    };
  }

  /**
   * Listar lotes con filtros y paginación.
   */
  static async listarLotes(tenantId: string, query: ListarLotesQuery) {
    const db = getServiceDb();
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const offset = (page - 1) * limit;

    let q = db
      .from("lotes")
      .select(
        `
        id, codigo_lote, fecha_vencimiento, fecha_ingreso,
        costo_unitario_neto, costo_unitario_efectivo, estado, origen,
        producto:productos(id, codigo, nombre),
        proveedor:proveedores(id, razon_social),
        existencia:existencias_lote(cantidad)
      `,
        { count: "exact" },
      )
      .eq("tenant_id", tenantId);

    if (query.productoId) {
      q = q.eq("producto_id", query.productoId);
    }
    if (query.estado) {
      q = q.eq("estado", query.estado);
    }
    if (query.venceAntesDe) {
      q = q.lte("fecha_vencimiento", query.venceAntesDe);
    }

    const { data, error, count } = await q
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, error.message);
    }

    let items = (data ?? []).map((l: any) => ({
      id: l.id,
      codigoLote: l.codigo_lote,
      fechaVencimiento: l.fecha_vencimiento,
      fechaIngreso: l.fecha_ingreso,
      costoUnitarioNeto: Number(l.costo_unitario_neto),
      costoUnitarioEfectivo: Number(l.costo_unitario_efectivo),
      estado: l.estado,
      origen: l.origen,
      producto: l.producto,
      proveedor: l.proveedor,
      cantidad: Number(l.existencia?.[0]?.cantidad ?? 0),
    }));

    if (query.conExistencia === "true") {
      items = items.filter((i) => i.cantidad > 0);
    } else if (query.conExistencia === "false") {
      items = items.filter((i) => i.cantidad === 0);
    }

    return {
      items,
      total: count ?? 0,
      page,
      limit,
      totalPages: Math.ceil((count ?? 0) / limit),
    };
  }

  /**
   * Obtener un lote por ID.
   */
  static async obtenerLotePorId(id: string, tenantId: string) {
    const db = getServiceDb();
    const { data, error } = await db
      .from("lotes")
      .select(`
        id, codigo_lote, fecha_vencimiento, fecha_ingreso,
        costo_unitario_neto, costo_unitario_efectivo, estado, origen,
        producto:productos(id, codigo, nombre),
        proveedor:proveedores(id, razon_social),
        existencia:existencias_lote(cantidad)
      `)
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (error) {
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, error.message);
    }
    if (!data) {
      throw new DomainError(ErrorCode.BATCH_NOT_FOUND, 404, "Lote no encontrado");
    }

    return {
      id: data.id,
      codigoLote: data.codigo_lote,
      fechaVencimiento: data.fecha_vencimiento,
      fechaIngreso: data.fecha_ingreso,
      costoUnitarioNeto: Number(data.costo_unitario_neto),
      costoUnitarioEfectivo: Number(data.costo_unitario_efectivo),
      estado: data.estado,
      origen: data.origen,
      producto: data.producto,
      proveedor: data.proveedor,
      cantidad: Number((data as any).existencia?.[0]?.cantidad ?? 0),
    };
  }

  /**
   * Listado paginado de movimientos de stock.
   */
  static async listarMovimientos(tenantId: string, query: ListarMovimientosQuery) {
    const db = getServiceDb();
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const offset = (page - 1) * limit;

    let q = db
      .from("movimientos_stock")
      .select(
        `
        id, operacion_id, tipo, cantidad, cantidad_con_signo,
        costo_unitario, costo_total, motivo, created_at,
        producto:productos(id, codigo, nombre),
        lote:lotes(id, codigo_lote)
      `,
        { count: "exact" },
      )
      .eq("tenant_id", tenantId);

    if (query.loteId) q = q.eq("lote_id", query.loteId);
    if (query.productoId) q = q.eq("producto_id", query.productoId);
    if (query.tipo) q = q.eq("tipo", query.tipo);
    if (query.operacionId) q = q.eq("operacion_id", query.operacionId);
    if (query.desde) q = q.gte("created_at", query.desde);
    if (query.hasta) q = q.lte("created_at", query.hasta);

    const { data, error, count } = await q
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, error.message);
    }

    return {
      items: (data ?? []).map((m: any) => ({
        id: m.id,
        operacionId: m.operacion_id,
        tipo: m.tipo,
        cantidad: Number(m.cantidad),
        cantidadConSigno: Number(m.cantidad_con_signo),
        costoUnitario: Number(m.costo_unitario),
        costoTotal: Number(m.costo_total),
        motivo: m.motivo,
        createdAt: m.created_at,
        producto: m.producto,
        lote: m.lote,
      })),
      total: count ?? 0,
      page,
      limit,
      totalPages: Math.ceil((count ?? 0) / limit),
    };
  }

  /**
   * Listar existencias agrupadas por producto.
   */
  static async existenciaPorProducto(tenantId: string, query: ListarExistenciasQuery) {
    const db = getServiceDb();
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const offset = (page - 1) * limit;

    let q = db
      .from("existencias_lote")
      .select(
        `
        producto_id, cantidad,
        producto:productos!inner(id, codigo, nombre, unidad_medida:unidades_medida(id, codigo, nombre))
      `,
        { count: "exact" },
      )
      .eq("tenant_id", tenantId)
      .gt("cantidad", 0);

    if (query.search) {
      q = q.ilike("productos.nombre", `%${query.search}%`);
    }

    const { data, error, count } = await q
      .order("producto_id")
      .range(offset, offset + limit - 1);

    if (error) {
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, error.message);
    }

    return {
      items: (data ?? []).map((r: any) => ({
        productoId: r.producto_id,
        producto: r.producto,
        cantidad: Number(r.cantidad),
      })),
      total: count ?? 0,
      page,
      limit,
      totalPages: Math.ceil((count ?? 0) / limit),
    };
  }

  /**
   * Valorización total del inventario: suma(existencia * costo_unitario_efectivo).
   */
  static async valorizacionInventario(tenantId: string) {
    const db = getServiceDb();

    const { data, error } = await db
      .from("existencias_lote")
      .select(`
        producto_id, cantidad,
        producto:productos!inner(id, codigo, nombre),
        lote:lotes!inner(costo_unitario_efectivo)
      `)
      .eq("tenant_id", tenantId)
      .gt("cantidad", 0);

    if (error) {
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, error.message);
    }

    let totalValorizado = 0;
    const porProductoMap = new Map<string, { producto: any; cantidadTotal: number; valorTotal: number }>();

    for (const row of data ?? []) {
      const cant = Number(row.cantidad);
      const costo = Number((row as any).lote?.costo_unitario_efectivo ?? 0);
      const subtotal = cant * costo;
      totalValorizado += subtotal;

      const pId = row.producto_id;
      const existing = porProductoMap.get(pId) ?? {
        producto: (row as any).producto,
        cantidadTotal: 0,
        valorTotal: 0,
      };
      existing.cantidadTotal += cant;
      existing.valorTotal += subtotal;
      porProductoMap.set(pId, existing);
    }

    return {
      totalValorizado: Math.round(totalValorizado * 100) / 100,
      productos: [...porProductoMap.values()].map((p) => ({
        producto: p.producto,
        cantidadTotal: p.cantidadTotal,
        valorTotal: Math.round(p.valorTotal * 100) / 100,
      })),
    };
  }

  /**
   * RN-LO8: avisa de los lotes que vencen dentro de dias_alerta_vencimiento.
   * NO bloquea nada: el lote sigue siendo candidato FEFO hasta el día que vence.
   *
   * El UNIQUE (tenant_id, origen, referencia_id, canal) de `notificaciones`
   * absorbe los reintentos: una notificación por lote, para siempre. Por eso el
   * insert va con ON CONFLICT DO NOTHING y no con una consulta previa.
   */
  static async notificarLotesPorVencer(tenantId: string): Promise<number> {
    const db = getServiceDb();

    const { data: config, error: errConfig } = await db
      .from("configuracion_tenant")
      .select("dias_alerta_vencimiento")
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (errConfig) {
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, errConfig.message);
    }

    const diasUmbral = config?.dias_alerta_vencimiento ?? 60;

    const { data: lotesPorVencer, error: errLotes } = await db
      .from("v_lotes_por_vencer")
      .select("lote_id, producto_nombre, codigo_lote, fecha_vencimiento, dias_restantes, cantidad")
      .eq("tenant_id", tenantId)
      .lte("dias_restantes", diasUmbral)
      .gte("dias_restantes", 0);

    if (errLotes) {
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, errLotes.message);
    }

    if (!lotesPorVencer || lotesPorVencer.length === 0) {
      return 0;
    }

    const notificacionesAInsertar = lotesPorVencer.map((lote: any) => ({
      tenant_id: tenantId,
      origen: "vencimiento_lote",
      referencia_id: lote.lote_id,
      canal: "email",
      estado: "pendiente",
      mensaje: `El lote ${lote.codigo_lote ?? "sin código"} del producto ${lote.producto_nombre} vence el ${lote.fecha_vencimiento} (en ${lote.dias_restantes} días). Stock: ${lote.cantidad}.`,
    }));

    const { data: insertadas, error: errInsert } = await db
      .from("notificaciones")
      .upsert(notificacionesAInsertar, {
        onConflict: "tenant_id,origen,referencia_id,canal",
        ignoreDuplicates: true,
      })
      .select("id");

    if (errInsert) {
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, errInsert.message);
    }

    return insertadas?.length ?? 0;
  }
}

// TODO C4·T2: alerta de stock mínimo. Es por FLANCO, no por nivel: se crea al
// cruzar el mínimo hacia abajo y se ELIMINA al cruzarlo hacia arriba, de modo
// que el UNIQUE de notificaciones deje de bloquear y el próximo faltante vuelva
// a avisar. Se evalúa DENTRO del RPC, después de cada movimiento, no por tarea
// programada: así la alerta llega cuando pasa y no al día siguiente.
