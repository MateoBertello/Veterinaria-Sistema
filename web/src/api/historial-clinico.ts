import { apiClient, apiClientList } from "./client.ts";
import type {
  AdjuntoFirmado,
  AdjuntoMeta,
  ApiMeta,
  CrearEventoClinicoInput,
  EventoCreado,
  HistorialDetalle,
  HistorialItem,
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
