import { apiClient, apiClientList } from "./client.ts";
import type { ApiMeta, Cliente, ClienteInput } from "../types/index.ts";

export interface ListarClientesParams {
  search?: string;
  page?:   number;
  limit?:  number;
}

/** GET /clientes — listado paginado con búsqueda (envelope con meta). */
export function listarClientes(
  params: ListarClientesParams = {},
): Promise<{ items: Cliente[]; meta: ApiMeta }> {
  const qs = new URLSearchParams();
  if (params.search) qs.set("search", params.search);
  if (params.page)   qs.set("page", String(params.page));
  if (params.limit)  qs.set("limit", String(params.limit));

  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return apiClientList<Cliente>(`/clientes${suffix}`);
}

/** POST /clientes — alta de cliente. */
export function crearCliente(input: ClienteInput): Promise<Cliente> {
  return apiClient<Cliente>("/clientes", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** PUT /clientes/{id} — edición de cliente. */
export function editarCliente(id: string, input: ClienteInput): Promise<Cliente> {
  return apiClient<Cliente>(`/clientes/${id}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

/** DELETE /clientes/{id} — baja lógica (RN-CL9). */
export function eliminarCliente(id: string): Promise<{ id: string; deleted: true }> {
  return apiClient<{ id: string; deleted: true }>(`/clientes/${id}`, {
    method: "DELETE",
  });
}
