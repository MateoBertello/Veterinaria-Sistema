import { apiClient, apiClientList } from "../client.ts";
import { buildQuery } from "./_query.ts";
import type {
  ActualizarCompraInput,
  ActualizarItemCompraInput,
  AgregarItemCompraInput,
  ApiMeta,
  Compra,
  CompraItem,
  CrearCompraInput,
  EstadoCompra,
} from "../../types/index.ts";

export interface ListarComprasParams {
  proveedorId?: string;
  estado?:      EstadoCompra;
  desde?:       string;
  hasta?:       string;
  page?:        number;
  limit?:       number;
}

export function listarCompras(
  params: ListarComprasParams = {},
): Promise<{ items: Compra[]; meta: ApiMeta }> {
  return apiClientList<Compra>(`/compras${buildQuery(params as Record<string, unknown>)}`);
}

export function obtenerCompra(id: string): Promise<Compra> {
  return apiClient<Compra>(`/compras/${id}`);
}

export function crearCompra(input: CrearCompraInput): Promise<Compra> {
  return apiClient<Compra>("/compras", {
    method: "POST",
    body:   JSON.stringify(input),
  });
}

export function actualizarCompra(
  id: string,
  input: ActualizarCompraInput,
): Promise<Compra> {
  return apiClient<Compra>(`/compras/${id}`, {
    method: "PUT",
    body:   JSON.stringify(input),
  });
}

export function agregarItem(
  compraId: string,
  input: AgregarItemCompraInput,
): Promise<CompraItem> {
  return apiClient<CompraItem>(`/compras/${compraId}/items`, {
    method: "POST",
    body:   JSON.stringify(input),
  });
}

export function actualizarItem(
  compraId: string,
  itemId: string,
  input: ActualizarItemCompraInput,
): Promise<CompraItem> {
  return apiClient<CompraItem>(`/compras/${compraId}/items/${itemId}`, {
    method: "PUT",
    body:   JSON.stringify(input),
  });
}

export function quitarItem(
  compraId: string,
  itemId: string,
): Promise<{ deleted: boolean }> {
  return apiClient<{ deleted: boolean }>(`/compras/${compraId}/items/${itemId}`, {
    method: "DELETE",
  });
}

export function confirmarCompra(id: string): Promise<Compra> {
  return apiClient<Compra>(`/compras/${id}/confirmar`, {
    method: "POST",
  });
}

export function anularCompra(
  id: string,
  motivo: string,
): Promise<Compra> {
  return apiClient<Compra>(`/compras/${id}/anular`, {
    method: "POST",
    body:   JSON.stringify({ motivo }),
  });
}
