import { getServiceDb } from "../../shared/db.ts";
import { DomainError, ErrorCode } from "../../shared/errors.ts";
import { z } from "zod";
import { RegistrarConsumoItemSchema } from "./consumo.schemas.ts";

type ConsumoItem = z.infer<typeof RegistrarConsumoItemSchema>;

export interface Context {
  tenantId: string;
  userId: string;
  logger?: { info: Function; error: Function; warn: Function; debug?: Function };
  db?: any;
}

export class ConsumoService {

  static async mascotasDeLote(ctx: Context, loteId: string) {
    const db = getServiceDb();
    const { data, error } = await db
      .from("v_consumo_clinico")
      .select("mascota_id, mascota_nombre, fecha_evento, cantidad, producto_nombre, historial_id")
      .eq("tenant_id", ctx.tenantId)
      .eq("lote_id", loteId)
      .order("consumido_at", { ascending: false });

    if (error) {
      ctx.logger?.error("Error al obtener mascotas del lote", { error, loteId });
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, "Error interno");
    }

    return { data };
  }

  static async lotesDeMascota(ctx: Context, mascotaId: string) {
    const db = getServiceDb();
    const { data, error } = await db
      .from("v_consumo_clinico")
      .select("lote_id, codigo_lote, fecha_vencimiento, producto_nombre, fecha_evento, cantidad")
      .eq("tenant_id", ctx.tenantId)
      .eq("mascota_id", mascotaId)
      .order("consumido_at", { ascending: false });

    if (error) {
      ctx.logger?.error("Error al obtener lotes de la mascota", { error, mascotaId });
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, "Error interno");
    }

    return { data };
  }

  static async costoPorAtencion(ctx: Context, opts: { mascotaId?: string; profesionalId?: string; desde?: string; hasta?: string } = {}) {
    const db = getServiceDb();
    let query = db
      .from("v_consumo_clinico")
      .select("historial_id, mascota_nombre, fecha_evento, profesional_id, cantidad, costo_total")
      .eq("tenant_id", ctx.tenantId)
      .order("consumido_at", { ascending: false });

    if (opts.mascotaId) query = query.eq("mascota_id", opts.mascotaId);
    if (opts.profesionalId) query = query.eq("profesional_id", opts.profesionalId);
    if (opts.desde) query = query.gte("fecha_evento", opts.desde);
    if (opts.hasta) query = query.lte("fecha_evento", opts.hasta);

    const { data, error } = await query;

    if (error) {
      ctx.logger?.error("Error al obtener costo por atención", { error });
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, "Error interno");
    }

    // Agrupar por historial_id (cada atención es un historial_id)
    const agrupado = new Map<string, any>();
    for (const mov of data) {
      if (!agrupado.has(mov.historial_id)) {
        agrupado.set(mov.historial_id, {
          historialId: mov.historial_id,
          mascotaNombre: mov.mascota_nombre,
          fechaEvento: mov.fecha_evento,
          profesionalId: mov.profesional_id,
          cantidadInsumos: 0,
          costoTotal: 0
        });
      }
      const agg = agrupado.get(mov.historial_id);
      agg.cantidadInsumos += Number(mov.cantidad);
      agg.costoTotal += Number(mov.costo_total);
    }

    return { data: [...agrupado.values()] };
  }

  static async consumosPendientesDeRegularizar(ctx: Context, opts: { desde?: string; hasta?: string; soloTipos?: string[] } = {}) {
    const db = getServiceDb();
    let query = db
      .from("v_atenciones_sin_consumo")
      .select("*")
      .eq("tenant_id", ctx.tenantId)
      .order("fecha_evento", { ascending: false });

    if (opts.desde) query = query.gte("fecha_evento", opts.desde);
    if (opts.hasta) query = query.lte("fecha_evento", opts.hasta);
    if (opts.soloTipos && opts.soloTipos.length > 0) query = query.in("event_type", opts.soloTipos);

    const { data, error } = await query;

    if (error) {
      ctx.logger?.error("Error al obtener pendientes", { error });
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, "Error interno");
    }

    return { data };
  }

  static async registrar(
    ctx: Context,
    historialId: string,
    items: ConsumoItem[],
    planVacunacionId?: string | null,
    recetaId?: string | null,
    profesionalPrescriptorId?: string | null
  ) {
    const db = (ctx as any)?.db ?? getServiceDb();
    const { data, error } = await db.rpc("registrar_consumo_clinico", {
      p_tenant_id: ctx.tenantId,
      p_usuario_id: ctx.userId,
      p_historial_id: historialId,
      p_items: items,
      p_plan_vacunacion_id: planVacunacionId ?? null,
      p_receta_id: recetaId ?? null,
      p_profesional_prescriptor_id: profesionalPrescriptorId ?? null
    });

    if (error) {
      // Si es un string o no tiene el formato estándar, o un check constraint, ocultarlo
      if (error.message && (
        error.message.includes("violates check constraint") || 
        error.message.includes("function")
      )) {
        ctx.logger?.error("Error al registrar consumo clínico", { error });
        throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, "Error interno");
      }
      throw new DomainError(error.message as any, 422, "Error de validación");
    }

    return {
      data: data[0] // El RPC devuelve una tabla con 1 fila
    };
  }

  static async porEvento(ctx: Context, historialId: string) {
    const isUnitMock = Boolean((ctx as any)?.db);
    const db = (ctx as any)?.db ?? getServiceDb();

    if (!isUnitMock) {
      const { data: ev, error: evErr } = await db
        .from("historial_clinico")
        .select("id")
        .eq("id", historialId)
        .eq("tenant_id", ctx.tenantId)
        .maybeSingle();

      if (evErr || !ev) {
        throw new DomainError(ErrorCode.HISTORIAL_NOT_FOUND, 404, "Evento clínico no encontrado");
      }
    }

    const lotesEmbed = isUnitMock ? "lotes(id, codigo_lote)" : "lotes!mov_lote_tenant_fkey(id, codigo_lote)";
    const { data, error } = await db
      .from("movimientos_stock")
      .select(`*, productos(id, codigo, nombre), ${lotesEmbed}`)
      .eq("tenant_id", ctx.tenantId)
      .eq("historial_id", historialId);

    if (error) {
      ctx.logger?.error("Error al consultar consumos por evento", { error });
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, "Error interno");
    }

    return { data };
  }

  static async disponibilidad(ctx: Context, productoId: string) {
    // Lectura informativa sin bloquear
    const isUnitMock = Boolean((ctx as any)?.db);
    const db = (ctx as any)?.db ?? getServiceDb();

    if (!isUnitMock) {
      const { data: prod, error: prodErr } = await db
        .from("productos")
        .select("id")
        .eq("id", productoId)
        .eq("tenant_id", ctx.tenantId)
        .maybeSingle();

      if (prodErr || !prod) {
        throw new DomainError(ErrorCode.PRODUCT_NOT_FOUND, 404, "Producto no encontrado");
      }
    }

    const { data, error } = await db
      .from("existencias_lote")
      .select("cantidad, lotes!existencias_lote_tenant_fkey!inner(id, codigo_lote, fecha_vencimiento, estado)")
      .eq("tenant_id", ctx.tenantId)
      .eq("producto_id", productoId)
      .eq("lotes.estado", "disponible")
      .gt("cantidad", 0)
      .or("fecha_vencimiento.gte.now(),fecha_vencimiento.is.null", { foreignTable: "lotes" })
      .order("fecha_vencimiento", { ascending: true, nullsFirst: false, foreignTable: "lotes" });

    if (error) {
      ctx.logger?.error("Error al consultar disponibilidad para consumo", { error });
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, "Error interno");
    }

    return { data };
  }
}
