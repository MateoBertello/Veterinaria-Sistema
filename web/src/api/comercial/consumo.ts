import { apiClient } from "../client.ts";
import type {
  DisponibilidadLoteItem,
  MovimientoStock,
  MovimientoStockConsumoRow,
  RegistrarConsumoInput,
} from "../../types/index.ts";

export function registrar(
  input: RegistrarConsumoInput,
): Promise<{ operacionId: string; movimientosGenerados: number }> {
  return apiClient<{ operacionId: string; movimientosGenerados: number }>("/consumos", {
    method: "POST",
    body:   JSON.stringify(input),
  });
}

/**
 * Normaliza la fila cruda de PostgREST al tipo de dominio MovimientoStock.
 * GET /consumos/evento/:historialId devuelve el resultado de la consulta sin mapear
 * (consumo.service.ts, porEvento), así que la conversión snake_case -> camelCase y el
 * renombre de los embeds (`productos`/`lotes` -> `producto`/`lote`) se hacen acá, en la
 * capa de datos, y no en la pantalla.
 *
 * El motivo FEFO no es un campo aparte: el RPC de consumo lo persiste en la columna
 * `motivo` cuando no se respetó el orden FEFO
 * (20261013000001_comercial_registrar_consumo_clinico_rpc.sql).
 */
function toMovimientoStock(row: MovimientoStockConsumoRow): MovimientoStock {
  return {
    id:               row.id,
    operacionId:      row.operacion_id,
    tipo:             row.tipo,
    cantidad:         Number(row.cantidad),
    cantidadConSigno: Number(row.cantidad_con_signo),
    costoUnitario:    Number(row.costo_unitario),
    costoTotal:       Number(row.costo_total),
    motivo:           row.motivo ?? null,
    createdAt:        row.created_at,
    producto:         row.productos ?? null,
    lote:             row.lotes ? { id: row.lotes.id, codigoLote: row.lotes.codigo_lote } : null,
  };
}

export async function porEvento(historialId: string): Promise<MovimientoStock[]> {
  const rows = await apiClient<MovimientoStockConsumoRow[]>(`/consumos/evento/${historialId}`);
  return (rows ?? []).map(toMovimientoStock);
}

export function disponibilidad(productoId: string): Promise<DisponibilidadLoteItem[]> {
  return apiClient<DisponibilidadLoteItem[]>(
    `/consumos/disponibilidad?productoId=${encodeURIComponent(productoId)}`,
  );
}
