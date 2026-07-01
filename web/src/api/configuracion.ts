import { apiClient } from "./client.ts";
import type { ConfiguracionInput, ConfiguracionTenant } from "../types/index.ts";

/** GET /configuracion — singleton del tenant (RN-CF1). */
export function obtenerConfiguracion(): Promise<ConfiguracionTenant> {
  return apiClient<ConfiguracionTenant>("/configuracion");
}

/** PUT /configuracion — actualiza el singleton (RN-CF2, RN-CF5). */
export function actualizarConfiguracion(input: ConfiguracionInput): Promise<ConfiguracionTenant> {
  return apiClient<ConfiguracionTenant>("/configuracion", {
    method: "PUT",
    body: JSON.stringify(input),
  });
}
