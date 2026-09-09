import { getServiceDb } from "../../shared/db.ts";
import { DomainError, ErrorCode } from "../../shared/errors.ts";
import { vencimientoSugerido } from "./fraccionamiento.calculo.ts";
import type {
  FraccionarLoteDto,
  SugerirVencimientoQuery,
  ListarFraccionamientosQuery,
} from "./fraccionamiento.schemas.ts";

export interface Context {
  tenantId:     string;
  callerUserId: string;
  callerName?:  string;
  callerRole?:  string;
}

export interface ResultadoFraccionamiento {
  operacionId:       string;
  loteDestinoId:     string;
  cantidadTeorica:   number;
  cantidadObtenida:  number;
  desvioPorcentaje:  number;
  costoUnitarioHijo: number;
  mermaRegistrada:   number;
}

export interface ItemHistorialFraccionamiento {
  tenantId:              string;
  operacionId:           string;
  productoOrigenId:      string;
  productoDestinoId:     string;
  productoOrigenNombre:  string;
  productoDestinoNombre: string;
  cantidadOrigen:        number;
  factorTeorico:         number;
  cantidadTeorica:       number;
  cantidadObtenida:      number;
  merma:                 number;
  costoConsumido:        number;
  costoUnitarioHijo:     number;
  sobrecosto:            number | null;
  fraccionadoAt:         string;
}

export const FraccionamientoService = {
  async fraccionar(dto: FraccionarLoteDto, ctx: Context): Promise<ResultadoFraccionamiento> {
    const db = getServiceDb();

    const { data, error } = await db.rpc("fraccionar_lote", {
      p_tenant_id:                 ctx.tenantId,
      p_usuario_id:                ctx.callerUserId,
      p_lote_origen_id:            dto.loteOrigenId,
      p_producto_destino_id:       dto.productoDestinoId,
      p_cantidad_origen:           dto.cantidadOrigen,
      p_cantidad_obtenida:         dto.cantidadObtenida,
      p_fecha_vencimiento_destino: dto.fechaVencimientoDestino ?? null,
      p_codigo_lote_destino:       dto.codigoLoteDestino,
      p_motivo:                    dto.motivo ?? null,
    });

    if (error || !data || data.length === 0) {
      const msg = error?.message ?? "";
      if (msg.includes("CONVERSION_NOT_DEFINED")) {
        throw new DomainError(ErrorCode.CONVERSION_NOT_DEFINED, 422, "No existe una conversión definida y activa entre estos productos");
      }
      if (msg.includes("BATCH_NOT_FOUND")) {
        throw new DomainError(ErrorCode.BATCH_NOT_FOUND, 404, "Lote origen no encontrado");
      }
      if (msg.includes("PRODUCT_NOT_FOUND")) {
        throw new DomainError(ErrorCode.PRODUCT_NOT_FOUND, 404, "Producto destino no encontrado");
      }
      if (msg.includes("PRODUCT_INACTIVE")) {
        throw new DomainError(ErrorCode.PRODUCT_INACTIVE, 422, "El producto destino está inactivo");
      }
      if (msg.includes("UNIT_NO_DECIMALS")) {
        throw new DomainError(ErrorCode.UNIT_NO_DECIMALS, 422, "La cantidad especificada no es válida para la unidad de medida");
      }
      if (msg.includes("INSUFFICIENT_STOCK")) {
        throw new DomainError(ErrorCode.INSUFFICIENT_STOCK, 409, "Stock insuficiente en el lote origen");
      }
      if (msg.includes("BATCH_EXPIRED")) {
        throw new DomainError(ErrorCode.BATCH_EXPIRED, 422, "El lote origen está vencido y no se puede fraccionar");
      }
      if (msg.includes("BATCH_BLOCKED")) {
        throw new DomainError(ErrorCode.BATCH_BLOCKED, 422, "El lote origen no está disponible para fraccionamiento");
      }
      if (msg.includes("INVALID_YIELD")) {
        throw new DomainError(ErrorCode.INVALID_YIELD, 422, "La cantidad obtenida debe ser mayor a 0 y menor o igual al rendimiento teórico");
      }
      if (msg.includes("REASON_REQUIRED")) {
        throw new DomainError(ErrorCode.REASON_REQUIRED, 422, "El desvío de rendimiento supera la tolerancia configurada y requiere un motivo descriptivo");
      }
      if (msg.includes("EXPIRY_AFTER_PARENT")) {
        throw new DomainError(ErrorCode.EXPIRY_AFTER_PARENT, 422, "La fecha de vencimiento del lote derivado no puede superar la del lote origen");
      }

      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, error?.message ?? "Error al fraccionar lote");
    }

    const row = data[0];
    return {
      operacionId:       row.operacion_id,
      loteDestinoId:     row.lote_destino_id,
      cantidadTeorica:   Number(row.cantidad_teorica),
      cantidadObtenida:  Number(row.cantidad_obtenida),
      desvioPorcentaje:  Number(row.desvio_porcentaje),
      costoUnitarioHijo: Number(row.costo_unitario_hijo),
      mermaRegistrada:   Number(row.merma_registrada),
    };
  },

  async sugerirVencimiento(query: SugerirVencimientoQuery, ctx: Context): Promise<{ vencimientoSugerido: string | null }> {
    const db = getServiceDb();

    // 1. Obtener fecha de vencimiento del lote origen
    const { data: lote, error: errLote } = await db
      .from("lotes")
      .select("fecha_vencimiento")
      .eq("id", query.loteOrigenId)
      .eq("tenant_id", ctx.tenantId)
      .maybeSingle();

    if (errLote || !lote) {
      throw new DomainError(ErrorCode.BATCH_NOT_FOUND, 404, "Lote origen no encontrado");
    }

    // 2. Obtener vida útil post apertura del producto destino
    const { data: producto, error: errProd } = await db
      .from("productos")
      .select("vida_util_post_apertura_dias")
      .eq("id", query.productoDestinoId)
      .eq("tenant_id", ctx.tenantId)
      .maybeSingle();

    if (errProd || !producto) {
      throw new DomainError(ErrorCode.PRODUCT_NOT_FOUND, 404, "Producto destino no encontrado");
    }

    const sugerido = vencimientoSugerido(
      lote.fecha_vencimiento,
      producto.vida_util_post_apertura_dias,
    );

    return { vencimientoSugerido: sugerido };
  },

  async listarHistorial(query: ListarFraccionamientosQuery, ctx: Context): Promise<{
    items: ItemHistorialFraccionamiento[];
    total: number;
    page:  number;
    limit: number;
  }> {
    const db = getServiceDb();
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const offset = (page - 1) * limit;

    let q = db
      .from("v_costo_fraccionamiento")
      .select("*", { count: "exact" })
      .eq("tenant_id", ctx.tenantId);

    if (query.productoOrigenId) {
      q = q.eq("producto_origen_id", query.productoOrigenId);
    }
    if (query.productoDestinoId) {
      q = q.eq("producto_destino_id", query.productoDestinoId);
    }

    q = q.order("fraccionado_at", { ascending: false }).range(offset, offset + limit - 1);

    const { data, error, count } = await q;

    if (error) {
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, error.message);
    }

    const items: ItemHistorialFraccionamiento[] = (data ?? []).map((r: any) => ({
      tenantId:              r.tenant_id,
      operacionId:           r.operacion_id,
      productoOrigenId:      r.producto_origen_id,
      productoDestinoId:     r.producto_destino_id,
      productoOrigenNombre:  r.producto_origen_nombre,
      productoDestinoNombre: r.producto_destino_nombre,
      cantidadOrigen:        Number(r.cantidad_origen),
      factorTeorico:         Number(r.factor_teorico),
      cantidadTeorica:       Number(r.cantidad_teorica),
      cantidadObtenida:      Number(r.cantidad_obtenida),
      merma:                 Number(r.merma),
      costoConsumido:        Number(r.costo_consumido),
      costoUnitarioHijo:     Number(r.costo_unitario_hijo),
      sobrecosto:            r.sobrecosto != null ? Number(r.sobrecosto) : null,
      fraccionadoAt:         r.fraccionado_at,
    }));

    return {
      items,
      total: count ?? items.length,
      page,
      limit,
    };
  },
};
