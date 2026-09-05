import { apiClient, apiClientList } from "../client.ts";
import { buildQuery } from "./_query.ts";
import type {
  AjustarExistenciaInput,
  ApiMeta,
  EstadoRecuento,
  ItemRecuentoInput,
  Recuento,
  RegistrarDevolucionInput,
  ResultadoAjuste,
  ResultadoAplicarRecuento,
  ResultadoDevolucion,
} from "../../types/index.ts";

export function ajustarExistencia(
  input: AjustarExistenciaInput,
): Promise<ResultadoAjuste> {
  return apiClient<ResultadoAjuste>("/ajustes", {
    method: "POST",
    body:   JSON.stringify(input),
  });
}

export function bloquearLote(
  loteId: string,
  motivo: string,
): Promise<{ id: string; estado: string; motivoBloqueo: string }> {
  return apiClient<{ id: string; estado: string; motivoBloqueo: string }>(
    `/lotes/${loteId}/bloquear`,
    {
      method: "POST",
      body:   JSON.stringify({ motivo }),
    },
  );
}

export function desbloquearLote(
  loteId: string,
  motivo: string,
): Promise<{ id: string; estado: string }> {
  return apiClient<{ id: string; estado: string }>(
    `/lotes/${loteId}/desbloquear`,
    {
      method: "POST",
      body:   JSON.stringify({ motivo }),
    },
  );
}

// ─── Recuentos de Inventario ──────────────────────────────────────────────────

export function crearRecuento(observaciones?: string | null): Promise<Recuento> {
  return apiClient<Recuento>("/recuentos", {
    method: "POST",
    body:   JSON.stringify(observaciones ? { observaciones } : {}),
  });
}

export interface ListarRecuentosParams {
  estado?: EstadoRecuento;
  page?:   number;
  limit?:  number;
}

export function listarRecuentos(
  params: ListarRecuentosParams = {},
): Promise<{ items: Recuento[]; meta: ApiMeta }> {
  return apiClientList<Recuento>(`/recuentos${buildQuery(params as Record<string, unknown>)}`);
}

export function obtenerRecuento(id: string): Promise<Recuento> {
  return apiClient<Recuento>(`/recuentos/${id}`);
}

export function guardarDetallesRecuento(
  recuentoId: string,
  items: ItemRecuentoInput[],
): Promise<{ recuentoId: string; itemsCount: number }> {
  return apiClient<{ recuentoId: string; itemsCount: number }>(
    `/recuentos/${recuentoId}/detalles`,
    {
      method: "PUT",
      body:   JSON.stringify({ items }),
    },
  );
}

export function aplicarRecuento(
  recuentoId: string,
  input: { confirmarDesvios?: boolean } = {},
): Promise<ResultadoAplicarRecuento> {
  return apiClient<ResultadoAplicarRecuento>(
    `/recuentos/${recuentoId}/aplicar`,
    {
      method: "POST",
      body:   JSON.stringify(input),
    },
  );
}

export function eliminarRecuento(
  recuentoId: string,
): Promise<{ id: string; deleted: boolean }> {
  return apiClient<{ id: string; deleted: boolean }>(`/recuentos/${recuentoId}`, {
    method: "DELETE",
  });
}

// ─── Devoluciones de Venta ────────────────────────────────────────────────────

export function registrarDevolucion(
  input: RegistrarDevolucionInput,
): Promise<ResultadoDevolucion> {
  return apiClient<ResultadoDevolucion>("/devoluciones", {
    method: "POST",
    body:   JSON.stringify(input),
  });
}
