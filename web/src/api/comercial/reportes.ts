import { apiClient } from "../client.ts";
import { buildQuery } from "./_query.ts";
import type {
  ReporteConsumoEspecie,
  ReporteConsumoProfesional,
  ReporteFraccionamiento,
  ReporteRentabilidad,
  ReporteRotacion,
  ReporteValorizacion,
  ReporteVentasMedioPago,
  ReporteVentasSesion,
  ReporteVentasUsuario,
} from "../../types/index.ts";

// ─── 1. Reportes de Stock e Inventario (view_stock) ──────────────────────────

export interface ValorizacionAFechaParams {
  fechaCorte?: string;
  productoId?: string;
  familiaId?:  string;
}

export function valorizacionAFecha(
  params: ValorizacionAFechaParams = {},
): Promise<ReporteValorizacion> {
  return apiClient<ReporteValorizacion>(
    `/reportes/valorizacion-fecha${buildQuery(params as Record<string, unknown>)}`,
  );
}

export interface ReporteRotacionParams {
  diasSinMovimiento?: number;
  desde?:             string;
  hasta?:             string;
  familiaId?:         string;
}

export function rotacion(
  params: ReporteRotacionParams = {},
): Promise<ReporteRotacion> {
  return apiClient<ReporteRotacion>(
    `/reportes/rotacion${buildQuery(params as Record<string, unknown>)}`,
  );
}

export interface ReporteFraccionamientoParams {
  desde?:             string;
  hasta?:             string;
  productoOrigenId?:  string;
  productoDestinoId?: string;
}

export function fraccionamiento(
  params: ReporteFraccionamientoParams = {},
): Promise<ReporteFraccionamiento> {
  return apiClient<ReporteFraccionamiento>(
    `/reportes/fraccionamiento${buildQuery(params as Record<string, unknown>)}`,
  );
}

export interface ReporteConsumoProfesionalParams {
  desde?:         string;
  hasta?:         string;
  profesionalId?: string;
}

export function consumoProfesional(
  params: ReporteConsumoProfesionalParams = {},
): Promise<ReporteConsumoProfesional> {
  return apiClient<ReporteConsumoProfesional>(
    `/reportes/consumo-profesional${buildQuery(params as Record<string, unknown>)}`,
  );
}

export interface ReporteConsumoEspecieParams {
  desde?:     string;
  hasta?:     string;
  especieId?: string;
}

export function consumoEspecie(
  params: ReporteConsumoEspecieParams = {},
): Promise<ReporteConsumoEspecie> {
  return apiClient<ReporteConsumoEspecie>(
    `/reportes/consumo-especie${buildQuery(params as Record<string, unknown>)}`,
  );
}

// ─── 2. Reportes de Ventas y Cobranzas (view_sales) ──────────────────────────

export interface ReporteRentabilidadParams {
  desde?:      string;
  hasta?:      string;
  familiaId?:  string;
  productoId?: string;
}

export function rentabilidad(
  params: ReporteRentabilidadParams = {},
): Promise<ReporteRentabilidad> {
  return apiClient<ReporteRentabilidad>(
    `/reportes/rentabilidad${buildQuery(params as Record<string, unknown>)}`,
  );
}

export interface ReporteVentasUsuarioParams {
  desde?:     string;
  hasta?:     string;
  usuarioId?: string;
}

export function ventasUsuario(
  params: ReporteVentasUsuarioParams = {},
): Promise<ReporteVentasUsuario> {
  return apiClient<ReporteVentasUsuario>(
    `/reportes/ventas-usuario${buildQuery(params as Record<string, unknown>)}`,
  );
}

export interface ReporteVentasSesionParams {
  desde?:    string;
  hasta?:    string;
  cajaId?:   string;
  sesionId?: string;
}

export function ventasSesion(
  params: ReporteVentasSesionParams = {},
): Promise<ReporteVentasSesion> {
  return apiClient<ReporteVentasSesion>(
    `/reportes/ventas-sesion${buildQuery(params as Record<string, unknown>)}`,
  );
}

export interface ReporteVentasMedioPagoParams {
  desde?:       string;
  hasta?:       string;
  medioPagoId?: string;
}

export function ventasMedioPago(
  params: ReporteVentasMedioPagoParams = {},
): Promise<ReporteVentasMedioPago> {
  return apiClient<ReporteVentasMedioPago>(
    `/reportes/ventas-medio-pago${buildQuery(params as Record<string, unknown>)}`,
  );
}
