import { getServiceDb } from "../../shared/db.ts";
import { DomainError, ErrorCode } from "../../shared/errors.ts";
import type {
  ValorizacionAFechaQuery,
  ReporteRotacionQuery,
  ReporteRentabilidadQuery,
  ReporteFraccionamientoQuery,
  ReporteVentasUsuarioQuery,
  ReporteVentasSesionQuery,
  ReporteVentasMedioPagoQuery,
  ReporteConsumoProfesionalQuery,
  ReporteConsumoEspecieQuery,
} from "./reportes.schemas.ts";

export interface Context {
  tenantId: string;
  callerUserId?: string;
  callerName?: string;
  callerRole?: string;
}

export const ReportesService = {
  /**
   * Reporte de valorización de inventario a una fecha determinada.
   * Reconstruye el stock y el valor lote a lote DESDE EL LIBRO MAYOR (movimientos_stock),
   * no desde existencias_lote (la caché no tiene historia).
   * RN-MV6: El costo unitario efectivo proviene del lote original, no del costo de reposición actual.
   */
  async valorizacionAFecha(query: ValorizacionAFechaQuery, ctx: Context) {
    const db = getServiceDb();
    const fechaCorte = query.fechaCorte
      ? new Date(query.fechaCorte).toISOString()
      : new Date().toISOString();

    let movQuery = db
      .from("movimientos_stock")
      .select("lote_id, producto_id, cantidad_con_signo, created_at")
      .eq("tenant_id", ctx.tenantId)
      .lte("created_at", fechaCorte);

    if (query.productoId) {
      movQuery = movQuery.eq("producto_id", query.productoId);
    }

    const { data: movimientos, error: movErr } = await movQuery;
    if (movErr) {
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, movErr.message);
    }

    // Agrupar por lote para obtener la cantidad acumulada a la fecha de corte
    const lotesMap = new Map<string, { loteId: string; productoId: string; cantidad: number }>();
    for (const m of (movimientos ?? [])) {
      const prev = lotesMap.get(m.lote_id) ?? {
        loteId: m.lote_id,
        productoId: m.producto_id,
        cantidad: 0,
      };
      prev.cantidad += Number(m.cantidad_con_signo);
      lotesMap.set(m.lote_id, prev);
    }

    // Filtrar lotes que tenían existencia positiva a esa fecha
    const activeLotes = [...lotesMap.values()].filter((l) => l.cantidad > 0.0001);

    if (activeLotes.length === 0) {
      return {
        fechaCorte,
        totalLineas: 0,
        totalUnidades: 0,
        valorizacionTotal: 0,
        items: [],
      };
    }

    // Consultar metadatos de los lotes
    const loteIds = activeLotes.map((l) => l.loteId);
    const { data: lotesData, error: lotesErr } = await db
      .from("lotes")
      .select("id, codigo_lote, fecha_vencimiento, costo_unitario_efectivo, producto_id")
      .eq("tenant_id", ctx.tenantId)
      .in("id", loteIds);

    if (lotesErr) {
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, lotesErr.message);
    }
    const lotesInfoMap = new Map((lotesData ?? []).map((l) => [l.id, l]));

    // Consultar información de productos y familias
    const prodIds = [...new Set(activeLotes.map((l) => l.productoId))];
    let prodQuery = db
      .from("productos")
      .select(`
        id,
        codigo,
        nombre,
        familia_id,
        unidades_medida!productos_unidad_medida_id_fkey(id, nombre, abreviatura),
        familias_producto!productos_familia_tenant_fkey(id, nombre)
      `)
      .eq("tenant_id", ctx.tenantId)
      .in("id", prodIds);

    if (query.familiaId) {
      prodQuery = prodQuery.eq("familia_id", query.familiaId);
    }

    const { data: productosData, error: prodErr } = await prodQuery;
    if (prodErr) {
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, prodErr.message);
    }
    const prodMap = new Map((productosData ?? []).map((p) => [p.id, p]));

    const items = [];
    let totalUnidades = 0;
    let valorizacionTotal = 0;

    for (const item of activeLotes) {
      const prod = prodMap.get(item.productoId);
      if (!prod) continue; // Si se filtró por familia y no coincide, se omite

      const loteInfo = lotesInfoMap.get(item.loteId);
      const costoUnitario = Number(loteInfo?.costo_unitario_efectivo ?? 0);
      const cantidad = item.cantidad;
      const valorTotal = Math.round(cantidad * costoUnitario * 100) / 100;

      totalUnidades += cantidad;
      valorizacionTotal += valorTotal;

      items.push({
        loteId: item.loteId,
        codigoLote: loteInfo?.codigo_lote ?? null,
        fechaVencimiento: loteInfo?.fecha_vencimiento ?? null,
        productoId: prod.id,
        productoCodigo: prod.codigo,
        productoNombre: prod.nombre,
        familiaId: prod.familia_id,
        familiaNombre: (prod.familias_producto as any)?.nombre ?? null,
        unidadMedida: (prod.unidades_medida as any)?.abreviatura ?? "u",
        cantidadAFecha: Math.round(cantidad * 1000) / 1000,
        costoUnitarioEfectivo: costoUnitario,
        valorTotal,
      });
    }

    return {
      fechaCorte,
      totalLineas: items.length,
      totalUnidades: Math.round(totalUnidades * 1000) / 1000,
      valorizacionTotal: Math.round(valorizacionTotal * 100) / 100,
      items,
    };
  },

  /**
   * Reporte de rotación de stock y productos sin movimiento.
   */
  async rotacion(query: ReporteRotacionQuery, ctx: Context) {
    const db = getServiceDb();
    const diasLimite = query.diasSinMovimiento ?? 30;
    const fechaLimite = new Date(Date.now() - diasLimite * 24 * 60 * 60 * 1000).toISOString();

    let prodQuery = db
      .from("productos")
      .select(`
        id,
        codigo,
        nombre,
        costo_reposicion,
        precio_venta,
        familia_id,
        familias_producto!productos_familia_tenant_fkey(id, nombre)
      `)
      .eq("tenant_id", ctx.tenantId)
      .eq("activo", true);

    if (query.familiaId) {
      prodQuery = prodQuery.eq("familia_id", query.familiaId);
    }

    const { data: productos, error: pErr } = await prodQuery;
    if (pErr) throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, pErr.message);

    // Obtener existencias actuales
    const { data: existencias, error: eErr } = await db
      .from("existencias_lote")
      .select("producto_id, cantidad")
      .eq("tenant_id", ctx.tenantId);
    if (eErr) throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, eErr.message);

    const existenciasMap = new Map<string, number>();
    for (const e of (existencias ?? [])) {
      existenciasMap.set(e.producto_id, (existenciasMap.get(e.producto_id) ?? 0) + Number(e.cantidad));
    }

    // Obtener movimientos de salida y último movimiento por producto
    const { data: movimientos, error: mErr } = await db
      .from("movimientos_stock")
      .select("producto_id, tipo, cantidad, created_at")
      .eq("tenant_id", ctx.tenantId);
    if (mErr) throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, mErr.message);

    const ultimoMovMap = new Map<string, string>();
    const salidasPeriodoMap = new Map<string, number>();

    for (const m of (movimientos ?? [])) {
      const prevDate = ultimoMovMap.get(m.producto_id);
      if (!prevDate || new Date(m.created_at) > new Date(prevDate)) {
        ultimoMovMap.set(m.producto_id, m.created_at);
      }

      if (
        (m.tipo === "salida_venta" || m.tipo === "consumo_clinico" || m.tipo === "salida_conversion") &&
        (!query.desde || new Date(m.created_at) >= new Date(query.desde)) &&
        (!query.hasta || new Date(m.created_at) <= new Date(query.hasta))
      ) {
        salidasPeriodoMap.set(m.producto_id, (salidasPeriodoMap.get(m.producto_id) ?? 0) + Number(m.cantidad));
      }
    }

    const items = (productos ?? []).map((p) => {
      const stockActual = existenciasMap.get(p.id) ?? 0;
      const ultimoMovAt = ultimoMovMap.get(p.id) ?? null;
      const totalSalidas = salidasPeriodoMap.get(p.id) ?? 0;
      const diasInmovilizado = ultimoMovAt
        ? Math.floor((Date.now() - new Date(ultimoMovAt).getTime()) / (1000 * 60 * 60 * 24))
        : 999;
      const sinMovimiento = !ultimoMovAt || new Date(ultimoMovAt) < new Date(fechaLimite);
      const costoReposicion = Number(p.costo_reposicion ?? 0);
      const valorInmovilizado = Math.round(stockActual * costoReposicion * 100) / 100;

      return {
        productoId: p.id,
        codigo: p.codigo,
        nombre: p.nombre,
        familiaId: p.familia_id,
        familiaNombre: (p.familias_producto as any)?.nombre ?? null,
        stockActual: Math.round(stockActual * 1000) / 1000,
        costoReposicion,
        valorInmovilizado,
        ultimoMovimientoAt: ultimoMovAt,
        diasSinMovimiento: diasInmovilizado,
        sinMovimiento,
        totalSalidasPeriodo: Math.round(totalSalidas * 1000) / 1000,
      };
    });

    const productosSinMovimiento = items.filter((i) => i.sinMovimiento && i.stockActual > 0);
    const totalInmovilizado = productosSinMovimiento.reduce((acc, cur) => acc + cur.valorInmovilizado, 0);

    return {
      diasLimite,
      totalProductos: items.length,
      totalSinMovimiento: productosSinMovimiento.length,
      capitalInmovilizadoTotal: Math.round(totalInmovilizado * 100) / 100,
      items,
    };
  },

  /**
   * Reporte de rentabilidad por producto y familia.
   * Utiliza el costo unitario efectivo congelado al momento de la venta (RN-MV6).
   */
  async rentabilidad(query: ReporteRentabilidadQuery, ctx: Context) {
    const db = getServiceDb();

    let q = db
      .from("v_margen_venta")
      .select("*")
      .eq("tenant_id", ctx.tenantId);

    if (query.productoId) {
      q = q.eq("item_id", query.productoId);
    }
    if (query.desde) {
      q = q.gte("vendido_at", query.desde);
    }
    if (query.hasta) {
      q = q.lte("vendido_at", query.hasta);
    }

    const { data: margenData, error } = await q;
    if (error) throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, error.message);

    // Agrupar por ítem vendido
    const itemMap = new Map<string, {
      itemId: string;
      itemNombre: string;
      tipoItem: string;
      cantidadVendida: number;
      netoTotal: number;
      costoTotal: number;
      margenBruto: number;
    }>();

    for (const row of (margenData ?? [])) {
      const prev = itemMap.get(row.item_id) ?? {
        itemId: row.item_id,
        itemNombre: row.item_nombre,
        tipoItem: row.tipo_item,
        cantidadVendida: 0,
        netoTotal: 0,
        costoTotal: 0,
        margenBruto: 0,
      };

      prev.cantidadVendida += Number(row.cantidad);
      prev.netoTotal += Number(row.neto_total);
      prev.costoTotal += Number(row.costo_total);
      prev.margenBruto += Number(row.margen);
      itemMap.set(row.item_id, prev);
    }

    const items = [...itemMap.values()].map((i) => {
      const margenPct = i.netoTotal > 0
        ? Math.round((i.margenBruto / i.netoTotal) * 10000) / 100
        : 0;

      return {
        ...i,
        cantidadVendida: Math.round(i.cantidadVendida * 1000) / 1000,
        netoTotal: Math.round(i.netoTotal * 100) / 100,
        costoTotal: Math.round(i.costoTotal * 100) / 100,
        margenBruto: Math.round(i.margenBruto * 100) / 100,
        margenPct,
      };
    });

    const totalNeto = items.reduce((acc, cur) => acc + cur.netoTotal, 0);
    const totalCosto = items.reduce((acc, cur) => acc + cur.costoTotal, 0);
    const totalMargen = items.reduce((acc, cur) => acc + cur.margenBruto, 0);
    const margenPromedioPct = totalNeto > 0
      ? Math.round((totalMargen / totalNeto) * 10000) / 100
      : 0;

    return {
      totalItemsVendidos: items.length,
      totalNeto: Math.round(totalNeto * 100) / 100,
      totalCosto: Math.round(totalCosto * 100) / 100,
      totalMargenBruto: Math.round(totalMargen * 100) / 100,
      margenPromedioPct,
      items,
    };
  },

  /**
   * Reporte de costo y rendimiento de fraccionamiento.
   */
  async costoFraccionamiento(query: ReporteFraccionamientoQuery, ctx: Context) {
    const db = getServiceDb();

    let q = db
      .from("v_costo_fraccionamiento")
      .select("*")
      .eq("tenant_id", ctx.tenantId);

    if (query.productoOrigenId) {
      q = q.eq("producto_origen_id", query.productoOrigenId);
    }
    if (query.productoDestinoId) {
      q = q.eq("producto_destino_id", query.productoDestinoId);
    }
    if (query.desde) {
      q = q.gte("fraccionado_at", query.desde);
    }
    if (query.hasta) {
      q = q.lte("fraccionado_at", query.hasta);
    }

    const { data, error } = await q.order("fraccionado_at", { ascending: false });
    if (error) throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, error.message);

    return data ?? [];
  },

  /**
   * Reporte de ventas por usuario / vendedor.
   */
  async ventasPorUsuario(query: ReporteVentasUsuarioQuery, ctx: Context) {
    const db = getServiceDb();

    let q = db
      .from("ventas")
      .select(`
        id,
        usuario_id,
        subtotal_neto,
        total_iva,
        descuento_importe,
        total,
        created_at,
        usuarios!ventas_usuario_tenant_fkey(id, full_name, username)
      `)
      .eq("tenant_id", ctx.tenantId)
      .eq("estado", "registrada");

    if (query.usuarioId) {
      q = q.eq("usuario_id", query.usuarioId);
    }
    if (query.desde) {
      q = q.gte("created_at", query.desde);
    }
    if (query.hasta) {
      q = q.lte("created_at", query.hasta);
    }

    const { data: ventas, error } = await q;
    if (error) throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, error.message);

    const userMap = new Map<string, {
      usuarioId: string;
      usuarioNombre: string;
      usuarioUsername: string;
      cantidadOperaciones: number;
      subtotalNeto: number;
      totalIva: number;
      totalDescuentos: number;
      totalVentas: number;
    }>();

    for (const v of (ventas ?? [])) {
      const uInfo = v.usuarios as any;
      const prev = userMap.get(v.usuario_id) ?? {
        usuarioId: v.usuario_id,
        usuarioNombre: uInfo?.full_name ?? "Desconocido",
        usuarioUsername: uInfo?.username ?? "",
        cantidadOperaciones: 0,
        subtotalNeto: 0,
        totalIva: 0,
        totalDescuentos: 0,
        totalVentas: 0,
      };

      prev.cantidadOperaciones += 1;
      prev.subtotalNeto += Number(v.subtotal_neto);
      prev.totalIva += Number(v.total_iva);
      prev.totalDescuentos += Number(v.descuento_importe);
      prev.totalVentas += Number(v.total);
      userMap.set(v.usuario_id, prev);
    }

    const items = [...userMap.values()].map((u) => ({
      ...u,
      subtotalNeto: Math.round(u.subtotalNeto * 100) / 100,
      totalIva: Math.round(u.totalIva * 100) / 100,
      totalDescuentos: Math.round(u.totalDescuentos * 100) / 100,
      totalVentas: Math.round(u.totalVentas * 100) / 100,
      ticketPromedio: u.cantidadOperaciones > 0
        ? Math.round((u.totalVentas / u.cantidadOperaciones) * 100) / 100
        : 0,
    }));

    return items;
  },

  /**
   * Reporte de ventas por sesión de caja.
   */
  async ventasPorSesion(query: ReporteVentasSesionQuery, ctx: Context) {
    const db = getServiceDb();

    let sesionQuery = db
      .from("sesiones_caja")
      .select(`
        id,
        caja_id,
        estado,
        apertura_at,
        cierre_at,
        saldo_inicial,
        saldo_teorico_efectivo,
        efectivo_contado,
        diferencia,
        cajas!sesiones_caja_caja_tenant_fkey(id, nombre),
        usuario_apertura:usuarios!sesiones_caja_apertura_usuario_tenant_fkey(id, full_name),
        usuario_cierre:usuarios!sesiones_caja_cierre_usuario_tenant_fkey(id, full_name)
      `)
      .eq("tenant_id", ctx.tenantId);

    if (query.cajaId) {
      sesionQuery = sesionQuery.eq("caja_id", query.cajaId);
    }
    if (query.sesionId) {
      sesionQuery = sesionQuery.eq("id", query.sesionId);
    }
    if (query.desde) {
      sesionQuery = sesionQuery.gte("apertura_at", query.desde);
    }
    if (query.hasta) {
      sesionQuery = sesionQuery.lte("apertura_at", query.hasta);
    }

    const { data: sesiones, error: sErr } = await sesionQuery.order("apertura_at", { ascending: false });
    if (sErr) throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, sErr.message);

    const sesionIds = (sesiones ?? []).map((s) => s.id);
    if (sesionIds.length === 0) return [];

    const { data: ventas, error: vErr } = await db
      .from("ventas")
      .select("sesion_caja_id, total, estado")
      .eq("tenant_id", ctx.tenantId)
      .in("sesion_caja_id", sesionIds)
      .eq("estado", "registrada");

    if (vErr) throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, vErr.message);

    const ventasMap = new Map<string, { cantidad: number; total: number }>();
    for (const v of (ventas ?? [])) {
      const prev = ventasMap.get(v.sesion_caja_id) ?? { cantidad: 0, total: 0 };
      prev.cantidad += 1;
      prev.total += Number(v.total);
      ventasMap.set(v.sesion_caja_id, prev);
    }

    return (sesiones ?? []).map((s) => {
      const vInfo = ventasMap.get(s.id) ?? { cantidad: 0, total: 0 };
      return {
        sesionId: s.id,
        cajaId: s.caja_id,
        cajaNombre: (s.cajas as any)?.nombre ?? "Caja",
        estado: s.estado,
        aperturaAt: s.apertura_at,
        cierreAt: s.cierre_at,
        usuarioApertura: (s.usuario_apertura as any)?.full_name ?? null,
        usuarioCierre: (s.usuario_cierre as any)?.full_name ?? null,
        saldoInicial: Number(s.saldo_inicial ?? 0),
        saldoTeoricoEfectivo: s.saldo_teorico_efectivo !== null ? Number(s.saldo_teorico_efectivo) : null,
        efectivoContado: s.efectivo_contado !== null ? Number(s.efectivo_contado) : null,
        diferencia: s.diferencia !== null ? Number(s.diferencia) : null,
        cantidadVentas: vInfo.cantidad,
        totalVentas: Math.round(vInfo.total * 100) / 100,
      };
    });
  },

  /**
   * Reporte de ventas por medio de pago.
   */
  async ventasPorMedioPago(query: ReporteVentasMedioPagoQuery, ctx: Context) {
    const db = getServiceDb();

    let q = db
      .from("ventas_pagos")
      .select(`
        id,
        medio_pago_id,
        importe,
        created_at,
        ventas!ventas_pagos_venta_tenant_fkey(id, estado),
        medios_pago!ventas_pagos_medio_pago_id_fkey(id, codigo, nombre)
      `)
      .eq("tenant_id", ctx.tenantId);

    if (query.medioPagoId) {
      q = q.eq("medio_pago_id", query.medioPagoId);
    }
    if (query.desde) {
      q = q.gte("created_at", query.desde);
    }
    if (query.hasta) {
      q = q.lte("created_at", query.hasta);
    }

    const { data: pagos, error } = await q;
    if (error) throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, error.message);

    // Filtrar solo pagos de ventas registradas
    const validPagos = (pagos ?? []).filter((p) => (p.ventas as any)?.estado === "registrada");

    const mpMap = new Map<string, {
      medioPagoId: string;
      medioPagoCodigo: string;
      medioPagoNombre: string;
      cantidadTransacciones: number;
      totalRecaudado: number;
    }>();

    let granTotal = 0;

    for (const p of validPagos) {
      const mpInfo = p.medios_pago as any;
      const prev = mpMap.get(p.medio_pago_id) ?? {
        medioPagoId: p.medio_pago_id,
        medioPagoCodigo: mpInfo?.codigo ?? "",
        medioPagoNombre: mpInfo?.nombre ?? "Medio de Pago",
        cantidadTransacciones: 0,
        totalRecaudado: 0,
      };

      const imp = Number(p.importe);
      prev.cantidadTransacciones += 1;
      prev.totalRecaudado += imp;
      granTotal += imp;
      mpMap.set(p.medio_pago_id, prev);
    }

    const items = [...mpMap.values()].map((m) => ({
      ...m,
      totalRecaudado: Math.round(m.totalRecaudado * 100) / 100,
      porcentajeDelTotal: granTotal > 0
        ? Math.round((m.totalRecaudado / granTotal) * 10000) / 100
        : 0,
    }));

    return {
      granTotal: Math.round(granTotal * 100) / 100,
      totalTransacciones: validPagos.length,
      items,
    };
  },

  /**
   * Reporte de consumo clínico por profesional veterinario.
   */
  async consumoPorProfesional(query: ReporteConsumoProfesionalQuery, ctx: Context) {
    const db = getServiceDb();

    let q = db
      .from("v_consumo_clinico")
      .select("*")
      .eq("tenant_id", ctx.tenantId);

    if (query.profesionalId) {
      q = q.eq("profesional_id", query.profesionalId);
    }
    if (query.desde) {
      q = q.gte("consumido_at", query.desde);
    }
    if (query.hasta) {
      q = q.lte("consumido_at", query.hasta);
    }

    const { data: consumos, error } = await q;
    if (error) throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, error.message);

    // Obtener nombres de profesionales
    const profIds = [...new Set((consumos ?? []).map((c) => c.profesional_id))];
    let profMap = new Map<string, string>();
    if (profIds.length > 0) {
      const { data: usuarios } = await db
        .from("usuarios")
        .select("id, full_name")
        .eq("tenant_id", ctx.tenantId)
        .in("id", profIds);
      profMap = new Map((usuarios ?? []).map((u) => [u.id, u.full_name]));
    }

    const aggMap = new Map<string, {
      profesionalId: string;
      profesionalNombre: string;
      cantidadConsumos: number;
      unidadesConsumidas: number;
      costoTotalInsumos: number;
    }>();

    for (const c of (consumos ?? [])) {
      const prev = aggMap.get(c.profesional_id) ?? {
        profesionalId: c.profesional_id,
        profesionalNombre: profMap.get(c.profesional_id) ?? "Profesional",
        cantidadConsumos: 0,
        unidadesConsumidas: 0,
        costoTotalInsumos: 0,
      };

      prev.cantidadConsumos += 1;
      prev.unidadesConsumidas += Number(c.cantidad);
      prev.costoTotalInsumos += Number(c.costo_total);
      aggMap.set(c.profesional_id, prev);
    }

    const items = [...aggMap.values()].map((a) => ({
      ...a,
      unidadesConsumidas: Math.round(a.unidadesConsumidas * 1000) / 1000,
      costoTotalInsumos: Math.round(a.costoTotalInsumos * 100) / 100,
    }));

    return items;
  },

  /**
   * Reporte de consumo clínico por especie animal.
   */
  async consumoPorEspecie(query: ReporteConsumoEspecieQuery, ctx: Context) {
    const db = getServiceDb();

    let q = db
      .from("v_consumo_clinico")
      .select("*")
      .eq("tenant_id", ctx.tenantId);

    if (query.desde) {
      q = q.gte("consumido_at", query.desde);
    }
    if (query.hasta) {
      q = q.lte("consumido_at", query.hasta);
    }

    const { data: consumos, error } = await q;
    if (error) throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, error.message);

    const mascotaIds = [...new Set((consumos ?? []).map((c) => c.mascota_id))];
    if (mascotaIds.length === 0) return [];

    const { data: mascotasData, error: mErr } = await db
      .from("mascotas")
      .select("id, especie_id, especies!mascotas_especie_tenant_fkey(id, name)")
      .eq("tenant_id", ctx.tenantId)
      .in("id", mascotaIds);

    if (mErr) throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, mErr.message);

    const mascotaEspecieMap = new Map((mascotasData ?? []).map((m) => [
      m.id,
      {
        especieId: m.especie_id,
        especieNombre: (m.especies as any)?.name ?? "Otra",
      },
    ]));

    const espMap = new Map<string, {
      especieId: string;
      especieNombre: string;
      cantidadConsumos: number;
      unidadesConsumidas: number;
      costoTotalInsumos: number;
    }>();

    for (const c of (consumos ?? [])) {
      const espInfo = mascotaEspecieMap.get(c.mascota_id) ?? {
        especieId: "desconocida",
        especieNombre: "Desconocida",
      };

      if (query.especieId && espInfo.especieId !== query.especieId) {
        continue;
      }

      const prev = espMap.get(espInfo.especieId) ?? {
        especieId: espInfo.especieId,
        especieNombre: espInfo.especieNombre,
        cantidadConsumos: 0,
        unidadesConsumidas: 0,
        costoTotalInsumos: 0,
      };

      prev.cantidadConsumos += 1;
      prev.unidadesConsumidas += Number(c.cantidad);
      prev.costoTotalInsumos += Number(c.costo_total);
      espMap.set(espInfo.especieId, prev);
    }

    const items = [...espMap.values()].map((e) => ({
      ...e,
      unidadesConsumidas: Math.round(e.unidadesConsumidas * 1000) / 1000,
      costoTotalInsumos: Math.round(e.costoTotalInsumos * 100) / 100,
    }));

    return items;
  },
};
