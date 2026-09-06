import { apiClient, apiClientList } from "../client.ts";
import { buildQuery } from "./_query.ts";
import type {
  AnularVentaInput,
  ApiMeta,
  EstadoVenta,
  RegistrarVentaInput,
  ResultadoVenta,
  TipoItemVenta,
  Venta,
  VentaRow,
} from "../../types/index.ts";

/**
 * Normaliza la fila cruda de PostgREST (snake_case) al tipo de dominio Venta (camelCase).
 * Se realiza en este único lugar de la capa de datos comercial.
 */
function toVenta(row: VentaRow): Venta {
  return {
    id:              row.id,
    tenantId:        row.tenant_id,
    sesionCajaId:    row.sesion_caja_id,
    clienteId:       row.cliente_id,
    usuarioId:       row.usuario_id,
    numeroOperacion: row.numero_operacion,
    condicionPago:   row.condicion_pago,
    subtotalNeto:    Number(row.subtotal_neto),
    totalIva:        Number(row.total_iva),
    total:           Number(row.total),
    saldoPendiente:  Number(row.saldo_pendiente),
    estado:          row.estado,
    observaciones:   row.observaciones,
    createdAt:       row.created_at,
    anuladaAt:       row.anulada_at,
    anuladaMotivo:   row.anulada_motivo,
    cliente:         row.cliente ?? null,
    usuario:         row.usuario ?? null,
    items: (row.items ?? []).map((it) => ({
      id:                     it.id,
      ventaId:                it.venta_id,
      tipoItem:               it.tipo_item,
      productoId:             it.producto_id,
      servicioId:             it.servicio_id,
      descripcionSnapshot:    it.descripcion_snapshot ?? null,
      loteId:                 it.lote_id,
      motivoFefo:             it.motivo_fefo,
      mascotaId:              it.mascota_id,
      cantidad:               Number(it.cantidad),
      precioUnitario:         Number(it.precio_unitario),
      subtotalNeto:           Number(it.subtotal_neto),
      alicuotaIva:            Number(it.alicuota_iva),
      importeIva:             Number(it.importe_iva),
      totalLinea:             Number(it.total_linea),
      costoUnitarioHistorico: it.costo_unitario_historico != null ? Number(it.costo_unitario_historico) : null,
      descuentoPorcentaje:    it.descuento_porcentaje != null ? Number(it.descuento_porcentaje) : 0,
      lote:                   it.lote ? {
        id:               it.lote.id,
        codigoLote:       it.lote.codigo_lote,
        numeroLote:       it.lote.numero_lote,
        fechaVencimiento: it.lote.fecha_vencimiento,
      } : null,
    })),
    pagos: (row.pagos ?? []).map((p) => ({
      id:          p.id,
      ventaId:     p.venta_id,
      medioPagoId: p.medio_pago_id,
      importe:     Number(p.importe),
      referencia:  p.referencia,
      createdAt:   p.created_at,
    })),
  };
}

export interface ListarVentasParams {
  clienteId?:    string;
  sesionCajaId?: string;
  usuarioId?:    string;
  estado?:       EstadoVenta;
  desde?:        string;
  hasta?:        string;
  page?:         number;
  limit?:        number;
}

export async function listarVentas(
  params: ListarVentasParams = {},
): Promise<{ items: Venta[]; meta: ApiMeta }> {
  const { items, meta } = await apiClientList<VentaRow>(
    `/ventas${buildQuery(params as Record<string, unknown>)}`,
  );
  return {
    items: items.map(toVenta),
    meta,
  };
}

export async function obtenerVenta(id: string): Promise<Venta> {
  const row = await apiClient<VentaRow>(`/ventas/${id}`);
  return toVenta(row);
}

export function registrarVenta(input: RegistrarVentaInput): Promise<ResultadoVenta> {
  return apiClient<ResultadoVenta>("/ventas", {
    method: "POST",
    body:   JSON.stringify(input),
  });
}

export function anularVenta(
  id: string,
  input: AnularVentaInput,
): Promise<{ ventaId: string; operacionId: string; estado: string; anuladaAt: string }> {
  return apiClient<{ ventaId: string; operacionId: string; estado: string; anuladaAt: string }>(
    `/ventas/${id}/anular`,
    {
      method: "POST",
      body:   JSON.stringify(input),
    },
  );
}

export interface ReporteMargenParams {
  itemId?:   string;
  tipoItem?: TipoItemVenta;
  desde?:    string;
  hasta?:    string;
}

export function reporteMargen(
  params: ReporteMargenParams = {},
): Promise<unknown[]> {
  return apiClient<unknown[]>(`/ventas/reportes/margen${buildQuery(params as Record<string, unknown>)}`);
}

export interface ReporteItemsVendidosParams {
  itemId?:   string;
  tipoItem?: TipoItemVenta;
  desde?:    string;
  hasta?:    string;
}

export function reporteItemsVendidos(
  params: ReporteItemsVendidosParams = {},
): Promise<unknown[]> {
  return apiClient<unknown[]>(
    `/ventas/reportes/items-vendidos${buildQuery(params as Record<string, unknown>)}`,
  );
}
