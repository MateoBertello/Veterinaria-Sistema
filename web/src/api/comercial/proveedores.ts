import { apiClient, apiClientList } from "../client.ts";
import { buildQuery } from "./_query.ts";
import type {
  ActualizarProveedorInput,
  ApiMeta,
  CrearProveedorInput,
  Proveedor,
} from "../../types/index.ts";

export interface ListarProveedoresParams {
  search?: string;
  activo?: boolean;
  page?:   number;
  limit?:  number;
}

export function listarProveedores(
  params: ListarProveedoresParams = {},
): Promise<{ items: Proveedor[]; meta: ApiMeta }> {
  return apiClientList<Proveedor>(`/proveedores${buildQuery(params as Record<string, unknown>)}`);
}

export function obtenerProveedor(id: string): Promise<Proveedor> {
  return apiClient<Proveedor>(`/proveedores/${id}`);
}

export function crearProveedor(input: CrearProveedorInput): Promise<Proveedor> {
  return apiClient<Proveedor>("/proveedores", {
    method: "POST",
    body:   JSON.stringify(input),
  });
}

export function actualizarProveedor(
  id: string,
  input: ActualizarProveedorInput,
): Promise<Proveedor> {
  return apiClient<Proveedor>(`/proveedores/${id}`, {
    method: "PUT",
    body:   JSON.stringify(input),
  });
}

export function cambiarEstadoProveedor(
  id: string,
  activo: boolean,
): Promise<Proveedor> {
  return apiClient<Proveedor>(`/proveedores/${id}/estado`, {
    method: "PATCH",
    body:   JSON.stringify({ activo }),
  });
}
