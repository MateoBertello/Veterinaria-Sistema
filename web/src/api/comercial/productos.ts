import { apiClient, apiClientList } from "../client.ts";
import { buildQuery } from "./_query.ts";
import type {
  ActualizarConversionInput,
  ActualizarFamiliaInput,
  ActualizarProductoInput,
  ApiMeta,
  Conversion,
  CrearConversionInput,
  CrearDerivadoInput,
  CrearFamiliaInput,
  CrearProductoInput,
  Familia,
  Producto,
} from "../../types/index.ts";

export interface ListarProductosParams {
  search?:       string;
  familiaId?:    string;
  codigoBarras?: string;
  activo?:       boolean;
  vendible?:     boolean;
  page?:         number;
  limit?:        number;
}

export function listarProductos(
  params: ListarProductosParams = {},
): Promise<{ items: Producto[]; meta: ApiMeta }> {
  return apiClientList<Producto>(`/productos${buildQuery(params as Record<string, unknown>)}`);
}

export function obtenerProducto(id: string): Promise<Producto> {
  return apiClient<Producto>(`/productos/${id}`);
}

export function crearProducto(input: CrearProductoInput): Promise<Producto> {
  return apiClient<Producto>("/productos", {
    method: "POST",
    body:   JSON.stringify(input),
  });
}

export function actualizarProducto(
  id: string,
  input: ActualizarProductoInput,
): Promise<Producto> {
  return apiClient<Producto>(`/productos/${id}`, {
    method: "PUT",
    body:   JSON.stringify(input),
  });
}

export function cambiarEstadoProducto(
  id: string,
  activo: boolean,
): Promise<Producto> {
  return apiClient<Producto>(`/productos/${id}/estado`, {
    method: "PATCH",
    body:   JSON.stringify({ activo }),
  });
}

export function crearDerivado(
  id: string,
  input: CrearDerivadoInput,
): Promise<{ productoDerivado: Producto; conversion: Conversion }> {
  return apiClient<{ productoDerivado: Producto; conversion: Conversion }>(
    `/productos/${id}/derivado`,
    {
      method: "POST",
      body:   JSON.stringify(input),
    },
  );
}

// ─── Familias ─────────────────────────────────────────────────────────────────

export interface ListarFamiliasParams {
  search?: string;
  activo?: boolean;
  page?:   number;
  limit?:  number;
}

export function listarFamilias(
  params: ListarFamiliasParams = {},
): Promise<{ items: Familia[]; meta: ApiMeta }> {
  return apiClientList<Familia>(`/familias-producto${buildQuery(params as Record<string, unknown>)}`);
}

export function obtenerFamilia(id: string): Promise<Familia> {
  return apiClient<Familia>(`/familias-producto/${id}`);
}

export function crearFamilia(input: CrearFamiliaInput): Promise<Familia> {
  return apiClient<Familia>("/familias-producto", {
    method: "POST",
    body:   JSON.stringify(input),
  });
}

export function actualizarFamilia(
  id: string,
  input: ActualizarFamiliaInput,
): Promise<Familia> {
  return apiClient<Familia>(`/familias-producto/${id}`, {
    method: "PUT",
    body:   JSON.stringify(input),
  });
}

export function cambiarEstadoFamilia(
  id: string,
  activo: boolean,
): Promise<Familia> {
  return apiClient<Familia>(`/familias-producto/${id}/estado`, {
    method: "PATCH",
    body:   JSON.stringify({ activo }),
  });
}

// ─── Conversiones ─────────────────────────────────────────────────────────────

export interface ListarConversionesParams {
  productoOrigenId?: string;
  activo?:           boolean;
  page?:             number;
  limit?:            number;
}

export function listarConversiones(
  params: ListarConversionesParams = {},
): Promise<{ items: Conversion[]; meta: ApiMeta }> {
  return apiClientList<Conversion>(`/producto-conversiones${buildQuery(params as Record<string, unknown>)}`);
}

export function crearConversion(input: CrearConversionInput): Promise<Conversion> {
  return apiClient<Conversion>("/producto-conversiones", {
    method: "POST",
    body:   JSON.stringify(input),
  });
}

export function actualizarConversion(
  id: string,
  input: ActualizarConversionInput,
): Promise<Conversion> {
  return apiClient<Conversion>(`/producto-conversiones/${id}`, {
    method: "PUT",
    body:   JSON.stringify(input),
  });
}

export function cambiarEstadoConversion(
  id: string,
  activo: boolean,
): Promise<Conversion> {
  return apiClient<Conversion>(`/producto-conversiones/${id}/estado`, {
    method: "PATCH",
    body:   JSON.stringify({ activo }),
  });
}
