import { ApiError } from "../types/index.ts";
import type { Especie, Raza } from "../types/index.ts";

// Catálogos globales (especies, razas) se leen por PostgREST directo — sin pasar
// por Controller/Service de Hono. Dos modos según el hosting:
//
//  • DEV / hosting con reverse proxy: fetch relativo a /rest/v1/*; la apikey la
//    inyecta el proxy server-side (vite.config.ts en dev, nginx en prod) y nunca
//    entra al bundle. Es el modo por defecto (sin VITE_SUPABASE_*).
//  • Hosting estático sin proxy (Vercel/Netlify): se setean VITE_SUPABASE_URL y
//    VITE_SUPABASE_ANON_KEY en el build y el fetch va directo a Supabase con la
//    anon key en el bundle. La anon key es pública por diseño (solo identifica
//    el proyecto); la barrera real son RLS y el Bearer del usuario, igual que en
//    el modo proxy.
//
// En ambos modos el front envía el Bearer del usuario igual que con apiClient.
const SUPABASE_URL = import.meta.env["VITE_SUPABASE_URL"] as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env["VITE_SUPABASE_ANON_KEY"] as string | undefined;
const MODO_DIRECTO = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

async function postgrest<T>(path: string): Promise<T[]> {
  const token = localStorage.getItem("sb-token");
  const headers: Record<string, string> = {};
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  if (MODO_DIRECTO) {
    headers["apikey"] = SUPABASE_ANON_KEY as string;
  }
  const base = MODO_DIRECTO ? `${SUPABASE_URL}/rest/v1/` : "/rest/v1/";

  let res: Response;
  try {
    res = await fetch(`${base}${path}`, { headers });
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
