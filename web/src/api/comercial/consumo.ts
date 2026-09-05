import { apiClient } from "../client.ts";
import type {
  DisponibilidadLoteItem,
  MovimientoStock,
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

export function porEvento(historialId: string): Promise<MovimientoStock[]> {
  return apiClient<MovimientoStock[]>(`/consumos/evento/${historialId}`);
}

export function disponibilidad(productoId: string): Promise<DisponibilidadLoteItem[]> {
  return apiClient<DisponibilidadLoteItem[]>(
    `/consumos/disponibilidad?productoId=${encodeURIComponent(productoId)}`,
  );
}
