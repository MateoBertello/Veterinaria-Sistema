import { apiClient } from "./client.ts";
import type { ModuloContratado } from "../types/index.ts";

/**
 * Módulos contratados del tenant del usuario autenticado.
 * Alimenta el sidebar dinámico (oculta los módulos no contratados, RN-G2).
 */
export function fetchModulosHabilitados(): Promise<ModuloContratado[]> {
  return apiClient<ModuloContratado[]>("/modulos-habilitados");
}
