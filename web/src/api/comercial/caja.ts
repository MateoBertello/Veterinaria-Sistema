import { apiClient, apiClientList } from "../client.ts";
import { buildQuery } from "./_query.ts";
import type {
  AbrirSesionInput,
  ApiMeta,
  Caja,
  CerrarSesionInput,
  EstadoSesionCaja,
  MovimientoCaja,
  RegistrarMovimientoCajaInput,
  ResumenSesion,
  SesionCaja,
} from "../../types/index.ts";

export function listarCajas(): Promise<Caja[]> {
  return apiClient<Caja[]>("/caja/cajas");
}

export interface ListarSesionesParams {
  estado?: EstadoSesionCaja;
  desde?:  string;
  hasta?:  string;
  page?:   number;
  limit?:  number;
}

export function listarSesiones(
  params: ListarSesionesParams = {},
): Promise<{ items: SesionCaja[]; meta: ApiMeta }> {
  return apiClientList<SesionCaja>(`/caja/sesiones${buildQuery(params as Record<string, unknown>)}`);
}

export function sesionActual(cajaId?: string): Promise<SesionCaja | null> {
  const query = cajaId ? `?cajaId=${encodeURIComponent(cajaId)}` : "";
  return apiClient<SesionCaja | null>(`/caja/sesiones/actual${query}`);
}

export function obtenerSesion(id: string): Promise<SesionCaja> {
  return apiClient<SesionCaja>(`/caja/sesiones/${id}`);
}

export function resumenSesion(id: string): Promise<ResumenSesion> {
  return apiClient<ResumenSesion>(`/caja/sesiones/${id}/resumen`);
}

export function abrirSesion(input: AbrirSesionInput): Promise<SesionCaja> {
  return apiClient<SesionCaja>("/caja/sesiones", {
    method: "POST",
    body:   JSON.stringify(input),
  });
}

export function registrarMovimiento(
  sesionId: string,
  input: RegistrarMovimientoCajaInput,
): Promise<MovimientoCaja> {
  return apiClient<MovimientoCaja>(`/caja/sesiones/${sesionId}/movimientos`, {
    method: "POST",
    body:   JSON.stringify(input),
  });
}

export function cerrarSesion(
  sesionId: string,
  input: CerrarSesionInput,
): Promise<SesionCaja> {
  return apiClient<SesionCaja>(`/caja/sesiones/${sesionId}/cerrar`, {
    method: "POST",
    body:   JSON.stringify(input),
  });
}
