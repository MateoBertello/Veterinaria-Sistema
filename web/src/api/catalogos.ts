import { ApiError } from "../types/index.ts";
import type { Especie, Raza } from "../types/index.ts";

// Catálogos globales (especies, razas) se leen por PostgREST directo — sin pasar
// por Controller/Service de Hono — a través del mismo proxy Vite que el resto del
// front (/rest/v1/*). La apikey la inyecta el proxy (server-side, vite.config.ts),
// el front solo envía el Bearer del usuario igual que con apiClient.
async function postgrest<T>(path: string): Promise<T[]> {
  const token = localStorage.getItem("sb-token");
  const headers: Record<string, string> = {};
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  let res: Response;
  try {
    res = await fetch(`/rest/v1/${path}`, { headers });
  } catch (err) {
    throw new ApiError("NETWORK_ERROR", 0, "No se pudo conectar con el servidor", [err]);
  }

  if (!res.ok) {
    throw new ApiError("INTERNAL_ERROR", res.status, `Error al cargar catálogo (${res.status})`);
  }

  return res.json() as Promise<T[]>;
}

/** Catálogo global de especies (PostgREST directo vía proxy). */
export function listarEspecies(): Promise<Especie[]> {
  return postgrest<Especie>("especies?select=id,name&order=name");
}

/** Razas de una especie específica (PostgREST directo vía proxy). */
export function listarRazas(especieId: string): Promise<Raza[]> {
  return postgrest<Raza>(`razas?especie_id=eq.${especieId}&select=id,name,especie_id&order=name`);
}

export interface TipoVacuna {
  id:                    string;
  nombre:                string;
  especie_aplicable:     string | null;
  meses_refuerzo_sugerido: number | null;
}

/** Catálogo global de tipos de vacuna activos (PostgREST directo vía proxy). */
export function listarTiposVacuna(especieAplicable?: string): Promise<TipoVacuna[]> {
  const filter = especieAplicable
    ? `&especie_aplicable=eq.${encodeURIComponent(especieAplicable)}`
    : "";
  return postgrest<TipoVacuna>(
    `tipos_vacuna?select=id,nombre,especie_aplicable,meses_refuerzo_sugerido&active=eq.true${filter}&order=nombre`,
  );
}
