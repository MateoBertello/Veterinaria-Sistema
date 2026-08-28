import { apiClient, apiClientBlob, apiClientList } from "./client.ts";
import type {
  AdjuntoFirmado,
  AdjuntoFirmadoLote,
  AdjuntoMeta,
  ApiMeta,
  CrearEventoClinicoInput,
  EutanasiaResultado,
  EventoCreado,
  HistorialDetalle,
  HistorialItem,
  RegistrarEutanasiaInput,
  ResumenClinico,
} from "../types/index.ts";

export interface ListarHistorialParams {
  page?:  number;
  limit?: number;
}

/** GET /mascotas/{petId}/historial — timeline paginado, orden desc (RN-HC1). */
export function listarHistorial(
  petId: string,
  params: ListarHistorialParams = {},
): Promise<{ items: HistorialItem[]; meta: ApiMeta }> {
  const qs = new URLSearchParams();
  if (params.page)  qs.set("page",  String(params.page));
  if (params.limit) qs.set("limit", String(params.limit));

  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return apiClientList<HistorialItem>(`/mascotas/${petId}/historial${suffix}`);
}

/** GET /historial/{id} — detalle de un evento, incluye adjuntos. */
export function obtenerEvento(id: string): Promise<HistorialDetalle> {
  return apiClient<HistorialDetalle>(`/historial/${id}`);
}

/** GET /mascotas/{petId}/resumen-clinico — cabecera con último peso derivado (RN-HC2). */
export function resumenClinico(petId: string): Promise<ResumenClinico> {
  return apiClient<ResumenClinico>(`/mascotas/${petId}/resumen-clinico`);
}

/** POST /mascotas/{petId}/historial — registrar evento clínico (RN-EC1..EC9). */
export function crearEvento(
  petId: string,
  input: CrearEventoClinicoInput,
): Promise<EventoCreado> {
  return apiClient<EventoCreado>(`/mascotas/${petId}/historial`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** POST /historial/{id}/adjuntos — sube un archivo (JPG/PNG/GIF/PDF, ≤10MB). */
export function subirAdjunto(eventoId: string, file: File): Promise<AdjuntoMeta> {
  const form = new FormData();
  form.set("file", file);
  return apiClient<AdjuntoMeta>(`/historial/${eventoId}/adjuntos`, {
    method: "POST",
    body: form,
  });
}

/** GET /adjuntos/{adjuntoId} — signed URL de descarga, válida 5 minutos. */
export function obtenerAdjuntoFirmado(adjuntoId: string): Promise<AdjuntoFirmado> {
  return apiClient<AdjuntoFirmado>(`/adjuntos/${adjuntoId}`);
}

/**
 * GET /historial/{id}/adjuntos-firmados — signed URLs de todos los adjuntos
 * del evento en una sola petición (vista previa inline), válidas 5 minutos.
 */
export function obtenerAdjuntosFirmadosEvento(eventoId: string): Promise<AdjuntoFirmadoLote[]> {
  return apiClient<AdjuntoFirmadoLote[]>(`/historial/${eventoId}/adjuntos-firmados`);
}

/**
 * POST /mascotas/{petId}/eutanasia — la ÚNICA operación irreversible del
 * sistema (RN-EC10..EC12): transacción única evento+estado vía RPC
 * `registrar_eutanasia`, sin endpoint de reversión.
 */
export function registrarEutanasia(
  petId: string,
  input: RegistrarEutanasiaInput,
): Promise<EutanasiaResultado> {
  return apiClient<EutanasiaResultado>(`/mascotas/${petId}/eutanasia`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export type FormatoExport = "pdf" | "xlsx";

/**
 * GET /mascotas/{petId}/historial/export — exporta el historial completo
 * (RN-EX1..EX5). Devuelve el archivo binario crudo, no el envelope JSON.
 */
export async function exportarHistorial(
  petId: string,
  format: FormatoExport,
): Promise<{ blob: Blob; filename: string }> {
  const { blob, filename } = await apiClientBlob(`/mascotas/${petId}/historial/export?format=${format}`);
  return { blob, filename: filename ?? `historial-${petId}.${format}` };
}
